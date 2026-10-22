import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from '@dop/services';
import { makeTestDeps, type TestDeps } from '@dop/services/testing';
import type { DbClients } from '@dop/db';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { ApiDeps } from '../src/http/router.js';
import { makeRateLimit } from '../src/http/rate-limit.js';

export type TestApiDeps = TestDeps & ApiDeps;

export function makeApi(db: DbClients) {
  const base = makeTestDeps(db);
  const deps: TestApiDeps = {
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
export function client(app: ReturnType<typeof makeApi>['app'], host: string) {
  const jar = new Map<string, string>();
  let csrf = '';
  const apply = (r: request.Test) => {
    r.set('Host', host);
    if (jar.size) r.set('Cookie', [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
    if (csrf) r.set('X-CSRF-Token', csrf);
    return r.then((res) => {
      for (const c of ([] as string[]).concat(res.headers['set-cookie'] ?? [])) {
        const [kv] = c.split(';');
        const [k, v] = kv!.split('=');
        if (v) jar.set(k!, v);
        else jar.delete(k!);
      }
      return res;
    });
  };
  return {
    get: (p: string) => apply(request(app).get(p)),
    post: (p: string, body?: object) => apply(request(app).post(p).send(body ?? {})),
    put: (p: string, body?: object) => apply(request(app).put(p).send(body ?? {})),
    patch: (p: string, body?: object) => apply(request(app).patch(p).send(body ?? {})),
    delete: (p: string, body?: object) => apply(request(app).delete(p).send(body ?? {})),
    setCsrf: (t: string) => (csrf = t),
    jar,
  };
}
