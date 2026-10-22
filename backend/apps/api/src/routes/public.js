import { AppError, claimBody, clientOnlyBody, ratingBody, uuidSchema, followBody, myTicketsBody, pushSubscriptionBody, tokenParam, venueCodeParam, } from '@dop/contracts';
import { pushServiceOf } from '@dop/domain';
import { acknowledge, alertsEnabled, claimStatus, claimTicket, rateTicket, deletePushSubscription, follow, getSetting, publicCatalogue, legalDocument, myTicketsAtVenue, publicTicketView, savePushSubscription, ticketManifest, venuePublic, } from '@dop/services';
import { z } from 'zod';
import { defineRoutes, route } from '../http/router.js';
// Public API (TRD §12.3). Ticket tokens are the credential (layer 1); rate limits per TR-SEC-07.
const tokenP = z.object({ token: tokenParam }).strict();
const venueP = z.object({ venueCode: venueCodeParam }).strict();
const readLimit = { name: 'public-read', points: 120, durationSec: 60, key: 'ip' };
const writeLimit = { name: 'public-write', points: 30, durationSec: 60, key: 'ip+param' };
export const publicRoutes = defineRoutes('/api/public/v1', [
    route({
        method: 'get',
        path: '/config',
        surfaces: ['customer', 'www'],
        permission: 'public',
        handler: async (c) => ({ vapidPublicKey: c.deps.config.vapidPublicKey, domain: c.deps.config.domain }),
    }),
    // Contact (email link, WhatsApp button) and the packages section wording on the sign-up site; set by super admins in the console.
    route({
        method: 'get',
        path: '/site',
        surfaces: ['www'],
        permission: 'public',
        rateLimit: readLimit,
        handler: async (c) => {
            const [contact, pricing] = await Promise.all([getSetting(c.deps, 'site.contact'), getSetting(c.deps, 'site.pricing')]);
            return {
                pricing,
                contact: {
                    email: contact.email || null,
                    whatsapp: contact.whatsapp || null,
                    whatsappUrl: contact.whatsapp ? `https://wa.me/${contact.whatsapp.replace(/\D/g, '')}` : null,
                },
            };
        },
    }),
    // Public price list for the sign-up site (W02, FR-BIL-02): the console's plan catalogue, never hard-coded.
    route({
        method: 'get',
        path: '/plans',
        surfaces: ['www'],
        permission: 'public',
        rateLimit: readLimit,
        handler: async (c) => ({ items: await publicCatalogue(c.deps), trialDays: await getSetting(c.deps, 'trial.days') }),
    }),
    route({
        method: 'get',
        path: '/tickets/:token',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        rateLimit: readLimit,
        tenantResource: true,
        handler: async (c) => {
            c.res.setHeader('Cache-Control', 'no-store');
            c.res.setHeader('Referrer-Policy', 'no-referrer');
            return publicTicketView(c.deps, c.params.token);
        },
    }),
    route({
        method: 'post',
        path: '/tickets/:token/follow',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        body: followBody,
        rateLimit: writeLimit,
        tenantResource: true,
        handler: async (c) => follow(c.deps, c.params.token, c.body),
    }),
    route({
        method: 'post',
        path: '/tickets/:token/alerts-enabled',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        body: clientOnlyBody,
        rateLimit: writeLimit,
        tenantResource: true,
        handler: async (c) => {
            await alertsEnabled(c.deps, c.params.token, c.body.clientId);
        },
    }),
    route({
        method: 'put',
        path: '/tickets/:token/push-subscription',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        body: pushSubscriptionBody,
        rateLimit: writeLimit,
        tenantResource: true,
        handler: async (c) => {
            // The endpoint host must be a known push service (§12.3), which also blocks SSRF via push sends.
            const service = pushServiceOf(c.body.subscription.endpoint);
            if (!service)
                throw new AppError('VALIDATION_FAILED', 'Unknown push service', { errors: [{ path: 'subscription.endpoint', message: 'unknown push service' }] });
            await savePushSubscription(c.deps, c.params.token, c.body, service);
        },
    }),
    route({
        method: 'delete',
        path: '/tickets/:token/push-subscription',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        body: clientOnlyBody,
        rateLimit: writeLimit,
        tenantResource: true,
        handler: async (c) => {
            await deletePushSubscription(c.deps, c.params.token, c.body.clientId);
        },
    }),
    route({
        method: 'post',
        path: '/tickets/:token/acknowledge',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        rateLimit: writeLimit,
        tenantResource: true,
        handler: async (c) => {
            await acknowledge(c.deps, c.params.token);
        },
    }),
    route({
        method: 'get',
        path: '/tickets/:token/manifest',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        rateLimit: readLimit,
        tenantResource: true,
        handler: async (c) => {
            c.res.setHeader('Cache-Control', 'no-store');
            c.res.type('application/manifest+json').send(JSON.stringify(await ticketManifest(c.deps, c.params.token)));
        },
    }),
    route({
        method: 'get',
        path: '/venues/:venueCode',
        surfaces: ['customer'],
        permission: 'public',
        params: venueP,
        rateLimit: readLimit,
        handler: async (c) => venuePublic(c.deps, c.params.venueCode),
    }),
    route({
        method: 'post',
        path: '/venues/:venueCode/my-tickets',
        surfaces: ['customer'],
        permission: 'public',
        params: venueP,
        body: myTicketsBody,
        rateLimit: readLimit,
        handler: async (c) => myTicketsAtVenue(c.deps, c.params.venueCode, c.body.tokens),
    }),
    route({
        method: 'post',
        path: '/tickets/:token/rating',
        surfaces: ['customer'],
        permission: 'public',
        params: tokenP,
        body: ratingBody,
        rateLimit: writeLimit,
        tenantResource: true,
        handler: async (c) => rateTicket(c.deps, c.params.token, c.body),
    }),
    route({
        method: 'post',
        path: '/venues/:venueCode/claims',
        surfaces: ['customer'],
        permission: 'public',
        params: venueP,
        body: claimBody.extend({ uaFamily: z.string().max(40).optional() }),
        // TR-SEC-07: 10 per 10 minutes per IP, and 100 per venue.
        rateLimit: { name: 'claims', points: 10, durationSec: 600, key: 'ip' },
        handler: async (c) => {
            // Per browser too (L-13), so one client cannot spend the venue's budget from a few addresses alone.
            await c.deps.rateLimit('claims-client', c.body.clientId, 5, 600);
            await c.deps.rateLimit('claims-venue', c.params.venueCode, 100, 600);
            const { uaFamily, ...b } = c.body;
            return claimTicket(c.deps, c.params.venueCode, b, uaFamily ?? 'other');
        },
    }),
    route({
        method: 'get',
        path: '/claims/:claimId',
        surfaces: ['customer'],
        permission: 'public',
        params: z.object({ claimId: uuidSchema }).strict(),
        query: z.object({ clientId: z.string().regex(/^[0-9A-Za-z]{22}$/) }).strict(),
        rateLimit: readLimit,
        handler: async (c) => claimStatus(c.deps, c.params.claimId, c.query.clientId),
    }),
    route({
        method: 'get',
        path: '/legal/:kind',
        surfaces: ['customer', 'www', 'tenant'],
        permission: 'public',
        params: z.object({ kind: z.enum(['terms', 'privacy', 'dpa', 'customer_privacy']) }).strict(),
        query: z.object({ locale: z.string().min(2).max(10).default('ar') }).strict(),
        handler: async (c) => legalDocument(c.deps, c.params.kind, c.query.locale, c.deps.storage),
    }),
]);
