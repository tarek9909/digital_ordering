import { z } from 'zod';
import { parseIpRules, splitRules, type IpRules } from './net.js';

export * from './net.js';

// Environment (TRD appendix 30.6). Parsed with Zod at start-up; the process exits when anything is missing.

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'dev', 'staging', 'production', 'test']).default('local'),
  SERVICE_ROLE: z.enum(['api', 'realtime', 'worker', 'scheduler']).default('api'),
  PORT: z.coerce.number().int().default(4000),
  PLATFORM_DOMAIN: z.string().min(3),
  DATABASE_URL: z.string().url(),
  DATABASE_REPLICA_URL: z.string().url().optional(),
  REDIS_CACHE_URL: z.string().url(),
  REDIS_QUEUE_URL: z.string().url(),
  S3_BUCKET_ASSETS: z.string().default('dop-assets'),
  S3_BUCKET_EXPORTS: z.string().default('dop-exports'),
  /** S3-compatible storage (MinIO on the VPS). Internal URL the services use. */
  S3_ENDPOINT: z.string().url().optional(),
  /** Public URL of the same storage, used to sign download links (e.g. https://files.example.com). */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  CDN_BASE_URL: z.string().url(),
  KMS_KEY_ID: z.string().default('local'),
  /** 32-byte base64 data key for envelope encryption (TR-DB-06). On the VPS it is read from a Docker secret file. */
  DATA_KEY: z.string().optional(),
  DATA_KEY_FILE: z.string().optional(),
  /** Development alias of DATA_KEY. */
  LOCAL_DATA_KEY: z.string().optional(),
  SESSION_PEPPER: z.string().min(16),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:push@localhost'),
  SES_REGION: z.string().default('me-central-1'),
  EMAIL_FROM: z.string().default('no-reply@localhost'),
  SMTP_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FOODICS_CLIENT_ID: z.string().optional(),
  FOODICS_CLIENT_SECRET: z.string().optional(),
  FOODICS_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * Reverse proxies whose X-Forwarded-For / X-Forwarded-Host are believed: comma-separated IPs or CIDRs (on the VPS,
   * Caddy's fixed address). Empty or `false` trusts nobody. `true` is accepted only locally, where it means
   * loopback (the Vite dev proxy). Default: loopback locally, nobody elsewhere.
   */
  TRUST_PROXY: z.string().optional(),
  /**
   * Console IP allow-list (TR-SEC-12, M-18). `off` is the operator's recovery switch when a saved list locks
   * everyone out: restart the API with it, fix the list in the console, then restart without it.
   */
  CONSOLE_IP_POLICY: z.enum(['enforce', 'off']).default('enforce'),
  /** Local only: cookies without `Secure`/`__Host-` when serving plain http. */
  INSECURE_COOKIES: bool.default('false'),
});

export type Env = z.infer<typeof envSchema>;

/** Environments reachable by other people: these get the production-style guards (L-9). */
export const isDeployedEnv = (appEnv: Env['APP_ENV']) => appEnv === 'dev' || appEnv === 'staging' || appEnv === 'production';

/** Values copied from the examples; never acceptable outside a developer machine. */
const DEV_PEPPERS = new Set(['local-dev-pepper-change-me-0123456789']);
const isPlaceholder = (v: string) => /placeholder|change_?me/i.test(v);

/** The parsed TRUST_PROXY rules for this environment (M-7). */
export function trustedProxiesOf(env: Pick<Env, 'APP_ENV' | 'TRUST_PROXY'>): IpRules {
  const local = env.APP_ENV === 'local' || env.APP_ENV === 'test';
  const raw = env.TRUST_PROXY?.trim();
  if (raw === undefined || raw === '') return parseIpRules(local ? ['loopback'] : []);
  if (raw === 'true' || raw === '1') {
    if (!local) throw new Error("TRUST_PROXY=true would trust any client; list the proxy addresses instead (for example Caddy's IP)");
    return parseIpRules(['loopback']);
  }
  return parseIpRules(splitRules(raw));
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${lines}`);
  }
  const env = parsed.data;
  // A production build must say which environment it is; it never falls back to local behaviour (L-9).
  if (env.NODE_ENV === 'production' && (env.APP_ENV === 'local' || env.APP_ENV === 'test')) {
    throw new Error(`APP_ENV=${env.APP_ENV} with NODE_ENV=production; set APP_ENV to dev, staging or production`);
  }
  trustedProxiesOf(env); // throws on a malformed or unsafe TRUST_PROXY
  if (isDeployedEnv(env.APP_ENV)) {
    if (env.INSECURE_COOKIES) throw new Error(`INSECURE_COOKIES is not allowed when APP_ENV=${env.APP_ENV}`);
    if (env.LOCAL_DATA_KEY) throw new Error('LOCAL_DATA_KEY is for development; set DATA_KEY_FILE (Docker secret)');
    if (!env.DATA_KEY && !env.DATA_KEY_FILE) throw new Error('DATA_KEY_FILE (or DATA_KEY) is required outside local development');
    if (env.SESSION_PEPPER.length < 32 || DEV_PEPPERS.has(env.SESSION_PEPPER) || isPlaceholder(env.SESSION_PEPPER)) {
      throw new Error('SESSION_PEPPER must be a long random value (scripts/init-secrets.sh), not the example');
    }
  }
  return env;
}

/** Hosts derived from the platform domain (TRD §5.1). */
export function hosts(domain: string) {
  return {
    www: `www.${domain}`,
    customer: `t.${domain}`,
    console: `admin.${domain}`,
    api: `api.${domain}`,
    cdn: `cdn.${domain}`,
    tenant: (slug: string) => `${slug}.${domain}`,
  };
}
