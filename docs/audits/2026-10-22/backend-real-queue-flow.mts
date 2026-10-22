import { createRequire } from 'node:module';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { makeApi, client } from '../../../backend/apps/api/test/helpers.ts';
import { receiveBillingWebhook } from '../../../backend/packages/services/src/billing.ts';
import { BullJobs } from '../../../backend/packages/jobs/src/bull.ts';
const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const { Queue } = require('bullmq'); const Redis=require('ioredis');
const t=await startTestDatabase(); const api=makeApi(t.clients);
// Regression probe (converted): asserts the corrected flow through the real BullJobs adapter. REDIS_URL = Redis 5+.
const redis=new Redis(process.env.REDIS_URL??'redis://127.0.0.1:6379',{maxRetriesPerRequest:null});
const name=`dop-audit-flow-${Date.now()}`;const prefix=`bull:${name}:`;
const queue=new Queue(name,{connection:redis,skipVersionCheck:true});const jobs=new BullJobs(redis);jobs.queue=()=>queue;
api.deps.jobs=jobs;
const out=(name,v)=>console.log(JSON.stringify({name,...v}));
const expectEq=(what,a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);};
try {
 const www=client(api.app,'www.dop.test');
 const input={ownerName:'Audit',email:'real-queue@x.test',password:'a-long-unique-passphrase',restaurantName:'Queue Audit',slug:'queue-audit',country:'SA',locale:'ar',acceptTerms:true};
 const signup=await www.post('/api/public/v1/signup',input);out('real-queue-signup',{status:signup.status,body:signup.body});expectEq('signup status',signup.status,201);
 const tenant=await t.clients.platform().selectFrom('tenants').select(['id','slug']).where('slug','=','queue-audit').executeTakeFirst();
 const user=await t.clients.platform().selectFrom('users').select('id').where('email','=',input.email).executeTakeFirst();
 out('signup-after-500',{tenantPersisted:!!tenant,userPersisted:!!user});
 await t.clients.platform().updateTable('users').set({email_verified_at:new Date()}).where('id','=',user.id).execute();
 const admin=client(api.app,'queue-audit.dop.test');const signin=await admin.post('/api/auth/v1/sign-in',{email:input.email,password:input.password});out('real-queue-signin',{status:signin.status});
 const me=await admin.get('/api/auth/v1/me');admin.setCsrf(me.body.csrfToken);const venues=await admin.get('/api/admin/v1/venues');const venueId=venues.body.items[0].id;
 const created=await admin.post(`/api/staff/v1/tickets?venueId=${venueId}`,{});out('real-queue-ticket-create',{status:created.status,ticketStatus:created.body.ticket?.status,publishedBusEvents:api.deps.kv.published.length});
 const ready=await admin.post(`/api/staff/v1/tickets/${created.body.ticket.id}/transitions?venueId=${venueId}`,{to:'ready',version:1});out('real-queue-ticket-ready',{status:ready.status,ticketStatus:ready.body.ticket?.status,publishedBusEvents:api.deps.kv.published.length});if(api.deps.kv.published.length<2)throw new Error('ticket events not published');
 const exportResponse=await admin.post('/api/admin/v1/exports',{});expectEq('export status',exportResponse.status,202);out('real-queue-export',{status:exportResponse.status,body:exportResponse.body,exports:await t.clients.forTenant(tenant.id).selectFrom('data_exports').select('status').execute()});
 const raw=JSON.stringify({id:'evt_queue_audit',type:'customer.updated',data:{object:{id:'cus_queue_audit',email:'audit@example.com'}}});
 out('real-queue-billing-first',{result:await receiveBillingWebhook(api.deps,api.deps.billing,Buffer.from(raw),api.deps.billing.sign(raw))});
 out('real-queue-billing-retry',{result:await receiveBillingWebhook(api.deps,api.deps.billing,Buffer.from(raw),api.deps.billing.sign(raw)),event:await t.clients.platform().selectFrom('stripe_events').select(['id','processed_at']).where('id','=','evt_queue_audit').executeTakeFirst()});
 const pending=await t.clients.platform().selectFrom('outbox').select(['topic','published_at']).where('tenant_id','=',tenant.id).execute();out('real-queue-outbox',{rows:pending});if(pending.some(r=>!r.published_at))throw new Error('outbox rows left pending');
} finally {
 await queue.close();const keys=await redis.keys(`${prefix}*`);for(const key of keys){if(!key.startsWith(prefix))throw new Error('Invalid cleanup prefix');await redis.del(key);}await redis.quit();await t.stop();
}

