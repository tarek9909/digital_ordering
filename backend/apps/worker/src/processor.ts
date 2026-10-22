import { tokenBucketTake, type JobName } from '@dop/jobs';
import { getSetting } from '@dop/services';
import { DelayedError, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { JOB_HANDLERS, SCHEDULE, type WorkerDeps } from './handlers.js';

// The BullMQ processor shared by every queue: scheduled maintenance jobs and application jobs, with per-tenant
// fairness (TR-JOB-04). Kept apart from main.ts so tests run the same processor against a real queue.

// Outgoing webhook deliveries share the token bucket too (M-12): one tenant's slow endpoints cannot hold every
// worker slot; the rate is `fairness.perTenantPerSecond.webhook`.
export const FAIR: Partial<Record<JobName, 'push' | 'email' | 'webhook'>> = { 'push.send': 'push', 'alert.repeat': 'push', 'email.send': 'email', 'webhook.deliver': 'webhook' };

export function createProcessor(deps: WorkerDeps, cache: Redis) {
  return async function processJob(job: Job, token?: string) {
    const name = job.name as JobName | `sched:${string}`;
    if (name.startsWith('sched:')) {
      const s = SCHEDULE.find((x) => `sched:${x.name}` === name);
      return s ? s.run(deps) : undefined;
    }
    const fair = FAIR[name as JobName];
    const tenantId = (job.data as { tenantId?: string | null }).tenantId;
    if (fair && tenantId) {
      const rates = await getSetting(deps, 'fairness.perTenantPerSecond');
      // Take a token before working; otherwise move the job back 250 ms.
      if (!(await tokenBucketTake(cache, fair, tenantId, rates[fair]))) {
        await job.moveToDelayed(Date.now() + 250, token);
        throw new DelayedError();
      }
    }
    const handler = JOB_HANDLERS[name as JobName];
    if (!handler) throw new Error(`no handler for ${name}`);
    return handler(deps, job.data);
  };
}
