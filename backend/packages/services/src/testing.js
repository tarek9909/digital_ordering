import { staticKeyProvider } from '@dop/auth';
import { MemoryJobs } from '@dop/jobs';
import pino from 'pino';
import { MemoryKV } from './kv.js';
export function makeTestDeps(db, start = '2026-10-22T09:00:00.000Z') {
    const clock = {
        now: new Date(start),
        advance(ms) {
            this.now = new Date(this.now.getTime() + ms);
        },
        set(d) {
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
