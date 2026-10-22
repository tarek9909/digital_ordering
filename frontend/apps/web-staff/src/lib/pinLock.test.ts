import { ApiError } from '@dop/client-sdk';
import { expect, it } from 'vitest';
import { PIN_LOCK_MS, lockMsFromError } from './pinLock';

// W17 / FR-ACC-06: the lock lasts 10 minutes unless the server says otherwise.
const locked = (data?: unknown) => new ApiError(423, 'PIN_LOCKED', { type: 'about:blank', title: 'x', status: 423, code: 'PIN_LOCKED', data });

it('defaults to the documented 10 minutes', () => {
  expect(PIN_LOCK_MS).toBe(600_000);
  expect(lockMsFromError(locked())).toBe(600_000);
  expect(lockMsFromError(new Error('x'))).toBe(600_000);
});
it('uses retryAfterSeconds or lockedUntil from the problem data when present', () => {
  expect(lockMsFromError(locked({ retryAfterSeconds: 90 }))).toBe(90_000);
  const now = Date.parse('2026-10-22T12:00:00Z');
  expect(lockMsFromError(locked({ lockedUntil: '2026-10-22T12:04:00Z' }), now)).toBe(240_000);
  expect(lockMsFromError(locked({ lockedUntil: '2026-10-22T11:00:00Z' }), now)).toBe(600_000);
});
