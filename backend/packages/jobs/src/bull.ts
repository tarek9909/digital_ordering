import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { JOB_ATTEMPTS, JOB_QUEUE, JOB_SCHEMAS, assertValidJobId, type EnqueueOptions, type JobData, type JobName, type Jobs, type QueueName } from './index.js';

// BullMQ adapter (BullMQ 5 on Redis 7 / MemoryDB). Payloads are validated before enqueue (TR-JOB-01).

export class BullJobs implements Jobs {
  private readonly queues = new Map<QueueName, Queue>();

  /** `prefix` isolates queues (tests); BullMQ's default is `bull`. */
  constructor(
    private readonly connection: Redis,
    private readonly opts: { prefix?: string } = {},
  ) {}

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, prefix: this.opts.prefix, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } });
      this.queues.set(name, q);
    }
    return q;
  }

  async add<N extends JobName>(name: N, data: JobData<N>, opts: EnqueueOptions = {}): Promise<void> {
    JOB_SCHEMAS[name].parse(data);
    if (opts.jobId !== undefined) assertValidJobId(opts.jobId);
    const policy = JOB_ATTEMPTS[name];
    await this.queue(JOB_QUEUE[name]).add(name, data, {
      jobId: opts.jobId,
      delay: opts.delayMs,
      attempts: policy?.attempts ?? 1,
      backoff: policy?.backoff,
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

/**
 * Per-tenant token bucket (TR-JOB-04): refills `ratePerSec` tokens per second up to `ratePerSec`.
 * Returns true when a token was taken. Implemented as one Lua script so it is atomic across workers.
 */
export const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local b = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(b[1]) or rate
local ts = tonumber(b[2]) or now
tokens = math.min(rate, tokens + (now - ts) / 1000 * rate)
local ok = 0
if tokens >= 1 then tokens = tokens - 1; ok = 1 end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, 10000)
return ok`;

export async function tokenBucketTake(redis: Redis, queue: string, tenantId: string, ratePerSec: number, now = Date.now()): Promise<boolean> {
  const r = await redis.eval(TOKEN_BUCKET_LUA, 1, `rl:${queue}:${tenantId}`, String(ratePerSec), String(now));
  return r === 1;
}
