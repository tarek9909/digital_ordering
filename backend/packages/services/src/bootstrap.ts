import { staticKeyProvider, type KeyProvider } from '@dop/auth';
import type { Env } from '@dop/config';
import { createDb } from '@dop/db';
import { BullJobs, MemoryJobs, type Jobs } from '@dop/jobs';
import { readFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import pino, { type Logger } from 'pino';
import { createS3Storage, kmsKeyProvider } from './aws.js';
import { LOCAL_PORTS, type Deps } from './deps.js';
import { RedisKV } from './kv.js';
import { LocalStorage, type ObjectStorage } from './storage.js';

// Builds the dependencies every back-end process needs from the validated environment (appendix 30.6).

export interface Runtime {
  deps: Deps;
  cache: Redis;
  queueRedis: Redis;
  storage: ObjectStorage;
  redisMajor: number;
  close(): Promise<void>;
}

/** Logger with redaction of secrets and tokens (TR-SEC-10). */
export const createLogger = (level: string): Logger =>
  pino({
    level,
    redact: { paths: ['password', 'pin', 'token', 'staffKey', 'code', '*.password', '*.pin', '*.token', '*.staffKey', 'req.headers.cookie', 'req.headers.authorization'], censor: '[redacted]' },
  });

/** Data key for envelope encryption: a Docker secret file on the VPS, an env value, or (optional) AWS KMS. */
async function keys(env: Env): Promise<KeyProvider> {
  if (env.DATA_KEY_FILE) return staticKeyProvider((await readFile(env.DATA_KEY_FILE, 'utf8')).trim());
  if (env.DATA_KEY) return staticKeyProvider(env.DATA_KEY);
  const enc = process.env.DATA_KEY_ENC;
  if (enc) return kmsKeyProvider(env.S3_REGION, enc);
  if (env.LOCAL_DATA_KEY) return staticKeyProvider(env.LOCAL_DATA_KEY);
  throw new Error('Set DATA_KEY_FILE or DATA_KEY (32 bytes, base64)');
}

export async function createRuntime(env: Env, log: Logger = createLogger(env.LOG_LEVEL)): Promise<Runtime> {
  const db = createDb(env.DATABASE_URL, env.DATABASE_REPLICA_URL);
  const cache = new Redis(env.REDIS_CACHE_URL, { maxRetriesPerRequest: 2 });
  const queueRedis = new Redis(env.REDIS_QUEUE_URL, { maxRetriesPerRequest: null });
  const redisMajor = Number(/redis_version:(\d+)/.exec(await queueRedis.info('server'))?.[1] ?? 0);
  let jobs: Jobs;
  if (redisMajor >= 5) jobs = new BullJobs(queueRedis);
  else {
    log.warn({ redisMajor }, 'Redis < 5: jobs kept in memory and NOT processed; run Redis 7 (docker compose up redis)');
    jobs = new MemoryJobs();
  }
  const local = env.APP_ENV === 'local';
  // S3-compatible storage (MinIO on the VPS) whenever an endpoint or credentials are configured; else local files.
  const storage =
    env.S3_ENDPOINT || env.S3_ACCESS_KEY
      ? await createS3Storage({
          region: env.S3_REGION,
          assetsBucket: env.S3_BUCKET_ASSETS,
          exportsBucket: env.S3_BUCKET_EXPORTS,
          endpoint: env.S3_ENDPOINT,
          publicEndpoint: env.S3_PUBLIC_ENDPOINT,
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
          cdnBaseUrl: env.CDN_BASE_URL,
        })
      : new LocalStorage(process.env.LOCAL_STORAGE_DIR ?? '.storage', env.CDN_BASE_URL);
  const deps: Deps = {
    config: {
      domain: env.PLATFORM_DOMAIN,
      appEnv: env.APP_ENV,
      pepper: env.SESSION_PEPPER,
      cdnBaseUrl: env.CDN_BASE_URL,
      vapidPublicKey: env.VAPID_PUBLIC_KEY,
      scheme: env.INSECURE_COOKIES ? 'http' : 'https',
      platformMfa: env.PLATFORM_MFA,
      localPorts: local ? LOCAL_PORTS : undefined,
    },
    db,
    kv: new RedisKV(cache),
    jobs,
    keys: await keys(env),
    log,
    now: () => new Date(),
  };
  return {
    deps,
    cache,
    queueRedis,
    storage,
    redisMajor,
    async close() {
      await db.destroy();
      cache.disconnect();
      queueRedis.disconnect();
    },
  };
}
