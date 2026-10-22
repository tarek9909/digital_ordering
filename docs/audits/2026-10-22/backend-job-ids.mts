import { createRequire } from 'node:module';
import { BullJobs } from '../../../backend/packages/jobs/src/bull.ts';
import { jobIds } from '../../../backend/packages/services/src/outbox.ts';
// Regression probe (converted): the application's own job IDs must be accepted by the installed BullMQ.
// Point REDIS_URL at Redis 5+ (e.g. redis://127.0.0.1:6390); the version check is skipped only on older Redis.
const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const { Job, Queue } = require('bullmq');
const Redis = require('ioredis');
const version = require('bullmq/package.json').version;
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const name = `dop-audit-${Date.now()}`;
const prefix = `bull:${name}:`;
const queue = new Queue(name, { connection: redis, skipVersionCheck: true });
const adapter = new BullJobs(redis);
adapter.queue = () => queue;
const record = (v) => console.log(JSON.stringify(v));
try {
  const redisVersion = /redis_version:([^\r\n]+)/.exec(await redis.info('server'))?.[1];
  record({ bullmqVersion: version, redisVersion, validation: 'real BullJobs.add; isolated audit queue; version check skipped only to reach job validation on this local Redis' });
  const cases = [
    ['email.send', {template:'verify_email',to:'audit@example.com',locale:'en',tenantId:null,data:{},messageKey:'abc'}, jobIds.email('abc')],
    ['push.send', {tenantId:'tenant',ticketId:'ticket',round:1,attempt:1,manual:false}, jobIds.push('ticket',1,1)],
    ['alert.repeat', {tenantId:'tenant',ticketId:'ticket',round:1,n:2}, jobIds.repeat('ticket',1,2)],
    ['alert.overdue-flag', {tenantId:'tenant',ticketId:'ticket',round:1}, jobIds.overdue('ticket',1)],
    ['tenant.export', {tenantId:'tenant',exportId:'export'}, jobIds.export('abc')],
    ['tenant.purge', {tenantId:'tenant'}, jobIds.purge('tenant', 1)],
    ['billing.stripe-event', {eventId:'evt'}, jobIds.stripe('evt', 1)],
    ['webhook.fanout', {tenantId:'tenant',venueId:null,type:'ticket.ready',eventKey:'ob1',data:{}}, jobIds.webhookFanout(1)],
    ['webhook.deliver', {tenantId:'tenant',deliveryId:1}, jobIds.webhookDeliver(1)],
  ];
  let failures = 0;
  for (const [job, data, jobId] of cases) {
    try { await adapter.add(job, data, {jobId}); record({job,jobId,added:true}); }
    catch(e) { failures++; record({job,jobId,error:e.message}); }
  }
  if (failures) throw new Error(`${failures} job id(s) rejected by the installed queue`);

} finally {
  await queue.close();
  const keys = await redis.keys(`${prefix}*`);
  for (const key of keys) { if (!key.startsWith(prefix)) throw new Error('Refuse cleanup outside isolated audit queue'); await redis.del(key); }
  await redis.quit();
}
