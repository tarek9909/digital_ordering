import { staticKeyProvider } from '@dop/auth';
import type { DbClients } from '@dop/db';
import { MemoryJobs } from '@dop/jobs';
import pino from 'pino';
import type { Deps } from './deps.js';
import { MemoryKV } from './kv.js';

// Test dependencies: real MySQL (from @dop/db/testing), in-memory KV and queue, controllable clock.

export interface TestDeps extends Deps {
  kv: MemoryKV;
  jobs: MemoryJobs;
  clock: { now: Date; advance(ms: number): void; set(d: Date | string): void };
}

export function makeTestDeps(db: DbClients, start: Date | string = '2026-10-22T09:00:00.000Z'): TestDeps {
  const clock = {
    now: new Date(start),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
    set(d: Date | string) {
      this.now = new Date(d);
    },
  };
  return {
    config: {
      domain: 'dop.test',
      appEnv: 'test',
      pepper: 'test-pepper-0123456789abcdef',
      cdnBaseUrl: 'https://cdn.dop.test',
      vapidPublicKey: '',
      scheme: 'https',
    },
    db,
    kv: new MemoryKV(() => clock.now.getTime()),
    jobs: new MemoryJobs(),
    keys: staticKeyProvider(Buffer.alloc(32, 9).toString('base64')),
    log: pino({ level: 'silent' }),
    now: () => clock.now,
    clock,
  };
}
