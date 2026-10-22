import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { makeTestDeps } from '../../../backend/packages/services/src/testing.ts';
// Regression probe (converted after the repairs): fails unless A31 and A30 behave correctly.
import * as svc from '../../../backend/packages/services/src/index.ts';
const t=await startTestDatabase();const deps=makeTestDeps(t.clients,new Date());
const out=(name,v)=>console.log(JSON.stringify({name,...v}));
let n=0;
async function tenant(){
 n++;const x=await svc.signup(deps,{ownerName:'Audit',email:`fault-${n}@x.test`,password:'a-long-unique-passphrase',restaurantName:`Fault Cafe ${n}`,slug:`fault-cafe-${n}`,country:'SA',locale:'ar',acceptTerms:true},{ip:'1.1.1.1'});
 await t.clients.platform().updateTable('users').set({email_verified_at:deps.now()}).where('id','=',x.userId).execute();
 return {...x,actor:{kind:'staff_device',deviceId:'d',tenantId:x.tenantId,venueId:x.venueId,deviceName:'iPad'}};
}
try{
 const x=await tenant();const ticket=(await svc.createTicket(deps,x.actor,x.venueId,{})).ticket;
 for(const [clientId,suffix] of [['A'.repeat(22),'ok'],['B'.repeat(22),'transient']]){
  await svc.follow(deps,ticket.token,{clientId,joinedVia:'ticket_qr',uaFamily:'other'});
  await svc.savePushSubscription(deps,ticket.token,{clientId,subscription:{endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,keys:{p256dh:'x'.repeat(40),auth:'y'.repeat(16)}}},'fcm');
 }
 await svc.transitionTicket(deps,x.actor,ticket.id,{to:'ready',version:1});deps.jobs.take();
 const calls=[];
 const job={tenantId:x.tenantId,ticketId:ticket.id,round:1,attempt:1,manual:false};
 let firstTry=null;try{await svc.firstAlert(deps,async(m)=>{const status=m.endpoint.endsWith('/ok')?201:503;calls.push({endpointSuffix:m.endpoint.split('/').pop(),status});return status;},job);}catch(e){firstTry={retryable:e.retryable===true,message:e.message};}
 // the queue retries the job; only the failed recipient is sent again
 const result=await svc.firstAlert(deps,async(m)=>{calls.push({endpointSuffix:m.endpoint.split('/').pop(),status:201});return 201;},job);
 const subs=await t.clients.platform().selectFrom('push_subscriptions').select(['endpoint','last_success_at','failure_count']).execute();
 out('multi-follower-transient-push',{firstTry,retryResult:result,calls,subscriptionResults:subs.map(s=>({endpointSuffix:s.endpoint.split('/').pop(),lastSuccessAt:s.last_success_at?.toISOString()??null,failureCount:s.failure_count}))});
 if(!firstTry?.retryable||result.sent!==1||calls.length!==3||calls[2].endpointSuffix!=='transient')throw new Error('A31 not repaired: failing recipient was not retried alone');
 const p=await tenant();await svc.markDeleted(deps,p.tenantId,{kind:'system'});
 const kvKey=`t:${p.tenantId}:fault-object-cleanup`;await deps.kv.set(kvKey,'stranded');
 const objects=new Map([[`assets:tenants/${p.tenantId}/logos/test.png`,Buffer.from('logo')],[`exports:exports/${p.tenantId}/test.zip`,Buffer.from('export')]]);
 let deleteCalls=0;let failOnce=true;
 const storage={
  async put(bucket,key,body){objects.set(`${bucket}:${key}`,body);},
  async get(bucket,key){return objects.get(`${bucket}:${key}`)??null;},
  async signedUrl(){return 'https://audit.invalid';},
  async deletePrefix(bucket,prefix){deleteCalls++;if(failOnce){failOnce=false;throw new Error('Injected temporary object-storage outage');}let deleted=0;for(const key of objects.keys())if(key.startsWith(`${bucket}:${prefix}`)){objects.delete(key);deleted++;}return deleted;},
 };
 let firstError=null;try{await svc.purgeTenant(deps,p.tenantId,storage);}catch(e){firstError=e.message;}
 const tenantAfterFirst=await t.clients.platform().selectFrom('tenants').select('id').where('id','=',p.tenantId).executeTakeFirst();
 out('purge-storage-failure',{error:firstError,tenantExists:!!tenantAfterFirst,deletePrefixCalls:deleteCalls,objectsRemaining:objects.size,tenantKvKeyExists:await deps.kv.exists(kvKey)});
 const retry=await svc.purgeTenant(deps,p.tenantId,storage);
 const tenantAfterRetry=await t.clients.platform().selectFrom('tenants').select('id').where('id','=',p.tenantId).executeTakeFirst();
 out('purge-after-storage-recovery',{result:retry,deletePrefixCalls:deleteCalls,objectsRemaining:objects.size,tenantKvKeyExists:await deps.kv.exists(kvKey),tenantExists:!!tenantAfterRetry});
 if(!firstError||!tenantAfterFirst||objects.size!==0||await deps.kv.exists(kvKey)||tenantAfterRetry||!retry.done)throw new Error('A30 not repaired: purge did not resume');
}finally{await t.stop();}
