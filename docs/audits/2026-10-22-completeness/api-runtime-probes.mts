// Isolated completeness audit. Run from backend: npx tsx --tsconfig tsconfig.json ../docs/audits/2026-10-22-completeness/api-runtime-probes.mts [--serve]
// No production dependencies: disposable MySQL, MemoryJobs/KV, local object files, fake billing.
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { makeApi, client } from '../../../backend/apps/api/test/helpers.ts';
import { ROUTE_GROUPS } from '../../../backend/apps/api/src/app.ts';
import { webhookRoutes } from '../../../backend/apps/api/src/routes/webhooks.ts';
import { connectorRoutes } from '../../../backend/apps/api/src/routes/connectors.ts';
import { createRealtime, fanOut } from '../../../backend/apps/realtime/src/server.ts';
import { currentTotp } from '../../../backend/packages/auth/src/index.ts';
import * as svc from '../../../backend/packages/services/src/index.ts';
const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const request = require('supertest');
const test = await startTestDatabase();
const { app, deps } = makeApi(test.clients);
deps.config = { ...deps.config, domain: 'dop.localhost', appEnv: 'local', scheme: 'http', localPorts: { customer:5273,staff:5274,display:5275,admin:5276,console:5277,www:5278 } };
deps.now = () => new Date();
// Bulk route coverage checks auth and validation, not throttling. Other existing tests retain real budgets.
deps.rateLimit = async () => {};
const rows: any[] = [];
const groups = [...ROUTE_GROUPS, webhookRoutes, connectorRoutes];
const record = (name: string, data: any) => { rows.push({ name, ...data }); console.log(JSON.stringify({ name, ...data })); };
let serving = false;
try {
  const seeded = await svc.seedDemo(deps);
  const fixture = seeded.tenants.find(t => t.slug === 'burger-house')!;
  const tenant = await test.clients.platform().selectFrom('tenants').selectAll().where('slug','=','burger-house').executeTakeFirstOrThrow();
  const user = await test.clients.platform().selectFrom('users').select('id').where('email','=',fixture.ownerEmail).executeTakeFirstOrThrow();
  const pro = await test.clients.platform().selectFrom('plans').select('id').where('code','=','pro').executeTakeFirstOrThrow();
  await test.clients.platform().updateTable('tenants').set({plan_id:pro.id}).where('id','=',tenant.id).execute();
  await deps.kv.del(`t:${tenant.id}:flags`);
  const owner = {kind:'user' as const,userId:user.id,tenantId:tenant.id,role:'owner' as const,sessionId:'audit',mfaVerified:true};
  const admin = client(app,'burger-house.dop.localhost');
  const session = await svc.createUserSession(deps,user.id,tenant.id,{ip:'127.0.0.1',userAgent:'audit',host:'burger-house.dop.localhost'},true);
  admin.jar.set('dop_sid',session.token);
  admin.setCsrf(svc.csrfFor(deps,session.sessionId));
  const wwwSession = await svc.createUserSession(deps,user.id,null,{ip:'127.0.0.1',userAgent:'audit',host:'www.dop.localhost'},true);
  const consoleClient = client(app,'admin.dop.localhost');
  const signIn = await svc.signInPlatform(deps,'super@dop.localhost','dev-password-123',{ip:'127.0.0.1',userAgent:'audit',host:'admin.dop.localhost'});
  const ps = await svc.signInPlatformMfa(deps,signIn.mfaToken,currentTotp('JBSWY3DPEHPK3PXP'),{ip:'127.0.0.1',userAgent:'audit',host:'admin.dop.localhost'});
  consoleClient.jar.set('dop_psid',ps.token);
  consoleClient.setCsrf(svc.csrfFor(deps,ps.sessionId));
  const platform = {kind:'platform' as const,platformUserId:ps.userId,role:'super_admin' as const,sessionId:ps.sessionId,mfaVerifiedAt:new Date()};
  const counter = await svc.createCounter(deps,owner,tenant.id,fixture.venueId,{name:'Food',prefix:'A'});
  const display = (await svc.listDisplays(deps,tenant.id,fixture.venueId))[0];
  const pairing = await svc.issuePairingCode(deps,tenant.id,display.id);
  const dsp = await svc.pairDisplay(deps,pairing.code,'burger-house.dop.localhost');
  const staffKey = fixture.staffLink.split('/staff/')[1]!;
  const dev = await svc.staffSignIn(deps,{staffKey,pin:'4821',deviceName:'Audit tablet'},{ip:'127.0.0.1',userAgent:'audit',fingerprint:'audit',host:'burger-house.dop.localhost'});
  const key = await svc.createApiKey(deps,owner,tenant.id,fixture.venueId,'Audit integration');
  const wh = await svc.createWebhook(deps,owner,tenant.id,{url:'https://webhook.example.test/events',events:['ticket.ready']});
  const ticket = (await svc.createTicket(deps,owner,fixture.venueId,{})).ticket;
  const values: Record<string,string> = { token:'X'.repeat(22),venueCode:'AAAAAA',slug:'available-audit-slug',kind:'terms',key:'maintenance',provider:'foodics',code:'en',deliveryId:'1',template:'welcome',locale:'en' };
  const hosts = {customer:'t.dop.localhost',www:'www.dop.localhost',tenant:'burger-house.dop.localhost',console:'admin.dop.localhost',integration:'api.dop.localhost'};
  const boundaries:any[] = [];
  for(const group of groups) for(const route of group.defs) {
    const path = (group.prefix+route.path).replace(/:([A-Za-z_]+)/g,(_,p)=>values[p]??'00000000-0000-7000-8000-000000000001');
    const r = await request(app)[route.method](path).set('Host',hosts[route.surfaces[0]]).send(route.method==='get'?undefined:{});
    boundaries.push({method:route.method.toUpperCase(),path:group.prefix+route.path,surface:route.surfaces[0],permission:route.permission,status:r.status,code:r.body?.code??null});
  }
  await writeFile(new URL('api-anonymous-boundaries.json',import.meta.url),JSON.stringify(boundaries,null,2)+'\n');
  record('anonymous-route-boundaries',{count:boundaries.length,byStatus:boundaries.reduce((a,r)=>({...a,[r.status]:(a[r.status]??0)+1}),{}),unexpected:boundaries.filter(r=>r.status>=500||(r.permission!=='public'&&r.status<400))});
  const authenticatedReads:any[]=[];
  for(const group of groups) for(const route of group.defs.filter(r=>r.method==='get')) {
    const surface=route.surfaces[0];
    const resourceId = route.path.includes('/venues/') ? fixture.venueId : route.path.includes('/tenants/') ? tenant.id : route.path.includes('/webhooks/') ? wh.id : route.path.includes('/plans/') ? pro.id : '00000000-0000-7000-8000-000000000001';
    const pv={...values,id:resourceId,token:ticket.token,venueCode:(await svc.getVenueAdmin(deps,tenant.id,fixture.venueId)).venueCode};
    const path=(group.prefix+route.path).replace(/:([A-Za-z_]+)/g,(_,p)=>pv[p]??'00000000-0000-7000-8000-000000000001');
    let schema:any=route.query;
    while(schema?._def?.schema) schema=schema._def.schema;
    const shape=typeof schema?._def?.shape==='function'?schema._def.shape():{};
    const candidates={from:'2026-10-01',to:'2026-10-22',venueId:fixture.venueId,counterId:counter.id,tenantIds:tenant.id,q:'A',limit:'20',tokens:ticket.token,clientId:'B'.repeat(22),locale:'en'};
    const query=Object.fromEntries(Object.keys(shape).filter(k=>k in candidates).map(k=>[k,candidates[k]]));
    let r=request(app).get(path).set('Host',hosts[surface]).set('X-Purpose','support').query(query);
    if(surface==='tenant') r=r.set('Cookie',group.prefix.includes('/display/')?`dop_dsp=${dsp.token}`:`dop_sid=${session.token}`);
    if(surface==='console') r=r.set('Cookie',`dop_psid=${ps.token}`);
    if(surface==='www') r=r.set('Cookie',`dop_sid=${wwwSession.token}`);
    if(surface==='integration') r=r.set('Authorization',`Bearer ${key.key}`);
    const res=await r;
    authenticatedReads.push({method:'GET',path:group.prefix+route.path,surface,status:res.status,code:res.body?.code??null});
  }
  await writeFile(new URL('api-authenticated-reads.json',import.meta.url),JSON.stringify(authenticatedReads,null,2)+'\n');
  record('authenticated-get-sweep',{count:authenticatedReads.length,byStatus:authenticatedReads.reduce((a,r)=>({...a,[r.status]:(a[r.status]??0)+1}),{}),unexpected500:authenticatedReads.filter(r=>r.status>=500)});
  const emptyPatches = [
    ['tenant',admin,'/api/admin/v1/tenant'],['venue',admin,`/api/admin/v1/venues/${fixture.venueId}`],['counter',admin,`/api/admin/v1/counters/${counter.id}`],['display',admin,`/api/admin/v1/displays/${display.id}`],['profile',admin,'/api/admin/v1/me'],['webhook',admin,`/api/admin/v1/webhooks/${wh.id}`],['plan',consoleClient,`/api/console/v1/plans/${pro.id}`],['platform-user',consoleClient,`/api/console/v1/platform-users/${ps.userId}`],['language',consoleClient,'/api/console/v1/languages/en']
  ] as const;
  for(const [name,c,path] of emptyPatches){ const r=await c.patch(path,{});record(`empty-patch-${name}`,{path,status:r.status,code:r.body?.code??null}); }
  const noProofEnrollment=await admin.post('/api/auth/v1/mfa/totp/enroll',{});
  record('totp-enrollment-current-ui-payload',{path:'/api/auth/v1/mfa/totp/enroll',status:noProofEnrollment.status,code:noProofEnrollment.body?.code??null});
  const enrollment=await admin.post('/api/auth/v1/mfa/totp/enroll',{password:'dev-password-123'});
  record('totp-enrollment-valid-password',{path:'/api/auth/v1/mfa/totp/enroll',status:enrollment.status,code:enrollment.body?.code??null});
  // Ordinary duplicate inputs, resource mismatches, and malformed query inputs.
  const r1=await admin.post(`/api/admin/v1/venues/${fixture.venueId}/staff-members`,{name:'Sara',pin:'5937'});
  const r2=await admin.post(`/api/admin/v1/venues/${fixture.venueId}/staff-members`,{name:'Sara duplicate',pin:'5937'});
  record('duplicate-named-staff-pin',{first:r1.status,second:r2.status,code:r2.body?.code??null});
  for(const path of [`/api/staff/v1/board?venueId=${fixture.venueId}?q=A`,`/api/staff/v1/tickets/search?venueId=${fixture.venueId}?q=A`,`/api/admin/v1/reports/today?venueId=00000000-0000-7000-8000-000000000001`,`/api/admin/v1/reports/trends?from=2026-10-01&to=2026-10-22&venueId=00000000-0000-7000-8000-000000000001`]){
    const r=await admin.get(path);record('query-probe',{path,status:r.status,code:r.body?.code??null});
  }
  // Duplicate legal version must not replace the published asset even when insertion is rejected.
  const legal = await svc.createLegalDocument(deps,deps.storage,platform,{kind:'terms',version:'audit-v1',locale:'en',html:'<p>Original accepted terms</p>'});
  await svc.publishLegalDocument(deps,platform,legal.id);
  const original = (await svc.legalDocument(deps,'terms','en',deps.storage))?.html;
  let errorCode:string|null=null;
  try { await svc.createLegalDocument(deps,deps.storage,platform,{kind:'terms',version:'audit-v1',locale:'en',html:'<p>Replacement rejected by API</p>'}); } catch(e:any){errorCode=e.code??e.message;}
  const after = (await svc.legalDocument(deps,'terms','en',deps.storage))?.html;
  record('duplicate-published-legal-asset',{errorCode,original,after,changed:original!==after});
  // Valid UUIDs for missing resources should become 404, not unhandled SQL/driver exceptions.
  const missing='00000000-0000-7000-8000-000000000001';
  for(const path of [`/api/admin/v1/venues/${missing}`,`/api/admin/v1/venues/${missing}/staff-access`,`/api/admin/v1/venues/${missing}/displays`,`/api/admin/v1/venues/${missing}/devices`,`/api/admin/v1/venues/${missing}/counters`]){ const r=await admin.get(path);record('missing-resource-get',{path,status:r.status,code:r.body?.code??null}); }
  for(const path of [`/api/console/v1/tenants/${missing}`,`/api/console/v1/tenants/${missing}/billing`]){ const r=await request(app).get(path).set('Host','admin.dop.localhost').set('Cookie',`dop_psid=${ps.token}`).set('X-Purpose','support');record('missing-console-resource',{path,status:r.status,code:r.body?.code??null}); }
  const registry=groups.map(g=>({prefix:g.prefix,routes:g.defs.map(({handler,body,params,query,...meta})=>({...meta,hasBody:!!body,hasQuery:!!query,hasParams:!!params}))}));
  await writeFile(new URL('api-route-registry.json',import.meta.url),JSON.stringify(registry,null,2)+'\n');
  await writeFile(new URL('api-runtime-results.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
  if(process.argv.includes('--serve')){
    const rtHttp=createServer();
    const rt=createRealtime(rtHttp,{deps,insecureCookies:true,isAllowedOrigin:()=>true});
    const publish=deps.kv.publish.bind(deps.kv);
    deps.kv.publish=async(ch,msg)=>{await publish(ch,msg);fanOut(rt,JSON.parse(msg));};
    const venueCode=(await svc.getVenueAdmin(deps,tenant.id,fixture.venueId)).venueCode;
    const server=app.listen(4400,'127.0.0.1');
    rtHttp.listen(4401,'127.0.0.1');
    serving=true;
    console.log('ISOLATED_AUDIT_READY 4400 4401');
    const stop=async()=>{server.close();rt.close();rtHttp.close();await test.stop();process.exit(0);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }
} finally { await writeFile(new URL('api-runtime-results.json',import.meta.url),JSON.stringify(rows,null,2)+'\n'); if(!serving) await test.stop(); }
