import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { makeApi, client } from '../../../backend/apps/api/test/helpers.ts';
import * as svc from '../../../backend/packages/services/src/index.ts';
import { defaultVenueSettings } from '../../../backend/packages/contracts/src/index.ts';
import { newTotpSecret } from '../../../backend/packages/auth/src/index.ts';
// Probe log (re-run after the repairs): each line now records the corrected outcome; assertions live in
// backend/apps/api/test/audit-repairs.int.test.ts.
const t = await startTestDatabase();
const api = makeApi(t.clients);
const out = (name, v) => console.log(JSON.stringify({name,...v}));
const check = async (name, fn) => {try {out(name,{result:await fn()});} catch(e){out(name,{error:{code:e.code,message:e.message}})}};
try {
const x = await svc.signup(api.deps, {ownerName:'Audit Owner',email:'audit@x.test',password:'a-long-unique-passphrase',restaurantName:'Audit Cafe',slug:'audit-cafe',country:'SA',locale:'ar',acceptTerms:true},{ip:'1.1.1.1'});
await t.clients.platform().updateTable('users').set({email_verified_at:new Date()}).where('id','=',x.userId).execute();
const owner = {kind:'user',userId:x.userId,tenantId:x.tenantId,role:'owner',sessionId:'s',mfaVerified:false};
const admin=client(api.app,'audit-cafe.dop.test');
await admin.post('/api/auth/v1/sign-in',{email:'audit@x.test',password:'a-long-unique-passphrase'});
const me=await admin.get('/api/auth/v1/me');admin.setCsrf(me.body.csrfToken);
const c1 = await svc.createCounter(api.deps,owner,x.tenantId,x.venueId,{name:'Food',prefix:'A'});
const c2 = await svc.createCounter(api.deps,owner,x.tenantId,x.venueId,{name:'Drinks',prefix:'B'});
const d = await svc.createDisplay(api.deps,owner,x.tenantId,x.venueId,{name:'TV'});
for (const [name,path,b] of [
['duplicate-counter-prefix',`/api/admin/v1/counters/${c2.id}`,{prefix:'A'}],
['empty-counter-patch',`/api/admin/v1/counters/${c2.id}`,{}],
['empty-venue-patch',`/api/admin/v1/venues/${x.venueId}`,{}],
['empty-display-patch',`/api/admin/v1/displays/${d.id}`,{}],
]) {const r=await admin.patch(path,b);out(name,{status:r.status,body:r.body});}
for (const [name,path] of [
['invalid-staff-venue-id','/api/staff/v1/board?venueId=bad'],
['invalid-trend-date','/api/admin/v1/reports/trends?from=2026-99-99&to=2026-99-99'],
['invalid-heatmap-date','/api/admin/v1/reports/heatmap?from=2026-99-99&to=2026-99-99'],
]) {const r=await admin.get(path);out(name,{status:r.status,body:r.body});}
const checkout=await admin.post('/api/admin/v1/billing/checkout',{planCode:'pro',period:'month'});out('pro-checkout',{status:checkout.status,body:checkout.body});
const planBefore=await svc.tenantPlan(api.deps,x.tenantId);out('before-plan-change',{plan:planBefore.planCode,api_access:await svc.isEnabled(api.deps,x.tenantId,'api_access')});
const changed=await admin.post('/api/admin/v1/billing/change-plan',{planCode:'pro',period:'month'});out('trial-self-upgrade-pro',{status:changed.status,body:changed.body,plan:(await svc.tenantPlan(api.deps,x.tenantId)).planCode,api_access:await svc.isEnabled(api.deps,x.tenantId,'api_access'),providerCalls:api.deps.billing.calls});
const keyRes=await admin.post(`/api/admin/v1/venues/${x.venueId}/api-keys`,{name:'Trial key'});out('trial-create-pro-api-key',{status:keyRes.status,keyIssued:!!keyRes.body.key});
const actor={kind:'staff_device',deviceId:'d',tenantId:x.tenantId,venueId:x.venueId,deviceName:'iPad'};
const tk=(await svc.createTicket(api.deps,actor,x.venueId,{})).ticket;
const clientId='A'.repeat(22);
await svc.follow(api.deps,tk.token,{clientId,joinedVia:'ticket_qr',uaFamily:'other'});
await svc.savePushSubscription(api.deps,tk.token,{clientId,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/audit',keys:{p256dh:'x'.repeat(40),auth:'y'.repeat(16)}}},'fcm');
await svc.transitionTicket(api.deps,actor,tk.id,{to:'ready',version:1});
await svc.firstAlert(api.deps,async()=>201,{tenantId:x.tenantId,ticketId:tk.id,round:1,attempt:1,manual:false});
let senderCalls=0;
await check('repeat-first-transient-failure',()=>svc.repeatAlert(api.deps,async()=>{senderCalls++;return 503},{tenantId:x.tenantId,ticketId:tk.id,round:1,n:2}));
const retry=await svc.repeatAlert(api.deps,async()=>{senderCalls++;return 201},{tenantId:x.tenantId,ticketId:tk.id,round:1,n:2});out('repeat-retry',{result:retry,senderCalls,ticket:await t.clients.forTenant(x.tenantId).selectFrom('tickets').select(['auto_alerts_sent']).where('id','=',tk.id).executeTakeFirst()});
const settings=defaultVenueSettings();settings.claims.mode='staff_approval';await svc.putVenueSettings(api.deps,owner,x.tenantId,x.venueId,settings);
const venueCode=(await svc.getVenueAdmin(api.deps,x.tenantId,x.venueId)).venueCode;
const claim=await svc.claimTicket(api.deps,venueCode,{clientId:'B'.repeat(22),number:tk.display_number},'other');
await svc.transitionTicket(api.deps,actor,tk.id,{to:'collected',version:2});
await svc.expireClaims(api.deps);out('closed-ticket-pending-claim',{claim:await svc.claimStatus(api.deps,claim.claimId,'B'.repeat(22))});
await svc.rateTicket(api.deps,tk.token,{clientId,stars:5,comment:'good'});
const bd=tk.business_date;
await svc.rollupVenueDay(api.deps,x.tenantId,x.venueId,bd);
const ratingsBefore=await svc.trendsReport(api.deps,x.tenantId,{from:bd,to:bd});
const rating=(await svc.listRatings(api.deps,x.tenantId))[0];await svc.deleteRatingComment(api.deps,owner,x.tenantId,rating.id);
await svc.rollupVenueDay(api.deps,x.tenantId,x.venueId,bd);
const ratingsAfter=await svc.trendsReport(api.deps,x.tenantId,{from:bd,to:bd});out('delete-comment-removes-rating-report',{before:ratingsBefore.current.ratingAvg,after:ratingsAfter.current.ratingAvg,beforeCount:ratingsBefore.current.ratingsCount,afterCount:ratingsAfter.current.ratingsCount});
// Named staff needs a plan with the feature; the trial tenant is moved to Pro directly (no longer possible via change-plan, A02).
await t.clients.platform().updateTable('tenants').set({plan_id:(await t.clients.platform().selectFrom('plans').select('id').where('code','=','pro').executeTakeFirst()).id}).where('id','=',x.tenantId).execute();await api.deps.kv.del(`t:${x.tenantId}:flags`);
const member = await svc.createStaffMember(api.deps,owner,x.tenantId,x.venueId,'Sara','5937');
const unlocked=await svc.staffMemberUnlock(api.deps,x.tenantId,x.venueId,'d','5937');await svc.deactivateStaffMember(api.deps,x.tenantId,member.id);out('disabled-member-token-still-valid',{result:await svc.staffMemberFor(api.deps,unlocked.memberToken,'d')});
const usage=await svc.usageOf(api.deps,x.tenantId);out('downgrade-usage-ignores-api-keys',{reported:usage.maxApiKeysInAVenue,actual:Number((await t.clients.forTenant(x.tenantId).selectFrom('api_keys').select((eb)=>eb.fn.countAll().as('n')).where('revoked_at','is',null).executeTakeFirst()).n)});
await svc.archiveCounter(api.deps,owner,x.tenantId,c2.id);
const downgrade=await admin.post('/api/admin/v1/billing/change-plan',{planCode:'standard',period:'month'});out('downgrade-with-active-pro-key',{status:downgrade.status,body:downgrade.body,activeKeys:Number((await t.clients.forTenant(x.tenantId).selectFrom('api_keys').select((eb)=>eb.fn.countAll().as('n')).where('revoked_at','is',null).executeTakeFirst()).n)});
const oldTimeZone=(await svc.getVenueAdmin(api.deps,x.tenantId,x.venueId)).timeZone;const zoneChange=await admin.patch(`/api/admin/v1/venues/${x.venueId}`,{timeZone:'UTC'});out('time-zone-applies-immediately',{status:zoneChange.status,oldTimeZone,newTimeZone:zoneChange.body.timeZone,pendingFromDate:zoneChange.body.pendingFromDate,currentUtcDate:api.deps.now().toISOString().slice(0,10)});
const multiPlan=(await t.clients.platform().selectFrom('plans').select('id').where('code','=','multisite').executeTakeFirst()).id;
await t.clients.platform().updateTable('tenants').set({plan_id:multiPlan}).where('id','=',x.tenantId).execute();await api.deps.kv.del(`t:${x.tenantId}:flags`);
await svc.createVenue(api.deps,api.deps.billing,owner,x.tenantId,'Second');
const wwwSession=await svc.createUserSession(api.deps,x.userId,null,{ip:'1',userAgent:'audit',host:'www.dop.test'},true);
const handoff=await svc.createHandoff(api.deps,x.userId,'audit-cafe','audit');const exchanged=await svc.exchangeHandoff(api.deps,handoff.code,{ip:'1',userAgent:'audit',host:'audit-cafe.dop.test'},x.tenantId);
const handoffSession=await svc.resolveUserSession(api.deps,exchanged.token,'audit-cafe.dop.test');out('handoff-without-authenticator',{wwwMfa:true,tenantMfa:handoffSession.mfaVerified,note:'this user has no authenticator, so enrolment is still required; the enrolled case (A04) is asserted in requirements-probe.mts'});
const handoffClient=client(api.app,'audit-cafe.dop.test');handoffClient.jar.set('dop_sid',exchanged.token);const venues=await handoffClient.get('/api/admin/v1/venues');out('multi-venue-handoff-admin',{status:venues.status,body:venues.body});
} finally {await t.stop();}


