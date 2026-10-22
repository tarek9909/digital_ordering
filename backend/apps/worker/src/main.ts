import { loadEnv } from '@dop/config';
import { JOB_QUEUE, QUEUES, type BullJobs } from '@dop/jobs';
import { createRuntime, type PushSender } from '@dop/services';
import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { SCHEDULE, relayOutbox, type Mailer, type WorkerDeps } from './handlers.js';
import { createProcessor } from './processor.js';

const env = loadEnv();
const rt = await createRuntime(env);
const log = rt.deps.log;
const cache = rt.cache;
const connection = rt.queueRedis;
if (rt.redisMajor < 5) {
  log.fatal('BullMQ needs Redis 5 or later (Redis 7 / MemoryDB in deployed environments). Start it with `docker compose up redis`.');
  process.exit(1);
}

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
// TR-ALR-07: TTL 600, Urgency high, Topic so a newer repeat replaces an undelivered older one.
const push: PushSender = async (m) => {
  const r = await webpush.sendNotification({ endpoint: m.endpoint, keys: m.keys }, m.payload, { TTL: m.ttlSec, urgency: 'high', topic: m.topic, timeout: 10_000 });
  return r.statusCode;
};

// Any SMTP provider (SMTP_URL, e.g. smtps://user:pass@smtp.provider.com:465); Mailpit locally.
if (!env.SMTP_URL) log.warn('SMTP_URL not set: emails will fail');
const transport = nodemailer.createTransport(env.SMTP_URL ?? 'smtp://127.0.0.1:1025');
const mailer: Mailer = {
  async send(m) {
    await transport.sendMail({ from: env.EMAIL_FROM, replyTo: `support@${env.PLATFORM_DOMAIN}`, to: m.to, subject: m.subject, html: m.html, text: m.text });
  },
};

const jobs = rt.deps.jobs as BullJobs;
const deps: WorkerDeps = { ...rt.deps, push, mailer, storage: rt.storage };

const processJob = createProcessor(deps, cache);

const CONCURRENCY: Record<string, number> = { push: 50, alerts: 20, email: 10, maintenance: 2, tenant: 2, reports: 2, webhooks: 20 };
const workers = QUEUES.map(
  (q) =>
    new Worker(q, processJob, { connection, concurrency: CONCURRENCY[q] ?? 4 }).on('failed', (job, err) => {
      // After the final retry jobs stay in the failed set (dead-letter list, TR-JOB-02).
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) log.error({ queue: q, job: job.name, id: job.id, err }, 'job dead-lettered');
    }),
);

// Scheduler leader lock (TR-JOB-03): one process registers repeatables and runs the 1-second outbox relay.
const LEADER_KEY = 'scheduler:leader';
const me = `${process.pid}:${Math.random().toString(36).slice(2)}`;
let leader = false;
async function lead() {
  const got = await cache.set(LEADER_KEY, me, 'PX', 30_000, 'NX');
  if (got === 'OK') leader = true;
  else if ((await cache.get(LEADER_KEY)) === me) {
    await cache.pexpire(LEADER_KEY, 30_000);
    leader = true;
  } else leader = false;
  if (leader) {
    for (const s of SCHEDULE) {
      await jobs.queue('maintenance').upsertJobScheduler(`sched:${s.name}`, s.every ? { every: s.every } : { pattern: s.pattern!, tz: 'UTC' }, { name: `sched:${s.name}` });
    }
  }
}
await lead();
setInterval(() => void lead().catch((err: unknown) => log.error({ err }, 'leader renew failed')), 10_000);
setInterval(() => {
  if (leader) void relayOutbox(deps).catch((err: unknown) => log.error({ err }, 'outbox relay failed'));
}, 1_000);

log.info({ queues: QUEUES, jobQueues: JOB_QUEUE }, 'worker started');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await Promise.all(workers.map((w) => w.close()));
    if ((await cache.get(LEADER_KEY)) === me) await cache.del(LEADER_KEY);
    await rt.close();
    process.exit(0);
  });
}
