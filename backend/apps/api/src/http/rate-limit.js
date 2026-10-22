import { AppError } from '@dop/contracts';
import { RateLimiterMemory } from 'rate-limiter-flexible';
// Rate limits (TR-SEC-07, TR-API-06): 429 RATE_LIMITED with Retry-After. Redis store in deployed environments
// so limits are shared across instances; memory store in tests.
export function makeRateLimit(factory = (n, p, d) => new RateLimiterMemory({ keyPrefix: n, points: p, duration: d })) {
    const limiters = new Map();
    return async (name, key, points, durationSec) => {
        const id = `${name}:${points}:${durationSec}`;
        let l = limiters.get(id);
        if (!l)
            limiters.set(id, (l = factory(name, points, durationSec)));
        try {
            await l.consume(key);
        }
        catch (e) {
            if (e instanceof Error)
                throw e;
            const res = e;
            throw new AppError('RATE_LIMITED', undefined, { data: { retryAfterSec: Math.ceil(res.msBeforeNext / 1000) } });
        }
    };
}
