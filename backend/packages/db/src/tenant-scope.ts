import {
  AndNode,
  BinaryOperationNode,
  ColumnNode,
  JoinNode,
  OperationNodeTransformer,
  OperatorNode,
  ParensNode,
  ReferenceNode,
  TableNode,
  ValueNode,
  WhereNode,
  type AliasNode,
  type IdentifierNode,
  type DeleteQueryNode,
  type InsertQueryNode,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RawNode,
  type RootOperationNode,
  type SelectQueryNode,
  type UnknownRow,
  type UpdateQueryNode,
} from 'kysely';

// Tenant isolation layer 2 (TRD §6.1, TR-TEN-03): walks every query tree and adds `<alias>.tenant_id = ?`
// for every tenant table in FROM, JOIN, UPDATE and DELETE, including sub-queries, CTEs and UNIONs;
// checks that INSERT rows carry the context's tenant; rejects any query it cannot scope.

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(`TenantScopePlugin: ${message}`);
    this.name = 'TenantScopeError';
  }
}

/**
 * Tenant tables where a scoped upsert is safe because every unique key belongs to a single tenant (L-11):
 * report_daily's primary key starts with tenant_id; alert_deliveries' is (ticket_id, …) and a ticket belongs to
 * one tenant. Add a table only after checking all of its unique keys.
 */
export const UPSERT_SAFE_TABLES: ReadonlySet<string> = new Set(['report_daily', 'alert_deliveries']);

/** Marker placed in raw SQL built by `scopedSql`; raw fragments naming a tenant table must carry it. */
export const SCOPED_RAW_MARKER = '/*tenant-scoped*/';

/** Nodes already scoped, with their tenant; nested builders are transformed before their parent sees them. */
const scoped = new WeakMap<object, string>();

interface TableRef {
  table: string;
  ref: string; // alias, or table name when not aliased
}

function tableRefOf(node: OperationNode): TableRef | null {
  if (node.kind === 'TableNode') {
    const name = (node as TableNode).table.identifier.name;
    return { table: name, ref: name };
  }
  if (node.kind === 'AliasNode') {
    const a = node as AliasNode;
    if (a.node.kind === 'TableNode') {
      const name = (a.node as TableNode).table.identifier.name;
      const alias = a.alias.kind === 'IdentifierNode' ? (a.alias as IdentifierNode).name : null;
      if (!alias) throw new TenantScopeError(`unsupported alias on ${name}`);
      return { table: name, ref: alias };
    }
  }
  return null; // sub-query or other source: scoped by recursion
}

class ScopeTransformer extends OperationNodeTransformer {
  constructor(
    private readonly tenantId: string,
    private readonly tenantTables: ReadonlySet<string>,
  ) {
    super();
  }

  private already<T extends object>(node: T): T | null {
    const owner = scoped.get(node);
    if (owner === undefined) return null;
    if (owner !== this.tenantId) throw new TenantScopeError('query mixes builders scoped to different tenants');
    return node;
  }

  private mark<T extends object>(node: T): T {
    const frozen = Object.freeze(node);
    scoped.set(frozen, this.tenantId);
    return frozen;
  }

  private predicate(ref: string): OperationNode {
    return BinaryOperationNode.create(
      ReferenceNode.create(ColumnNode.create('tenant_id'), TableNode.create(ref)),
      OperatorNode.create('='),
      ValueNode.create(this.tenantId),
    );
  }

  private and(predicates: OperationNode[]): OperationNode {
    return predicates.reduce((acc, p) => AndNode.create(acc, p));
  }

  private withWhere(where: WhereNode | undefined, predicates: OperationNode[]): WhereNode | undefined {
    if (predicates.length === 0) return where;
    const extra = this.and(predicates);
    // Parenthesise the existing filter so `a OR b` cannot escape the tenant predicate.
    return where ? WhereNode.create(AndNode.create(ParensNode.create(where.where), extra)) : WhereNode.create(extra);
  }

  private scopeFroms(froms: ReadonlyArray<OperationNode>): OperationNode[] {
    const preds: OperationNode[] = [];
    for (const f of froms) {
      if (f.kind === 'ListNode') throw new TenantScopeError('list sources are not supported');
      const r = tableRefOf(f);
      if (r && this.tenantTables.has(r.table)) preds.push(this.predicate(r.ref));
    }
    return preds;
  }

  private scopeJoins(joins: ReadonlyArray<JoinNode> | undefined): ReadonlyArray<JoinNode> | undefined {
    if (!joins) return joins;
    return joins.map((j) => {
      const r = tableRefOf(j.table);
      if (!r || !this.tenantTables.has(r.table)) return j;
      if (!j.on) {
        if (j.joinType === 'CrossJoin') throw new TenantScopeError(`cross join on tenant table ${r.table}`);
        return JoinNode.createWithOn(j.joinType, j.table, this.predicate(r.ref));
      }
      // Join condition, not WHERE, so LEFT JOINs keep their meaning.
      return JoinNode.cloneWithOn(j, this.predicate(r.ref));
    });
  }

  protected override transformSelectQuery(node: SelectQueryNode): SelectQueryNode {
    const done = this.already(node);
    if (done) return done;
    const t = super.transformSelectQuery(node);
    const preds = t.from ? this.scopeFroms(t.from.froms) : [];
    return this.mark({ ...t, joins: this.scopeJoins(t.joins), where: this.withWhere(t.where, preds) });
  }

  protected override transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    const done = this.already(node);
    if (done) return done;
    const t = super.transformUpdateQuery(node);
    const tables: OperationNode[] = [];
    if (t.table) {
      if (t.table.kind === 'ListNode') tables.push(...(t.table as unknown as { items: OperationNode[] }).items);
      else tables.push(t.table);
    }
    if (t.from) tables.push(...t.from.froms);
    const preds = this.scopeFroms(tables);
    return this.mark({ ...t, joins: this.scopeJoins(t.joins), where: this.withWhere(t.where, preds) });
  }

  protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
    const done = this.already(node);
    if (done) return done;
    const t = super.transformDeleteQuery(node);
    const preds = [...this.scopeFroms(t.from.froms), ...(t.using ? this.scopeFroms(t.using.tables) : [])];
    return this.mark({ ...t, joins: this.scopeJoins(t.joins), where: this.withWhere(t.where, preds) });
  }

  protected override transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    const t = super.transformInsertQuery(node);
    const table = t.into?.table.identifier.name;
    if (!table || !this.tenantTables.has(table)) return t;
    const cols = (t.columns ?? []).map((c) => c.column.name);
    const idx = cols.indexOf('tenant_id');
    if (idx < 0) throw new TenantScopeError(`insert into ${table} without tenant_id`);
    if (!t.values || t.values.kind !== 'ValuesNode') throw new TenantScopeError(`insert into ${table} must use VALUES`);
    for (const row of (t.values as unknown as { values: OperationNode[] }).values) {
      let v: unknown;
      if (row.kind === 'PrimitiveValueListNode') v = (row as unknown as { values: unknown[] }).values[idx];
      else if (row.kind === 'ValueListNode') {
        const n = (row as unknown as { values: OperationNode[] }).values[idx];
        v = n && n.kind === 'ValueNode' ? (n as ValueNode).value : undefined;
      }
      if (v !== this.tenantId) throw new TenantScopeError(`insert into ${table} with a foreign tenant_id`);
    }
    // ON DUPLICATE KEY UPDATE fires on whichever unique key collides, possibly another tenant's row (L-11). It is
    // allowed only on tables whose every unique key belongs to one tenant, and never moves a row between tenants.
    if (t.onDuplicateKey) {
      if (!UPSERT_SAFE_TABLES.has(table)) throw new TenantScopeError(`upsert into ${table}: a unique key may match another tenant's row`);
      if (t.onDuplicateKey.updates.some((u) => u.column.kind === 'ColumnNode' && (u.column as ColumnNode).column.name === 'tenant_id')) throw new TenantScopeError(`upsert into ${table} may not change tenant_id`);
    }
    return t;
  }

  protected override transformRaw(node: RawNode): RawNode {
    const t = super.transformRaw(node);
    const text = t.sqlFragments.join(' ');
    if (text.includes(SCOPED_RAW_MARKER)) return t;
    for (const p of t.parameters) {
      const r = tableRefOf(p);
      if (r && this.tenantTables.has(r.table)) {
        throw new TenantScopeError(`raw SQL references tenant table ${r.table}; build it with scopedSql()`);
      }
    }
    for (const name of this.tenantTables) {
      if (new RegExp(`\\b${name}\\b`).test(text)) {
        throw new TenantScopeError(`raw SQL references tenant table ${name}; build it with scopedSql()`);
      }
    }
    return t;
  }
}

export class TenantScopePlugin implements KyselyPlugin {
  private readonly transformer: ScopeTransformer;

  constructor(
    readonly tenantId: string,
    tenantTables: ReadonlySet<string>,
  ) {
    if (!tenantId) throw new TenantScopeError('missing tenant id');
    this.transformer = new ScopeTransformer(tenantId, tenantTables);
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.transformer.transformNode(args.node);
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}
