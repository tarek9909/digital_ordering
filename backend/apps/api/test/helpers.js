import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from '@dop/services';
import { makeTestDeps } from '@dop/services/testing';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeRateLimit } from '../src/http/rate-limit.js';
export function makeApi(db) {
    const base = makeTestDeps(db);
    const deps = {
        ...base,
        insecureCookies: true,
        storage: new LocalStorage(mkdtempSync(join(tmpdir(), 'dop-storage-')), 'https://cdn.dop.test'),
        rateLimit: makeRateLimit(),
    };
    // Real time for cookies and sessions; tests that need a clock use deps.clock.
    deps.clock.set(new Date());
    const app = createApp(deps, { trustProxy: false, logRequests: false });
    return { deps, app };
}
/** A cookie-keeping client bound to one host. */
export function client(app, host) {
    const jar = new Map();
    let csrf = '';
    const apply = (r) => {
        r.set('Host', host);
        if (jar.size)
            r.set('Cookie', [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
        if (csrf)
            r.set('X-CSRF-Token', csrf);
        return r.then((res) => {
            for (const c of [].concat(res.headers['set-cookie'] ?? [])) {
                const [kv] = c.split(';');
                const [k, v] = kv.split('=');
                if (v)
                    jar.set(k, v);
                else
                    jar.delete(k);
            }
            return res;
        });
    };
    return {
        get: (p) => apply(request(app).get(p)),
        post: (p, body) => apply(request(app).post(p).send(body ?? {})),
        put: (p, body) => apply(request(app).put(p).send(body ?? {})),
        patch: (p, body) => apply(request(app).patch(p).send(body ?? {})),
        delete: (p, body) => apply(request(app).delete(p).send(body ?? {})),
        setCsrf: (t) => (csrf = t),
        jar,
    };
}
