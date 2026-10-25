import { loadEnv, trustedProxiesOf } from '@dop/config';
import { createFoodicsConnector, createGoogleProvider, createRuntime, seedDemoOnStartup } from '@dop/services';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { createApp } from './app.js';
import { makeRateLimit } from './http/rate-limit.js';
import { setGoogleProvider } from './routes/auth-r11.js';
import { registerConnector } from './routes/connectors.js';

const env = loadEnv();
const rt = await createRuntime(env);
const { deps } = rt;
if (env.FOODICS_CLIENT_ID && env.FOODICS_CLIENT_SECRET && env.FOODICS_WEBHOOK_SECRET) {
  registerConnector(createFoodicsConnector({ clientId: env.FOODICS_CLIENT_ID, clientSecret: env.FOODICS_CLIENT_SECRET, webhookSecret: env.FOODICS_WEBHOOK_SECRET }));
}
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) setGoogleProvider(await createGoogleProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET));

const app = createApp(
  {
    ...deps,
    insecureCookies: env.INSECURE_COOKIES,
    storage: rt.storage,
    rateLimit: makeRateLimit((name, points, duration) => new RateLimiterRedis({ storeClient: rt.cache, keyPrefix: `rl:${name}`, points, duration })),
  },
  { trustProxy: trustedProxiesOf(env), consoleIpPolicy: env.CONSOLE_IP_POLICY },
);

// Demo accounts for the super admin and admin dashboards: only with SEED_DEMO_DATA=yes, and idempotent.
await seedDemoOnStartup(deps, process.env);

const server = app.listen(env.PORT, () => deps.log.info({ port: env.PORT }, 'api listening'));

// Graceful shutdown for zero-downtime deploys (TR-NFR-07): stop accepting, finish in-flight requests.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    deps.log.info({ sig }, 'shutting down');
    server.close(async () => {
      await rt.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 25_000).unref();
  });
}
