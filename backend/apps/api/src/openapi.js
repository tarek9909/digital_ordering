import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ERROR_CODES } from '@dop/contracts';
import { z } from 'zod';
import { v1Routes } from './routes/v1.js';
// OpenAPI 3.1 for the integration API, generated from the same Zod schemas the routes validate with
// (TR-API-08). The committed copy in docs/openapi/v1.json is compared in a contract test, so any change to
// /v1 shows up in review and breaking changes need a new major path (TR-INT-05).
extendZodWithOpenApi(z);
const ticket = z
    .object({
    id: z.string().uuid(),
    displayNumber: z.string(),
    number: z.number().int(),
    status: z.enum(['received', 'preparing', 'ready', 'collected', 'cancelled', 'expired']),
    version: z.number().int(),
    seq: z.number().int(),
    counterId: z.string().uuid().nullable(),
    note: z.string().nullable(),
    externalRef: z.string().nullable(),
    waitMinutes: z.number().int().nullable(),
    waitBaseAt: z.string().datetime().nullable(),
    alertLevel: z.enum(['push', 'live', 'closed', 'none']),
    acknowledgedAt: z.string().datetime().nullable(),
    claimCode: z.string().length(4),
    readyRound: z.number().int(),
    autoAlertsSent: z.number().int(),
    manualAlertsSent: z.number().int(),
    source: z.enum(['staff', 'api', 'connector']),
    createdAt: z.string().datetime(),
    readyAt: z.string().datetime().nullable(),
    collectedAt: z.string().datetime().nullable(),
    cancelReason: z.string().nullable(),
    ticketUrl: z.string().url(),
    firstReadyAt: z.string().datetime().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    expiredAt: z.string().datetime().nullable(),
})
    .openapi('Ticket');
const problem = z
    .object({ type: z.string(), title: z.string(), status: z.number().int(), code: z.enum(Object.keys(ERROR_CODES)), detail: z.string().optional(), requestId: z.string().optional() })
    .openapi('Problem');
const RESPONSES = {
    'get /me': z.object({ tenant: z.object({ name: z.string() }), venue: z.object({ id: z.string(), name: z.string(), timeZone: z.string() }), key: z.object({ name: z.string(), prefix: z.string() }) }),
    'get /tickets': z.object({ items: z.array(ticket), nextCursor: z.string().nullable() }),
    'post /tickets/:id/alert': z.object({ accepted: z.literal(true) }),
};
export function buildOpenApi() {
    const registry = new OpenAPIRegistry();
    registry.registerComponent('securitySchemes', 'apiKey', { type: 'http', scheme: 'bearer', description: 'pk_live_… API key (TR-INT-03)' });
    for (const d of v1Routes.defs) {
        const path = `/v1${d.path}`.replace(/:(\w+)/g, '{$1}');
        const key = `${d.method} ${d.path}`;
        const isBinary = d.path.endsWith('.png') || d.path.endsWith('.svg');
        const ok = RESPONSES[key] ?? (isBinary ? null : ticket);
        registry.registerPath({
            method: d.method,
            path,
            security: [{ apiKey: [] }],
            ...(d.method === 'post' && { parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 } }] }),
            request: {
                ...(d.params && { params: d.params }),
                ...(d.query && { query: d.query }),
                ...(d.body && { body: { content: { 'application/json': { schema: d.body } } } }),
            },
            responses: {
                [d.status ?? (key === 'post /tickets' ? 201 : 200)]: ok
                    ? { description: 'OK', content: { 'application/json': { schema: ok } } }
                    : { description: 'Image', content: { [d.path.endsWith('.png') ? 'image/png' : 'image/svg+xml']: { schema: { type: 'string', format: 'binary' } } } },
                ...(key === 'post /tickets' && { 200: { description: 'An open ticket with this externalRef already exists (FR-INT-05)', content: { 'application/json': { schema: ticket } } } }),
                default: { description: 'Problem Details (RFC 9457)', content: { 'application/problem+json': { schema: problem } } },
            },
        });
    }
    return new OpenApiGeneratorV31(registry.definitions).generateDocument({
        openapi: '3.1.0',
        info: { title: 'Tanbeeh Integration API', version: '1.0.0', description: 'POS integration API. Rate limits: 10 requests/s per key (burst 20), 300/min per tenant.' },
        servers: [{ url: 'https://api.tanbeeh.app' }],
    });
}
