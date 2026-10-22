import type { Redis } from 'ioredis';

// Small key-value surface over Redis (cache, presence, counters, pub/sub). Tenant data keys always
// include the tenant ID (TR-TEN-10). MemoryKV backs unit and integration tests.

export interface KV {
  get(key: string): Promise<string | null>;
  /** Atomic get-and-delete: of concurrent callers only one receives the value (single-use tokens, L-2). */
  take(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  /** SET NX with TTL; true when the key was created. */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  /** INCR; sets the TTL when the key is new. */
  incr(key: string, ttlSec?: number): Promise<number>;
  /** INCRBY on an existing counter (keeps its TTL). */
  incrBy(key: string, by: number): Promise<number>;
  exists(key: string): Promise<boolean>;
  /** Seconds until the key expires; null when it is missing or has no expiry. */
  ttl(key: string): Promise<number | null>;
  keys(prefix: string): Promise<string[]>;
  publish(channel: string, message: string): Promise<void>;
}

export class RedisKV implements KV {
  constructor(private readonly r: Redis) {}
  get(key: string) {
    return this.r.get(key);
  }
  async take(key: string) {
    // A script rather than GETDEL so older local Redis builds work too.
    return (await this.r.eval("local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v", 1, key)) as string | null;
  }
  async set(key: string, value: string, ttlSec?: number) {
    if (ttlSec) await this.r.set(key, value, 'EX', ttlSec);
    else await this.r.set(key, value);
  }
  async setNx(key: string, value: string, ttlSec: number) {
    return (await this.r.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
  }
  async del(...keys: string[]) {
    if (keys.length) await this.r.del(...keys);
  }
  async incr(key: string, ttlSec?: number) {
    const n = await this.r.incr(key);
    if (n === 1 && ttlSec) await this.r.expire(key, ttlSec);
    return n;
  }
  incrBy(key: string, by: number) {
    return this.r.incrby(key, by);
  }
  async exists(key: string) {
    return (await this.r.exists(key)) === 1;
  }
  async ttl(key: string) {
    const s = await this.r.ttl(key);
    return s >= 0 ? s : null;
  }
  async keys(prefix: string) {
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.r.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      out.push(...batch);
    } while (cursor !== '0');
    return out;
  }
  async publish(channel: string, message: string) {
    await this.r.publish(channel, message);
  }
}

export class MemoryKV implements KV {
  private readonly data = new Map<string, { v: string; exp: number | null }>();
  readonly published: Array<{ channel: string; message: string }> = [];
  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string) {
    const e = this.data.get(key);
    if (!e) return null;
    if (e.exp !== null && e.exp <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.v ?? null;
  }
  async take(key: string) {
    const v = this.live(key)?.v ?? null;
    this.data.delete(key);
    return v;
  }
  async set(key: string, value: string, ttlSec?: number) {
    this.data.set(key, { v: value, exp: ttlSec ? this.now() + ttlSec * 1000 : null });
  }
  async setNx(key: string, value: string, ttlSec: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }
  async del(...keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
  async incr(key: string, ttlSec?: number) {
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + 1;
    this.data.set(key, { v: String(n), exp: e ? e.exp : ttlSec ? this.now() + ttlSec * 1000 : null });
    return n;
  }
  async incrBy(key: string, by: number) {
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + by;
    this.data.set(key, { v: String(n), exp: e ? e.exp : null });
    return n;
  }
  async exists(key: string) {
    return this.live(key) !== null;
  }
  async ttl(key: string) {
    const e = this.live(key);
    return e?.exp ? Math.ceil((e.exp - this.now()) / 1000) : null;
  }
  async keys(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.live(k));
  }
  async publish(channel: string, message: string) {
    this.published.push({ channel, message });
  }
}

export const keys = {
  tenantStatus: (tenantId: string) => `t:${tenantId}:status`,
  tenantFlags: (tenantId: string) => `t:${tenantId}:flags`,
  trialCount: (tenantId: string, businessDate: string) => `t:${tenantId}:tickets:${businessDate}`,
  presence: (ticketId: string, clientId: string) => `pres:${ticketId}:${clientId}`,
  wasLive: (ticketId: string, clientId: string) => `waslive:${ticketId}:${clientId}`,
  pairing: (code: string) => `pair:${code}`,
  handoff: (hash: string) => `handoff:${hash}`,
  mfaToken: (hash: string) => `mfa:${hash}`,
  manualAlert: (ticketId: string) => `alertmanual:${ticketId}`,
  todayCache: (tenantId: string, venueId: string) => `t:${tenantId}:today:${venueId}`,
  lastActivity: (tenantId: string) => `t:${tenantId}:activity`,
} as const;

export const EVENTS_CHANNEL = 'events';
