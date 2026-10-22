import { ApiError } from '@dop/client-sdk';
import { useEffect, useRef, useState } from 'react';

// Staff PIN lock length (FR-ACC-06, TR-SEC-06): 5 wrong PINs lock the device for 10 minutes. When the server
// says how long the lock lasts (`data.retryAfterSeconds` or `data.lockedUntil`), that value wins.

export const PIN_LOCK_MS = 10 * 60_000;
const MAX_LOCK_MS = 60 * 60_000;

export function lockMsFromError(err: unknown, nowMs = Date.now()): number {
  const data = err instanceof ApiError && err.problem?.data && typeof err.problem.data === 'object' ? (err.problem.data as Record<string, unknown>) : null;
  if (data) {
    const secs = data.retryAfterSeconds;
    if (typeof secs === 'number' && Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, MAX_LOCK_MS);
    const until = typeof data.lockedUntil === 'string' ? Date.parse(data.lockedUntil) : NaN;
    if (Number.isFinite(until) && until > nowMs) return Math.min(until - nowMs, MAX_LOCK_MS);
  }
  return PIN_LOCK_MS;
}

/**
 * Timed PIN lock for the sign-in pad and the personal PIN pad (FR-ACC-06): keys stay disabled only until the lock
 * ends, with a mm:ss countdown; `onUnlock` runs when it ends (e.g. to clear the error).
 */
export function usePinLock(onUnlock: () => void) {
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const unlock = useRef(onUnlock);
  unlock.current = onUnlock;
  useEffect(() => {
    if (lockedUntil === null) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= lockedUntil) {
        setLockedUntil(null);
        unlock.current();
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [lockedUntil]);
  const left = lockedUntil !== null && now < lockedUntil ? Math.ceil((lockedUntil - now) / 1_000) : 0;
  return {
    locked: left > 0,
    /** Remaining time as m:ss. */
    timeLeft: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
    lockFrom(err: unknown) {
      const n = Date.now();
      setNow(n);
      setLockedUntil(n + lockMsFromError(err, n));
    },
  };
}
