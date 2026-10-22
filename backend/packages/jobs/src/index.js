import { z } from 'zod';
// Queue names, job payload schemas and the enqueue interface (TRD §18, TR-JOB-01).
export const QUEUES = ['push', 'alerts', 'email', 'maintenance', 'tenant', 'reports', 'webhooks'];
const uuid = z.string().min(1).max(64);
export const JOB_SCHEMAS = {
    'push.send': z.object({ tenantId: uuid, ticketId: uuid, round: z.number().int(), attempt: z.number().int(), manual: z.boolean() }),
    'alert.repeat': z.object({ tenantId: uuid, ticketId: uuid, round: z.number().int(), n: z.number().int() }),
    'alert.overdue-flag': z.object({ tenantId: uuid, ticketId: uuid, round: z.number().int() }),
    'email.send': z.object({
        template: z.string(),
        to: z.string().email(),
        locale: z.string(),
        tenantId: z.string().nullable(),
        data: z.record(z.string(), z.unknown()),
        messageKey: z.string(),
    }),
    'tenant.export': z.object({ tenantId: uuid, exportId: uuid }),
    'tenant.purge': z.object({ tenantId: uuid }),
    'image.process-logo': z.object({ tenantId: uuid, venueId: uuid, uploadKey: z.string() }),
    'webhook.fanout': z.object({ tenantId: uuid, venueId: z.string().nullable(), type: z.string(), eventKey: z.string(), data: z.record(z.string(), z.unknown()) }),
    'webhook.deliver': z.object({ tenantId: uuid, deliveryId: z.number().int() }),
};
export const JOB_QUEUE = {
    'push.send': 'push',
    'alert.repeat': 'alerts',
    'alert.overdue-flag': 'alerts',
    'email.send': 'email',
    'tenant.export': 'tenant',
    'tenant.purge': 'tenant',
    'image.process-logo': 'maintenance',
    'webhook.fanout': 'webhooks',
    'webhook.deliver': 'webhooks',
};
/** Retry policies per job (§18). */
export const JOB_ATTEMPTS = {
    'push.send': { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    'alert.repeat': { attempts: 2, backoff: { type: 'fixed', delay: 1000 } },
    'alert.overdue-flag': { attempts: 2, backoff: { type: 'fixed', delay: 1000 } },
    'email.send': { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    'tenant.export': { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    // Purge is resumable (A30): every step is idempotent and the tenant row is removed last.
    'tenant.purge': { attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
    'webhook.fanout': { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    'image.process-logo': { attempts: 3, backoff: { type: 'fixed', delay: 2000 } },
};
/**
 * Deterministic job ID from parts joined with '.'. BullMQ 5 rejects custom IDs that contain ':' (the separator of
 * its own Redis keys) or that are integers, so application IDs never use either (A01). Parts are restricted to
 * characters that cannot collide with the separator.
 */
export function jobId(...parts) {
    for (const p of parts) {
        if (!/^[A-Za-z0-9_-]+$/.test(String(p)))
            throw new Error(`invalid job id part: ${String(p)}`);
    }
    const id = parts.join('.');
    assertValidJobId(id);
    return id;
}
/** The custom-ID rules of the installed BullMQ, enforced by every adapter so tests cannot accept IDs production rejects. */
export function assertValidJobId(id) {
    if (id.length === 0 || id.length > 255)
        throw new Error('Custom Id must be 1–255 characters');
    if (`${parseInt(id, 10)}` === id)
        throw new Error('Custom Id cannot be integers');
    if (id.includes(':'))
        throw new Error('Custom Id cannot contain :');
}
/**
 * In-memory queue for tests and local runs without Redis 7: records jobs, dedupes by ID. It applies the same
 * payload and job-ID validation as BullJobs, and `failNext` injects queue outages for durability tests.
 */
export class MemoryJobs {
    added = [];
    ids = new Set();
    failures = 0;
    /** The next `n` calls to add() throw, as a queue store outage would. */
    failNext(n = 1) {
        this.failures = n;
    }
    async add(name, data, opts = {}) {
        JOB_SCHEMAS[name].parse(data);
        if (opts.jobId !== undefined)
            assertValidJobId(opts.jobId);
        if (this.failures > 0) {
            this.failures--;
            throw new Error('queue unavailable (injected)');
        }
        if (opts.jobId) {
            if (this.ids.has(opts.jobId))
                return;
            this.ids.add(opts.jobId);
        }
        this.added.push({ name, data, opts });
    }
    take(name) {
        const out = name ? this.added.filter((j) => j.name === name) : [...this.added];
        for (const j of out)
            this.added.splice(this.added.indexOf(j), 1);
        return out;
    }
}
export { BullJobs, tokenBucketTake, TOKEN_BUCKET_LUA } from './bull.js';
