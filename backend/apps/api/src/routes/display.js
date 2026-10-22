import { COOKIES, SESSION_TTL } from '@dop/auth';
import { AppError, pairBody } from '@dop/contracts';
import { tenantAccess } from '@dop/domain';
import { branding, csrfFor, languageVoices, displayTicket, getTenantStatus, isEnabled, loadVenue, pairDisplay, parseDisplaySettings, urls } from '@dop/services';
import { defineRoutes, route } from '../http/router.js';
// Display API (TRD §12.6).
export const displayRoutes = defineRoutes('/api/display/v1', [
    route({
        method: 'post',
        path: '/pair',
        surfaces: ['tenant'],
        permission: 'public',
        body: pairBody,
        csrfExempt: true,
        rateLimit: { name: 'pair', points: 5, durationSec: 600, key: 'ip' },
        handler: async (c) => {
            const r = await pairDisplay(c.deps, c.body.code, c.host);
            if (r.tenantId !== c.tenant?.id)
                throw new AppError('PAIRING_CODE_INVALID');
            c.setCookie(COOKIES.display, r.token, SESSION_TTL.displaySlidingMs);
            return { displayId: r.displayId };
        },
    }),
    route({
        method: 'get',
        path: '/board',
        surfaces: ['tenant'],
        permission: 'display.view',
        handler: async (c) => {
            if (c.actor.kind !== 'display')
                throw new AppError('UNAUTHENTICATED');
            const a = c.actor;
            const db = c.deps.db.forTenant(a.tenantId);
            const [venue, d, status, removePoweredBy, speech] = await Promise.all([
                loadVenue(db, a.venueId),
                db.selectFrom('displays').selectAll().where('id', '=', a.displayId).executeTakeFirstOrThrow(),
                getTenantStatus(c.deps, a.tenantId),
                isEnabled(c.deps, a.tenantId, 'remove_powered_by'),
                isEnabled(c.deps, a.tenantId, 'display_speech'),
            ]);
            const settings = parseDisplaySettings(d.settings);
            // Without `display_speech` the display still chimes but speaks no language (A14, FR-SA-11).
            if (!speech)
                settings.announce = { ...settings.announce, languages: [] };
            const tenantStatus = status ?? 'active';
            const blocked = !tenantAccess(tenantStatus).display;
            const counterIds = d.counter_ids ?? null;
            let q = db.selectFrom('tickets').selectAll().where('venue_id', '=', a.venueId).where('status', 'in', ['preparing', 'ready', 'received']);
            if (counterIds?.length)
                q = q.where('counter_id', 'in', counterIds);
            const open = blocked ? [] : await q.orderBy('ready_at', 'desc').orderBy('created_at').execute();
            return {
                venue: branding(c.deps.config, venue, { removePoweredBy }),
                settings,
                counterIds,
                venueUrl: urls(c.deps.config).venue(venue.row.venue_code),
                tenantStatus,
                voices: await languageVoices(c.deps),
                ready: open.filter((t) => t.status === 'ready').map(displayTicket),
                preparing: open.filter((t) => t.status !== 'ready').map(displayTicket),
                serverTime: c.deps.now().toISOString(),
                csrfToken: csrfFor(c.deps, `dsp:${a.displayId}`),
                displayName: d.name,
            };
        },
    }),
    route({
        method: 'delete',
        path: '/session',
        surfaces: ['tenant'],
        permission: 'display.view',
        handler: async (c) => {
            if (c.actor.kind === 'display') {
                await c.deps.db.forTenant(c.actor.tenantId).updateTable('displays').set({ session_hash: null, paired_at: null }).where('id', '=', c.actor.displayId).execute();
            }
            c.clearCookie(COOKIES.display);
        },
    }),
]);
