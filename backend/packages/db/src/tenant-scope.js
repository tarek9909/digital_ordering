import { AndNode, BinaryOperationNode, ColumnNode, JoinNode, OperationNodeTransformer, OperatorNode, ParensNode, ReferenceNode, TableNode, ValueNode, WhereNode, } from 'kysely';
// Tenant isolation layer 2 (TRD §6.1, TR-TEN-03): walks every query tree and adds `<alias>.tenant_id = ?`
// for every tenant table in FROM, JOIN, UPDATE and DELETE, including sub-queries, CTEs and UNIONs;
// checks that INSERT rows carry the context's tenant; rejects any query it cannot scope.
export class TenantScopeError extends Error {
    constructor(message) {
        super(`TenantScopePlugin: ${message}`);
        this.name = 'TenantScopeError';
    }
}
/**
 * Tenant tables where a scoped upsert is safe because every unique key belongs to a single tenant (L-11):
 * report_daily's primary key starts with tenant_id; alert_deliveries' is (ticket_id, …) and a ticket belongs to
 * one tenant. Add a table only after checking all of its unique keys.
 */
export const UPSERT_SAFE_TABLES = new Set(['report_daily', 'alert_deliveries']);
/** Marker placed in raw SQL built by `scopedSql`; raw fragments naming a tenant table must carry it. */
export const SCOPED_RAW_MARKER = '/*tenant-scoped*/';
/** Nodes already scoped, with their tenant; nested builders are transformed before their parent sees them. */
const scoped = new WeakMap();
function tableRefOf(node) {
    if (node.kind === 'TableNode') {
        const name = node.table.identifier.name;
        return { table: name, ref: name };
    }
    if (node.kind === 'AliasNode') {
        const a = node;
        if (a.node.kind === 'TableNode') {
            const name = a.node.table.identifier.name;
            const alias = a.alias.kind === 'IdentifierNode' ? a.alias.name : null;
            if (!alias)
                throw new TenantScopeError(`unsupported alias on ${name}`);
            return { table: name, ref: alias };
        }
    }
    return null; // sub-query or other source: scoped by recursion
}
class ScopeTransformer extends OperationNodeTransformer {
    tenantId;
    tenantTables;
    constructor(tenantId, tenantTables) {
        super();
        this.tenantId = tenantId;
        this.tenantTables = tenantTables;
    }
    already(node) {
        const owner = scoped.get(node);
        if (owner === undefined)
            return null;
        if (owner !== this.tenantId)
            throw new TenantScopeError('query mixes builders scoped to different tenants');
        return node;
    }
    mark(node) {
        const frozen = Object.freeze(node);
        scoped.set(frozen, this.tenantId);
        return frozen;
    }
    predicate(ref) {
        return BinaryOperationNode.create(ReferenceNode.create(ColumnNode.create('tenant_id'), TableNode.create(ref)), OperatorNode.create('='), ValueNode.create(this.tenantId));
    }
    and(predicates) {
        return predicates.reduce((acc, p) => AndNode.create(acc, p));
    }
    withWhere(where, predicates) {
        if (predicates.length === 0)
            return where;
        const extra = this.and(predicates);
        // Parenthesise the existing filter so `a OR b` cannot escape the tenant predicate.
        return where ? WhereNode.create(AndNode.create(ParensNode.create(where.where), extra)) : WhereNode.create(extra);
    }
    scopeFroms(froms) {
        const preds = [];
        for (const f of froms) {
            if (f.kind === 'ListNode')
                throw new TenantScopeError('list sources are not supported');
            const r = tableRefOf(f);
            if (r && this.tenantTables.has(r.table))
                preds.push(this.predicate(r.ref));
        }
        return preds;
    }
    scopeJoins(joins) {
        if (!joins)
            return joins;
        return joins.map((j) => {
            const r = tableRefOf(j.table);
            if (!r || !this.tenantTables.has(r.table))
                return j;
            if (!j.on) {
                if (j.joinType === 'CrossJoin')
                    throw new TenantScopeError(`cross join on tenant table ${r.table}`);
                return JoinNode.createWithOn(j.joinType, j.table, this.predicate(r.ref));
            }
            // Join condition, not WHERE, so LEFT JOINs keep their meaning.
            return JoinNode.cloneWithOn(j, this.predicate(r.ref));
        });
    }
    transformSelectQuery(node) {
        const done = this.already(node);
        if (done)
            return done;
        const t = super.transformSelectQuery(node);
        const preds = t.from ? this.scopeFroms(t.from.froms) : [];
        return this.mark({ ...t, joins: this.scopeJoins(t.joins), where: this.withWhere(t.where, preds) });
    }
    transformUpdateQuery(node) {
        const done = this.already(node);
        if (done)
            return done;
        const t = super.transformUpdateQuery(node);
        const tables = [];
        if (t.table) {
            if (t.table.kind === 'ListNode')
                tables.push(...t.table.items);
            else
                tables.push(t.table);
        }
        if (t.from)
            tables.push(...t.from.froms);
        const preds = this.scopeFroms(tables);
        return this.mark({ ...t, joins: this.scopeJoins(t.joins), where: this.withWhere(t.where, preds) });
    }
    transformDeleteQuery(node) {
        const done = this.already(node);
        if (done)
            return done;
        const t = super.transformDeleteQuery(node);
        const preds = [...this.scopeFroms(t.from.froms), ...(t.using ? this.scopeFroms(t.using.tables) : [])];
        return this.mark({ ...t, joins: this.scopeJoins(t.joins), where: this.withWhere(t.where, preds) });
    }
    transformInsertQuery(node) {
        const t = super.transformInsertQuery(node);
        const table = t.into?.table.identifier.name;
        if (!table || !this.tenantTables.has(table))
            return t;
        const cols = (t.columns ?? []).map((c) => c.column.name);
        const idx = cols.indexOf('tenant_id');
        if (idx < 0)
            throw new TenantScopeError(`insert into ${table} without tenant_id`);
        if (!t.values || t.values.kind !== 'ValuesNode')
            throw new TenantScopeError(`insert into ${table} must use VALUES`);
        for (const row of t.values.values) {
            let v;
            if (row.kind === 'PrimitiveValueListNode')
                v = row.values[idx];
            else if (row.kind === 'ValueListNode') {
                const n = row.values[idx];
                v = n && n.kind === 'ValueNode' ? n.value : undefined;
            }
            if (v !== this.tenantId)
                throw new TenantScopeError(`insert into ${table} with a foreign tenant_id`);
        }
        // ON DUPLICATE KEY UPDATE fires on whichever unique key collides, possibly another tenant's row (L-11). It is
        // allowed only on tables whose every unique key belongs to one tenant, and never moves a row between tenants.
        if (t.onDuplicateKey) {
            if (!UPSERT_SAFE_TABLES.has(table))
                throw new TenantScopeError(`upsert into ${table}: a unique key may match another tenant's row`);
            if (t.onDuplicateKey.updates.some((u) => u.column.kind === 'ColumnNode' && u.column.column.name === 'tenant_id'))
                throw new TenantScopeError(`upsert into ${table} may not change tenant_id`);
        }
        return t;
    }
    transformRaw(node) {
        const t = super.transformRaw(node);
        const text = t.sqlFragments.join(' ');
        if (text.includes(SCOPED_RAW_MARKER))
            return t;
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
export class TenantScopePlugin {
    tenantId;
    transformer;
    constructor(tenantId, tenantTables) {
        this.tenantId = tenantId;
        if (!tenantId)
            throw new TenantScopeError('missing tenant id');
        this.transformer = new ScopeTransformer(tenantId, tenantTables);
    }
    transformQuery(args) {
        return this.transformer.transformNode(args.node);
    }
    async transformResult(args) {
        return args.result;
    }
}
