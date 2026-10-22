import { AppError, dateRange, slugChangeBody, uuidSchema } from '@dop/contracts';
import { announcementsFor, approveSupport, changeSlug, createSupportCode, endSupport, heatmapReport, listSupportSessions, pendingLegalAcceptance, acceptLegal, refuseSupport, trendsReport, } from '@dop/services';
import { z } from 'zod';
import { defineRoutes, route } from '../http/router.js';
// Tenant admin API, R1.1 additions (TRD §12.7): support requests, announcements, plan change, slug change,
// trends and heatmap reports, legal re-acceptance.
const idP = z.object({ id: uuidSchema }).strict();
const rangeQuery = dateRange({ venueId: uuidSchema.optional(), counterId: uuidSchema.optional() });
function user(c) {
    if (c.actor.kind !== 'user')
        throw new AppError('FORBIDDEN');
    return c.actor;
}
function tenantId(c) {
    if (c.actor.kind !== 'user' && c.actor.kind !== 'support')
        throw new AppError('UNAUTHENTICATED');
    return c.actor.tenantId;
}
export const adminR11Routes = defineRoutes('/api/admin/v1', [
    // Support access (FR-ADM-14, FR-SUP-02/03): owners and managers only — support actors cannot approve (TR-AUTH-10).
    route({ method: 'get', path: '/support-sessions', surfaces: ['tenant'], permission: 'reports.view', limitedAccessOk: true, handler: async (c) => ({ items: await listSupportSessions(c.deps, tenantId(c)) }) }),
    route({
        method: 'post',
        path: '/support-sessions/:id/approve',
        surfaces: ['tenant'],
        permission: 'support.decide',
        params: idP,
        limitedAccessOk: true,
        tenantResource: true,
        handler: async (c) => {
            await approveSupport(c.deps, user(c), c.params.id);
        },
    }),
    route({
        method: 'post',
        path: '/support-sessions/:id/refuse',
        surfaces: ['tenant'],
        permission: 'support.decide',
        params: idP,
        limitedAccessOk: true,
        tenantResource: true,
        handler: async (c) => {
            await refuseSupport(c.deps, user(c), c.params.id);
        },
    }),
    route({
        method: 'post',
        path: '/support-sessions/:id/end',
        surfaces: ['tenant'],
        permission: 'support.decide',
        params: idP,
        limitedAccessOk: true,
        tenantResource: true,
        handler: async (c) => {
            await endSupport(c.deps, user(c), c.params.id, 'tenant', user(c).tenantId);
        },
    }),
    route({
        method: 'post',
        path: '/support-codes',
        surfaces: ['tenant'],
        permission: 'support.decide',
        limitedAccessOk: true,
        rateLimit: { name: 'supcode', points: 10, durationSec: 3600, key: 'actor' },
        handler: async (c) => createSupportCode(c.deps, user(c)),
    }),
    route({ method: 'get', path: '/announcements', surfaces: ['tenant'], permission: 'announcements.read', limitedAccessOk: true, handler: async (c) => ({ items: await announcementsFor(c.deps, tenantId(c)) }) }),
    // Slug change with 180-day redirect (TR-URL-03); owner only.
    route({
        method: 'post',
        path: '/tenant/slug',
        surfaces: ['tenant'],
        permission: 'tenant.delete',
        body: slugChangeBody,
        rateLimit: { name: 'slug-change', points: 3, durationSec: 86400, key: 'actor' },
        handler: async (c) => changeSlug(c.deps, user(c), user(c).tenantId, c.body.slug.toLowerCase(), c.body.password),
    }),
    // Reports (FR-RPT-02/03/04 filters).
    route({ method: 'get', path: '/reports/trends', surfaces: ['tenant'], permission: 'reports.view', query: rangeQuery, handler: async (c) => trendsReport(c.deps, tenantId(c), c.query) }),
    route({ method: 'get', path: '/reports/heatmap', surfaces: ['tenant'], permission: 'reports.view', query: rangeQuery, handler: async (c) => heatmapReport(c.deps, tenantId(c), c.query) }),
    // New legal versions need re-acceptance (TR-PRV-09).
    route({ method: 'get', path: '/legal/pending', surfaces: ['tenant'], permission: 'account.self', limitedAccessOk: true, handler: async (c) => ({ items: await pendingLegalAcceptance(c.deps, user(c).tenantId, user(c).userId) }) }),
    route({
        method: 'post',
        path: '/legal/accept',
        surfaces: ['tenant'],
        permission: 'account.self',
        limitedAccessOk: true,
        body: z.object({ documentIds: z.array(uuidSchema).min(1).max(5) }).strict(),
        handler: async (c) => {
            await acceptLegal(c.deps, user(c).tenantId, user(c).userId, c.body.documentIds, c.ip);
        },
    }),
]);
