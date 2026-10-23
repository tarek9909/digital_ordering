import { can } from '@dop/auth';
import {
  AppError,
  changePasswordBody,
  changeEmailBody,
  memberPreferencesBody,
  counterCreateBody,
  counterPatch,
  deletionRequestBody,
  displayCreateBody,
  displayPatch,
  invitationBody,
  memberCreateBody,
  mePatch,
  ownershipTransferBody,
  reportRangeQuery,
  staffPinBody,
  tenantPatch,
  uuidSchema,
  venueMessagesBody,
  venuePatch,
  venueSettingsBody,
} from '@dop/contracts';
import {
  addMember,
  archiveCounter,
  billingOverview,
  cancelDeletion,
  createCounter,
  deleteRatingComment,
  listCounters,
  listRatings,
  ratingSummary,
  updateCounter,
  changePassword,
  listChimes,
  requestEmailChange,
  setMemberPreferences,
  createDisplay,
  downloadExport,
  exportStatus,
  getVenueAdmin,
  inviteMember,
  issuePairingCode,
  listDevices,
  listDisplays,
  listMembers,
  listVenues,
  onboarding,
  pilotReport,
  posterPdf,
  putVenueMessages,
  putVenueSettings,
  removeDevice,
  removeMember,
  requestDeletion,
  requestExport,
  revokeInvitation,
  rotateStaffLink,
  setStaffPin,
  staffAccessInfo,
  tenantActivity,
  todayReport,
  touchTenantActivity,
  transferOwnership,
  unpairDisplay,
  updateDisplay,
  updateVenue,
  getTenantSettings,
  patchTenant,
  updateMe,
  uploadLogo,
} from '@dop/services';
import express from 'express';
import { z } from 'zod';
import { defineRoutes, route, type Ctx } from '../http/router.js';

// Tenant admin API (TRD §12.7), MVP scope. Roles per §14.2; limitedAccessOk marks the sections a suspended,
// expired or cancelled tenant still reaches (billing, export, team, account).

const idP = z.object({ id: uuidSchema }).strict();
const venueIdQuery = z.object({ venueId: uuidSchema }).strict();
const adminLimit = { name: 'admin', points: 20, durationSec: 1, key: 'actor' as const };

type UserActor = Extract<Ctx['actor'], { kind: 'user' }>;
type TenantActor = Extract<Ctx['actor'], { kind: 'user' | 'support' }>;

function tenantActor(c: Ctx): TenantActor {
  if (c.actor.kind !== 'user' && c.actor.kind !== 'support') throw new AppError('UNAUTHENTICATED');
  void touchTenantActivity(c.deps, c.actor.tenantId);
  return c.actor;
}
function userActor(c: Ctx): UserActor {
  if (c.actor.kind !== 'user') throw new AppError('FORBIDDEN');
  return c.actor;
}

export const adminRoutes = defineRoutes('/api/admin/v1', [
  // ---- tenant
  route({
    method: 'get',
    path: '/tenant',
    surfaces: ['tenant'],
    permission: 'account.self',
    limitedAccessOk: true,
    handler: async (c) => getTenantSettings(c.deps, tenantActor(c).tenantId),
  }),
  route({
    method: 'patch',
    path: '/tenant',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    body: tenantPatch,
    handler: async (c) => {
      // Billing details are the owner's (L-10): managers and support sessions may rename, not change invoicing.
      if ((c.body.billingEmail !== undefined || c.body.taxId !== undefined) && !can(c.actor, 'billing.manage')) throw new AppError('FORBIDDEN');
      await patchTenant(c.deps, tenantActor(c), tenantActor(c).tenantId, c.body, c.requestId);
    },
  }),
  route({
    method: 'post',
    path: '/tenant/deletion',
    surfaces: ['tenant'],
    permission: 'tenant.delete',
    body: deletionRequestBody,
    limitedAccessOk: true,
    rateLimit: { name: 'tenant-deletion', points: 5, durationSec: 3600, key: 'actor' },
    handler: async (c) => requestDeletion(c.deps, userActor(c), userActor(c).tenantId, c.body.password),
  }),
  route({
    method: 'delete',
    path: '/tenant/deletion',
    surfaces: ['tenant'],
    permission: 'tenant.delete',
    limitedAccessOk: true,
    handler: async (c) => {
      await cancelDeletion(c.deps, userActor(c), userActor(c).tenantId);
    },
  }),
  route({
    method: 'get',
    path: '/onboarding',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    handler: async (c) => onboarding(c.deps, userActor(c).tenantId, userActor(c).userId),
  }),
  route({
    method: 'get',
    path: '/activity',
    surfaces: ['tenant'],
    permission: 'reports.view',
    handler: async (c) => ({ items: await tenantActivity(c.deps, tenantActor(c).tenantId) }),
  }),

  // ---- venues
  route({ method: 'get', path: '/venues', surfaces: ['tenant'], permission: 'venue.settings', handler: async (c) => ({ items: await listVenues(c.deps, tenantActor(c).tenantId) }) }),
  route({
    method: 'get',
    path: '/venues/:id',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    tenantResource: true,
    handler: async (c) => getVenueAdmin(c.deps, tenantActor(c).tenantId, c.params.id),
  }),
  route({
    method: 'patch',
    path: '/venues/:id',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    body: venuePatch,
    rateLimit: adminLimit,
    tenantResource: true,
    handler: async (c) => updateVenue(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, c.body, c.requestId),
  }),
  route({
    method: 'put',
    path: '/venues/:id/messages',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    body: venueMessagesBody,
    tenantResource: true,
    handler: async (c) => putVenueMessages(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, c.body),
  }),
  route({
    method: 'put',
    path: '/venues/:id/settings',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    body: venueSettingsBody,
    tenantResource: true,
    handler: async (c) => putVenueSettings(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, c.body),
  }),
  route({
    method: 'post',
    path: '/venues/:id/logo',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    rateLimit: { name: 'logo', points: 10, durationSec: 600, key: 'actor' },
    tenantResource: true,
    handler: async (c) => {
      // Ownership first, so another tenant's venue is a 404 whatever the body (TR-TEN-08).
      await getVenueAdmin(c.deps, tenantActor(c).tenantId, c.params.id);
      // The image is the raw request body (Content-Type image/png | image/jpeg | image/webp, ≤ 2 MB).
      const body: unknown = await new Promise((resolve, reject) =>
        express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' })(c.req, c.res, (err?: unknown) => (err ? reject(err) : resolve(c.req.body))),
      ).catch(() => {
        throw new AppError('UPLOAD_INVALID', 'Logo must be a PNG, JPEG or WebP image of 2 MB or less');
      });
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('UPLOAD_INVALID', 'Send the image as the request body');
      return uploadLogo(c.deps, c.deps.storage, tenantActor(c), tenantActor(c).tenantId, c.params.id, body);
    },
  }),

  // ---- counters (R1.1, FR-ADM-10)
  route({
    method: 'get',
    path: '/venues/:id/counters',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    tenantResource: true,
    handler: async (c) => ({ items: await listCounters(c.deps, tenantActor(c).tenantId, c.params.id) }),
  }),
  route({
    method: 'post',
    path: '/venues/:id/counters',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    body: counterCreateBody,
    status: 201,
    tenantResource: true,
    handler: async (c) => createCounter(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, c.body),
  }),
  route({
    method: 'patch',
    path: '/counters/:id',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    body: counterPatch,
    tenantResource: true,
    handler: async (c) => {
      await updateCounter(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, c.body);
    },
  }),
  route({
    method: 'post',
    path: '/counters/:id/archive',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await archiveCounter(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id);
    },
  }),

  // ---- ratings (R1.1, FR-RPT-08)
  route({
    method: 'get',
    path: '/ratings',
    surfaces: ['tenant'],
    permission: 'reports.view',
    query: z.object({ venueId: uuidSchema.optional() }).strict(),
    handler: async (c) => ({ items: await listRatings(c.deps, tenantActor(c).tenantId, c.query.venueId), summary: await ratingSummary(c.deps, tenantActor(c).tenantId, c.query.venueId) }),
  }),
  route({
    method: 'delete',
    path: '/ratings/:id',
    surfaces: ['tenant'],
    permission: 'ratings.moderate',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await deleteRatingComment(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id);
    },
  }),

  // ---- staff access and devices
  route({
    method: 'get',
    path: '/venues/:id/staff-access',
    surfaces: ['tenant'],
    permission: 'venue.staff_credentials',
    params: idP,
    tenantResource: true,
    handler: async (c) => staffAccessInfo(c.deps, tenantActor(c).tenantId, c.params.id),
  }),
  route({
    method: 'post',
    path: '/venues/:id/staff-access/rotate-link',
    surfaces: ['tenant'],
    permission: 'venue.staff_credentials',
    params: idP,
    tenantResource: true,
    handler: async (c) => rotateStaffLink(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id),
  }),
  route({
    method: 'put',
    path: '/venues/:id/staff-access/pin',
    surfaces: ['tenant'],
    permission: 'venue.staff_credentials',
    params: idP,
    body: staffPinBody,
    tenantResource: true,
    handler: async (c) => {
      await setStaffPin(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, c.body.pin);
    },
  }),
  route({
    method: 'get',
    path: '/venues/:id/devices',
    surfaces: ['tenant'],
    permission: 'venue.staff_access',
    params: idP,
    tenantResource: true,
    handler: async (c) => ({ items: await listDevices(c.deps, tenantActor(c).tenantId, c.params.id) }),
  }),
  route({
    method: 'delete',
    path: '/devices/:id',
    surfaces: ['tenant'],
    permission: 'venue.staff_access',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await removeDevice(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id);
    },
  }),

  // ---- displays
  route({
    method: 'get',
    path: '/venues/:id/displays',
    surfaces: ['tenant'],
    permission: 'venue.staff_access',
    params: idP,
    tenantResource: true,
    handler: async (c) => ({ items: await listDisplays(c.deps, tenantActor(c).tenantId, c.params.id) }),
  }),
  route({
    method: 'post',
    path: '/venues/:id/displays',
    surfaces: ['tenant'],
    permission: 'venue.staff_credentials',
    params: idP,
    body: displayCreateBody,
    status: 201,
    tenantResource: true,
    handler: async (c) => createDisplay(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, c.body),
  }),
  route({
    method: 'patch',
    path: '/displays/:id',
    surfaces: ['tenant'],
    permission: 'venue.staff_access',
    params: idP,
    body: displayPatch,
    tenantResource: true,
    handler: async (c) => {
      await updateDisplay(c.deps, tenantActor(c).tenantId, c.params.id, c.body);
    },
  }),
  route({
    method: 'delete',
    path: '/displays/:id',
    surfaces: ['tenant'],
    permission: 'venue.staff_access',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await unpairDisplay(c.deps, tenantActor(c), tenantActor(c).tenantId, c.params.id, true);
    },
  }),
  route({
    method: 'post',
    path: '/displays/:id/pairing-code',
    surfaces: ['tenant'],
    permission: 'venue.staff_credentials',
    params: idP,
    tenantResource: true,
    handler: async (c) => issuePairingCode(c.deps, tenantActor(c).tenantId, c.params.id),
  }),

  // ---- posters
  route({
    method: 'get',
    path: '/venues/:id/posters/:kind',
    surfaces: ['tenant'],
    permission: 'venue.settings',
    params: z.object({ id: uuidSchema, kind: z.enum(['a4.pdf', 'tent.pdf', 'door.pdf']) }).strict(),
    query: z.object({ locale: z.string().min(2).max(10).default('en') }).strict(),
    tenantResource: true,
    handler: async (c) => {
      const kind = c.params.kind.replace('.pdf', '') as 'a4' | 'tent' | 'door';
      const pdf = await posterPdf(c.deps, tenantActor(c).tenantId, c.params.id, kind, c.query.locale);
      c.res.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="qr-${kind}.pdf"`);
      c.res.send(pdf);
    },
  }),

  // ---- team
  route({ method: 'get', path: '/members', surfaces: ['tenant'], permission: 'team.invite_managers', limitedAccessOk: true, handler: async (c) => listMembers(c.deps, tenantActor(c).tenantId) }),
  route({
    method: 'post',
    path: '/invitations',
    surfaces: ['tenant'],
    permission: 'team.invite_managers',
    body: invitationBody,
    status: 201,
    limitedAccessOk: true,
    rateLimit: { name: 'invite', points: 20, durationSec: 3600, key: 'actor' },
    handler: async (c) => inviteMember(c.deps, userActor(c), userActor(c).tenantId, c.body.email, 'manager'),
  }),
  route({
    method: 'post',
    path: '/members',
    surfaces: ['tenant'],
    permission: 'team.manage',
    body: memberCreateBody,
    status: 201,
    limitedAccessOk: true,
    rateLimit: { name: 'member-add', points: 20, durationSec: 3600, key: 'actor' },
    handler: async (c) => addMember(c.deps, userActor(c), userActor(c).tenantId, c.body),
  }),
  route({
    method: 'delete',
    path: '/invitations/:id',
    surfaces: ['tenant'],
    permission: 'team.invite_managers',
    params: idP,
    limitedAccessOk: true,
    tenantResource: true,
    handler: async (c) => {
      await revokeInvitation(c.deps, userActor(c).tenantId, c.params.id);
    },
  }),
  route({
    method: 'delete',
    path: '/members/:id',
    surfaces: ['tenant'],
    permission: 'team.manage',
    params: idP,
    limitedAccessOk: true,
    tenantResource: true,
    handler: async (c) => {
      await removeMember(c.deps, userActor(c), userActor(c).tenantId, c.params.id);
    },
  }),
  route({
    method: 'post',
    path: '/ownership-transfer',
    surfaces: ['tenant'],
    permission: 'team.manage',
    body: ownershipTransferBody,
    limitedAccessOk: true,
    rateLimit: { name: 'ownership-transfer', points: 5, durationSec: 3600, key: 'actor' },
    handler: async (c) => {
      await transferOwnership(c.deps, userActor(c), userActor(c).tenantId, c.body.memberId, c.body.password);
    },
  }),

  // ---- reports
  route({
    method: 'get',
    path: '/reports/today',
    surfaces: ['tenant'],
    permission: 'reports.view',
    query: venueIdQuery,
    handler: async (c) => todayReport(c.deps, tenantActor(c).tenantId, c.query.venueId),
  }),
  route({
    method: 'get',
    path: '/reports/pilot',
    surfaces: ['tenant'],
    permission: 'reports.view',
    query: reportRangeQuery,
    handler: async (c) => pilotReport(c.deps, tenantActor(c).tenantId, c.query.venueId, c.query.from, c.query.to),
  }),

  // ---- export
  route({
    method: 'post',
    path: '/exports',
    surfaces: ['tenant'],
    permission: 'tenant.export',
    status: 202,
    limitedAccessOk: true,
    rateLimit: { name: 'export', points: 3, durationSec: 3600, key: 'actor' },
    handler: async (c) => requestExport(c.deps, userActor(c), userActor(c).tenantId),
  }),
  // Immediate ZIP download (Reports); registered before /exports/:id so "download" is not read as an id.
  route({
    method: 'get',
    path: '/exports/download',
    surfaces: ['tenant'],
    permission: 'tenant.export',
    limitedAccessOk: true,
    rateLimit: { name: 'export-download', points: 10, durationSec: 3600, key: 'actor' },
    handler: async (c) => {
      const zip = await downloadExport(c.deps, userActor(c), userActor(c).tenantId);
      c.res.type('application/zip').setHeader('Content-Disposition', `attachment; filename="tanbeeh-export-${c.deps.now().toISOString().slice(0, 10)}.zip"`);
      c.res.send(zip);
    },
  }),
  route({
    method: 'get',
    path: '/exports/:id',
    surfaces: ['tenant'],
    permission: 'tenant.export',
    params: idP,
    limitedAccessOk: true,
    tenantResource: true,
    handler: async (c) => exportStatus(c.deps, userActor(c).tenantId, c.params.id, c.deps.storage),
  }),

  // ---- billing: read-only; payments are recorded by the platform team
  route({ method: 'get', path: '/billing', surfaces: ['tenant'], permission: 'billing.view', limitedAccessOk: true, handler: async (c) => billingOverview(c.deps, tenantActor(c).tenantId) }),

  // Chime picker for venue settings (FR-ADM-08, W11): the platform library's active chimes.
  route({ method: 'get', path: '/chimes', surfaces: ['tenant'], permission: 'venue.settings', handler: async (c) => ({ items: await listChimes(c.deps, { activeOnly: true }) }) }),

  // ---- account
  route({
    method: 'patch',
    path: '/me',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: mePatch,
    limitedAccessOk: true,
    handler: async (c) => {
      await updateMe(c.deps, userActor(c).userId, c.body);
    },
  }),
  // Email change (W05, FR-ADM-18): password-confirmed; finished from the link sent to the new address.
  route({
    method: 'post',
    path: '/me/email',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: changeEmailBody,
    limitedAccessOk: true,
    rateLimit: { name: 'email-change', points: 5, durationSec: 3600, key: 'actor' },
    status: 202,
    handler: async (c) => {
      const a = userActor(c);
      return requestEmailChange(c.deps, { userId: a.userId, tenantId: a.tenantId }, c.body.newEmail, c.body.password);
    },
  }),
  // The signed-in member's own preferences in this tenant (W06, FR-RPT-05).
  route({
    method: 'put',
    path: '/me/preferences',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: memberPreferencesBody,
    limitedAccessOk: true,
    handler: async (c) => {
      await setMemberPreferences(c.deps, userActor(c), c.body);
    },
  }),
  route({
    method: 'post',
    path: '/me/password',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: changePasswordBody,
    limitedAccessOk: true,
    rateLimit: { name: 'pw', points: 10, durationSec: 3600, key: 'actor' },
    handler: async (c) => {
      const a = userActor(c);
      await changePassword(c.deps, a.userId, a.sessionId, c.body.currentPassword, c.body.newPassword);
    },
  }),
]);
