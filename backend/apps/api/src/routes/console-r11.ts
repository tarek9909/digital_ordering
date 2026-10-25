import { requireFreshMfa } from '@dop/auth';
import {
  AppError,
  changePlanBody,
  flagOverrideBody,
  freeMonthsBody,
  legalDocumentBody,
  noteBody,
  planCreateBody,
  planPatch,
  priceCreateBody,
  recordPaymentBody,
  supportCodeBody,
  supportRequestBody,
  transferOwnershipPlatformBody,
  uuidSchema,
  dateRange,
} from '@dop/contracts';
import {
  addNote,
  addPrice,
  changePlan,
  createLegalDocument,
  currentLegalDocument,
  createPlan,
  deactivatePrice,
  emergencySupport,
  endSupport,
  enterSupport,
  grantFreeMonths,
  listFlags,
  listLegalDocuments,
  listNotes,
  listPlanOptions,
  listPlans,
  listSupportSessions,
  platformReport,
  platformTransferOwnership,
  publishLegalDocument,
  pushKeyStatus,
  recordPayment,
  requestSupport,
  setFlagOverride,
  signOutVenueDevices,
  updatePlan,
  verifySupportCode,
} from '@dop/services';
import { z } from 'zod';
import { defineRoutes, route, type Ctx } from '../http/router.js';

// Console API, R1.1 additions (TRD §12.8).

const idP = z.object({ id: uuidSchema }).strict();
function pa(c: Ctx) {
  if (c.actor.kind !== 'platform') throw new AppError('UNAUTHENTICATED');
  return c.actor;
}
const dateQ = dateRange({});

export const consoleR11Routes = defineRoutes('/api/console/v1', [
  // Notes (FR-SA-15)
  route({ method: 'get', path: '/tenants/:id/notes', surfaces: ['console'], permission: 'console.notes', params: idP, handler: async (c) => ({ items: await listNotes(c.deps, c.params.id) }) }),
  route({ method: 'post', path: '/tenants/:id/notes', surfaces: ['console'], permission: 'console.notes', params: idP, body: noteBody, status: 201, handler: async (c) => addNote(c.deps, pa(c), c.params.id, c.body.body) }),

  // Support access (FR-SUP-02 – FR-SUP-06)
  route({ method: 'get', path: '/tenants/:id/support-sessions', surfaces: ['console'], permission: 'console.support', params: idP, handler: async (c) => ({ items: await listSupportSessions(c.deps, c.params.id) }) }),
  route({ method: 'post', path: '/tenants/:id/support-sessions', surfaces: ['console'], permission: 'console.support', params: idP, body: supportRequestBody, status: 201, handler: async (c) => requestSupport(c.deps, pa(c), c.params.id, c.body.reason, c.body.durationMinutes) }),
  route({
    method: 'post',
    path: '/tenants/:id/support-sessions/emergency',
    surfaces: ['console'],
    permission: 'console.support.emergency',
    params: idP,
    body: z.object({ reason: z.string().trim().min(10).max(500), confirm: z.string().max(60) }).strict(),
    status: 201,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now());
      return emergencySupport(c.deps, pa(c), c.params.id, c.body.reason, c.body.confirm);
    },
  }),
  route({
    method: 'post',
    path: '/support-sessions/:id/verify-code',
    surfaces: ['console'],
    permission: 'console.support',
    params: idP,
    body: supportCodeBody,
    rateLimit: { name: 'supcode-verify', points: 5, durationSec: 600, key: 'actor' },
    handler: async (c) => {
      await verifySupportCode(c.deps, pa(c), c.params.id, c.body.code);
    },
  }),
  route({ method: 'post', path: '/support-sessions/:id/enter', surfaces: ['console'], permission: 'console.support', params: idP, handler: async (c) => enterSupport(c.deps, pa(c), c.params.id, c.userAgent) }),
  route({
    method: 'post',
    path: '/support-sessions/:id/end',
    surfaces: ['console'],
    permission: 'console.support',
    params: idP,
    handler: async (c) => {
      await endSupport(c.deps, pa(c), c.params.id, 'platform');
    },
  }),

  // Commercial (FR-SA-07, FR-SA-10)
  route({
    method: 'post',
    path: '/tenants/:id/plan',
    surfaces: ['console'],
    permission: 'console.commercial',
    params: idP,
    body: changePlanBody,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // changes what the tenant pays and can use (L-6)
      return changePlan(c.deps, pa(c), c.params.id, c.body.planCode);
    },
  }),
  // Offline payment (cash, transfer, wallet): extends the paid-until date and lifts past due or a billing suspension.
  route({
    method: 'post',
    path: '/tenants/:id/payments',
    surfaces: ['console'],
    permission: 'console.commercial',
    params: idP,
    body: recordPaymentBody,
    status: 201,
    handler: async (c) => {
      // Extends paid access, so it needs a recent second factor like other privilege changes (L-6).
      requireFreshMfa(pa(c), c.deps.now());
      return recordPayment(c.deps, pa(c), c.params.id, c.body);
    },
  }),
  route({
    method: 'post',
    path: '/tenants/:id/free-months',
    surfaces: ['console'],
    permission: 'console.commercial',
    params: idP,
    body: freeMonthsBody,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // free paid time (L-6)
      await grantFreeMonths(c.deps, pa(c), c.params.id, c.body.months, c.body.requestId);
    },
  }),
  route({ method: 'get', path: '/plans', surfaces: ['console'], permission: 'console.settings', handler: async (c) => ({ items: await listPlans(c.deps) }) }),
  // Codes and names only, for the tenant list's plan filter: every role that can list tenants (AS10).
  route({ method: 'get', path: '/plan-options', surfaces: ['console'], permission: 'console.tenants.read', handler: async (c) => ({ items: await listPlanOptions(c.deps) }) }),
  route({ method: 'post', path: '/plans', surfaces: ['console'], permission: 'console.settings', body: planCreateBody, status: 201, handler: async (c) => createPlan(c.deps, pa(c), c.body) }),
  route({
    method: 'patch',
    path: '/plans/:id',
    surfaces: ['console'],
    permission: 'console.settings',
    params: idP,
    body: planPatch,
    handler: async (c) => {
      await updatePlan(c.deps, pa(c), c.params.id, c.body);
    },
  }),
  route({ method: 'post', path: '/plans/:id/prices', surfaces: ['console'], permission: 'console.settings', params: idP, body: priceCreateBody, status: 201, handler: async (c) => addPrice(c.deps, pa(c), c.params.id, c.body) }),
  route({
    method: 'post',
    path: '/prices/:id/deactivate',
    surfaces: ['console'],
    permission: 'console.settings',
    params: idP,
    handler: async (c) => {
      await deactivatePrice(c.deps, c.params.id);
    },
  }),

  // Feature flags (FR-SA-11)
  route({ method: 'get', path: '/feature-flags', surfaces: ['console'], permission: 'console.settings', query: z.object({ tenantId: uuidSchema.optional() }).strict(), handler: async (c) => ({ items: await listFlags(c.deps, c.query.tenantId) }) }),
  route({
    method: 'put',
    path: '/tenants/:id/feature-flags/:key',
    surfaces: ['console'],
    permission: 'console.settings',
    params: z.object({ id: uuidSchema, key: z.string().min(1).max(60) }).strict(),
    body: flagOverrideBody,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // unlocks paid features (L-6)
      await setFlagOverride(c.deps, pa(c), c.params.id, c.params.key, c.body.enabled);
    },
  }),
  route({
    method: 'delete',
    path: '/tenants/:id/feature-flags/:key',
    surfaces: ['console'],
    permission: 'console.settings',
    params: z.object({ id: uuidSchema, key: z.string().min(1).max(60) }).strict(),
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now());
      await setFlagOverride(c.deps, pa(c), c.params.id, c.params.key, null);
    },
  }),

  // Ownership (FR-SA-08), devices (FR-SA-16)
  route({
    method: 'post',
    path: '/tenants/:id/transfer-ownership',
    surfaces: ['console'],
    permission: 'console.ownership',
    params: idP,
    body: transferOwnershipPlatformBody,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now());
      await platformTransferOwnership(c.deps, pa(c), c.params.id, c.body.email, c.body.verificationNote);
    },
  }),
  route({
    method: 'post',
    path: '/venues/:id/signout-devices',
    surfaces: ['console'],
    permission: 'console.devices',
    params: idP,
    handler: async (c) => {
      await signOutVenueDevices(c.deps, pa(c), c.params.id);
    },
  }),

  // Legal documents, email texts, push key status (FR-SA-12)
  route({ method: 'get', path: '/legal-documents', surfaces: ['console'], permission: 'console.settings', handler: async (c) => ({ items: await listLegalDocuments(c.deps) }) }),
  // The text currently published for every document and language, so the console can edit them in place.
  route({
    method: 'get',
    path: '/legal-documents/current',
    surfaces: ['console'],
    permission: 'console.settings',
    handler: async (c) => {
      const items: { kind: string; locale: string; html: string; version: string | null }[] = [];
      for (const kind of legalDocumentBody.shape.kind.options) {
        for (const locale of ['ar', 'en'] as const) {
          const doc = await currentLegalDocument(c.deps, kind, locale);
          if (!doc || doc.locale !== locale) {
            items.push({ kind, locale, html: '', version: null });
            continue;
          }
          const body = await c.deps.storage.get('assets', doc.content_key).catch(() => null);
          items.push({ kind, locale, html: body ? body.toString('utf8') : '', version: doc.version });
        }
      }
      return { items };
    },
  }),
  route({ method: 'post', path: '/legal-documents', surfaces: ['console'], permission: 'console.settings', body: legalDocumentBody, status: 201, handler: async (c) => createLegalDocument(c.deps, c.deps.storage, pa(c), c.body) }),
  route({
    method: 'post',
    path: '/legal-documents/:id/publish',
    surfaces: ['console'],
    permission: 'console.settings',
    params: idP,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // every tenant user must accept it (L-6)
      await publishLegalDocument(c.deps, pa(c), c.params.id);
    },
  }),
  route({ method: 'get', path: '/push-keys/status', surfaces: ['console'], permission: 'console.settings', handler: async (c) => pushKeyStatus(c.deps) }),

  // Platform reports (FR-RPT-07)
  route({ method: 'get', path: '/reports/platform', surfaces: ['console'], permission: 'console.reports', query: dateQ, handler: async (c) => platformReport(c.deps, c.query.from, c.query.to) }),
]);
