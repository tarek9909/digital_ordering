export class RedisKV {
    r;
    constructor(r) {
        this.r = r;
    }
    get(key) {
        return this.r.get(key);
    }
    async take(key) {
        // A script rather than GETDEL so older local Redis builds work too.
        return (await this.r.eval("local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v", 1, key));
    }
    async set(key, value, ttlSec) {
        if (ttlSec)
            await this.r.set(key, value, 'EX', ttlSec);
        else
            await this.r.set(key, value);
    }
    async setNx(key, value, ttlSec) {
        return (await this.r.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
    }
    async del(...keys) {
        if (keys.length)
            await this.r.del(...keys);
    }
    async incr(key, ttlSec) {
        const n = await this.r.incr(key);
        if (n === 1 && ttlSec)
            await this.r.expire(key, ttlSec);
        return n;
    }
    incrBy(key, by) {
        return this.r.incrby(key, by);
    }
    async exists(key) {
        return (await this.r.exists(key)) === 1;
    }
    async ttl(key) {
        const s = await this.r.ttl(key);
        return s >= 0 ? s : null;
    }
    async keys(prefix) {
        const out = [];
        let cursor = '0';
        do {
            const [next, batch] = await this.r.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
            cursor = next;
            out.push(...batch);
        } while (cursor !== '0');
        return out;
    }
    async publish(channel, message) {
        await this.r.publish(channel, message);
    }
}
export class MemoryKV {
    now;
    data = new Map();
    published = [];
    constructor(now = Date.now) {
        this.now = now;
    }
    live(key) {
        const e = this.data.get(key);
        if (!e)
            return null;
        if (e.exp !== null && e.exp <= this.now()) {
            this.data.delete(key);
            return null;
        }
        return e;
    }
    async get(key) {
        return this.live(key)?.v ?? null;
    }
    async take(key) {
        const v = this.live(key)?.v ?? null;
        this.data.delete(key);
        return v;
    }
    async set(key, value, ttlSec) {
        this.data.set(key, { v: value, exp: ttlSec ? this.now() + ttlSec * 1000 : null });
    }
    async setNx(key, value, ttlSec) {
        if (this.live(key))
            return false;
        await this.set(key, value, ttlSec);
        return true;
    }
    async del(...keys) {
        for (const k of keys)
            this.data.delete(k);
    }
    async incr(key, ttlSec) {
        const e = this.live(key);
        const n = (e ? Number(e.v) : 0) + 1;
        this.data.set(key, { v: String(n), exp: e ? e.exp : ttlSec ? this.now() + ttlSec * 1000 : null });
        return n;
    }
    async incrBy(key, by) {
        const e = this.live(key);
        const n = (e ? Number(e.v) : 0) + by;
        this.data.set(key, { v: String(n), exp: e ? e.exp : null });
        return n;
    }
    async exists(key) {
        return this.live(key) !== null;
    }
    async ttl(key) {
        const e = this.live(key);
        return e?.exp ? Math.ceil((e.exp - this.now()) / 1000) : null;
    }
    async keys(prefix) {
        return [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.live(k));
    }
    async publish(channel, message) {
        this.published.push({ channel, message });
    }
}
export const keys = {
    tenantStatus: (tenantId) => `t:${tenantId}:status`,
    tenantFlags: (tenantId) => `t:${tenantId}:flags`,
    trialCount: (tenantId, businessDate) => `t:${tenantId}:tickets:${businessDate}`,
    presence: (ticketId, clientId) => `pres:${ticketId}:${clientId}`,
    wasLive: (ticketId, clientId) => `waslive:${ticketId}:${clientId}`,
    pairing: (code) => `pair:${code}`,
    handoff: (hash) => `handoff:${hash}`,
    mfaToken: (hash) => `mfa:${hash}`,
    manualAlert: (ticketId) => `alertmanual:${ticketId}`,
    todayCache: (tenantId, venueId) => `t:${tenantId}:today:${venueId}`,
    lastActivity: (tenantId) => `t:${tenantId}:activity`,
};
export const EVENTS_CHANNEL = 'events';
