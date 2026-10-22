import { createServer } from 'node:http';
import { loadEnv, trustedProxiesOf } from '@dop/config';
import type { BusEvent } from '@dop/contracts';
import { EVENTS_CHANNEL, createRuntime, presenceExpired } from '@dop/services';
import { createAdapter } from '@socket.io/redis-adapter';
import { appOriginCheck, createRealtime, fanOut } from './server.js';

const env = loadEnv();
const rt = await createRuntime(env);
const { deps } = rt;
const log = deps.log;
const cache = rt.cache;
const sub = cache.duplicate();
const adapterPub = cache.duplicate();
const adapterSub = cache.duplicate();

const domain = env.PLATFORM_DOMAIN;
const http = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
});
const io = createRealtime(http, {
  deps,
  insecureCookies: env.INSECURE_COOKIES,
  trustProxy: trustedProxiesOf(env),
  isAllowedOrigin: appOriginCheck(domain),
});
io.adapter(createAdapter(adapterPub, adapterSub));

// Event bus: the api and worker publish outbox events on `events` (TR-EVT-01/02).
await sub.subscribe(EVENTS_CHANNEL);
// Presence expiry via keyspace notifications (TR-ALG-13); the 30-second reconcile in the worker covers misses.
await cache.config('SET', 'notify-keyspace-events', 'Ex').catch(() => log.warn('could not enable keyspace notifications; relying on presence.reconcile'));
await sub.psubscribe('__keyevent@*__:expired');
sub.on('message', (_ch, msg) => {
  try {
    fanOut(io, JSON.parse(msg) as BusEvent, deps);
  } catch (err) {
    log.warn({ err }, 'bad bus event');
  }
});
sub.on('pmessage', (_p, _ch, key) => {
  if (key.startsWith('pres:')) void presenceExpired(deps, key).catch((err: unknown) => log.warn({ err }, 'presence expiry failed'));
});

http.listen(env.PORT, () => log.info({ port: env.PORT }, 'realtime listening'));
