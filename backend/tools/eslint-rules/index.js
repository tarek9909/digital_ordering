// Custom lint rules for tenant isolation, layer 4 (TRD §6.1, TR-TEN-04, TR-TEN-07, TR-SEC-04).

const TENANT_ROUTE_DIRS = /apps[\\/]api[\\/]src[\\/]routes[\\/](public|staff|display|admin|v1)\.ts$/;

/** TR-TEN-07: tenant route modules may not reach the platform (cross-tenant) client. */
const requireTenantClient = {
  meta: { type: 'problem', docs: { description: 'Tenant routes must use db.forTenant(), never db.platform()' }, schema: [] },
  create(context) {
    const file = context.filename ?? context.getFilename();
    if (!TENANT_ROUTE_DIRS.test(file)) return {};
    return {
      CallExpression(node) {
        const c = node.callee;
        if (c.type === 'MemberExpression' && c.property.type === 'Identifier' && c.property.name === 'platform') {
          // Exception: platform tables that hold no tenant data and are read through deps.db.platform() for
          // global identities (users, tenants) must be marked explicitly.
          const comments = context.sourceCode.getCommentsBefore(node.parent?.parent ?? node);
          if (comments.some((cm) => cm.value.includes('platform-table-only'))) return;
          context.report({ node, message: 'Tenant route uses the platform client; use deps.db.forTenant(tenantId) (TR-TEN-07).' });
        }
      },
    };
  },
};

/** TR-TEN-04 / TR-SEC-04: no sql.raw() and no string-built SQL outside packages/db. */
const noUnscopedRawSql = {
  meta: { type: 'problem', docs: { description: 'Forbid sql.raw and string concatenation into sql templates' }, schema: [] },
  create(context) {
    const file = context.filename ?? context.getFilename();
    const inDb = /packages[\\/]db[\\/]src/.test(file);
    return {
      CallExpression(node) {
        const c = node.callee;
        if (!inDb && c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'sql' && c.property.type === 'Identifier' && c.property.name === 'raw') {
          context.report({ node, message: 'sql.raw() is only allowed inside packages/db (TR-TEN-04).' });
        }
      },
      TaggedTemplateExpression(node) {
        if (node.tag.type !== 'Identifier' || node.tag.name !== 'sql') return;
        for (const e of node.quasi.expressions) {
          if (e.type === 'BinaryExpression' && e.operator === '+') context.report({ node: e, message: 'Do not build SQL by concatenation (TR-SEC-04).' });
        }
        const text = node.quasi.quasis.map((q) => q.value.raw).join('?');
        const tenantTable = /\b(FROM|JOIN|UPDATE|INTO)\s+(tickets|ticket_events|ticket_followers|venues|counters|staff_devices|displays|ratings|claim_requests|report_daily)\b/i;
        // Only the global push_subscriptions join is exempt; a bare "ps" alias test matched any word ending in ps (I-11).
        if (tenantTable.test(text) && !/tenant_id/.test(text) && !/\bpush_subscriptions\b/.test(text)) {
          context.report({ node, message: 'Raw SQL on a tenant table must include a tenant_id predicate (TR-TEN-04).' });
        }
      },
    };
  },
};

export default { rules: { 'require-tenant-client': requireTenantClient, 'no-unscoped-raw-sql': noUnscopedRawSql } };
