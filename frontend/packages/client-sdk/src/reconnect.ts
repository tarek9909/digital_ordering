// Recovery for a refused socket handshake (CSD06, TR-RT-03/05). When the server's handshake middleware refuses
// a connection (rate limit, a dependency failure, or missing/expired credentials), Socket.IO sets
// `socket.active = false` and never retries by itself. Transport drops leave `active = true` and Socket.IO's own
// back-off handles them; this supervisor only acts on the inactive case.
//
// - RATE_LIMITED and other transient refusals: revalidate over HTTP, then retry with bounded, jittered back-off.
// - UNAUTHENTICATED: revalidate over HTTP first. If HTTP says the session is gone it is terminal (no retry). The
//   realtime server also reports an internal dependency failure as UNAUTHENTICATED, so while HTTP still accepts
//   the session a few retries are made; after `maxAuthRefusals` consecutive refusals it stops and reports
//   `refused` so the app can show a needs-attention state instead of retrying forever.

export type Revalidation = 'ok' | 'signed-out' | 'unavailable';
export type ReconnectGiveUp = 'signed-out' | 'refused';

export interface ReconnectOptions {
  /** Re-opens the socket (normally `() => socket.connect()`). */
  connect: () => void;
  /** Re-checks the session and refreshes data over HTTP. */
  revalidate: () => Promise<Revalidation>;
  /** Called once when retrying stops for good. */
  onGiveUp?: (why: ReconnectGiveUp) => void;
  baseMs?: number;
  maxMs?: number;
  maxAuthRefusals?: number;
  /** Jitter source in [0, 1); injectable for tests. */
  random?: () => number;
}

export interface Reconnector {
  /** Call from the socket's connect handler. */
  connected(): void;
  /** Call from the socket's connect_error handler with the error and `socket.active`. */
  refused(e: unknown, active: boolean): void;
  /** Retry a refused socket now (e.g. the browser came back online); no-op unless a retry is waiting. */
  kick(): void;
  stop(): void;
  readonly attempts: number;
  readonly gaveUp: boolean;
}

export const handshakeCode = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : '');

export function createReconnector(o: ReconnectOptions): Reconnector {
  const base = o.baseMs ?? 2_000;
  const max = o.maxMs ?? 60_000;
  const maxAuth = o.maxAuthRefusals ?? 5;
  const random = o.random ?? Math.random;
  let attempts = 0;
  let authRefusals = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let gaveUp = false;
  let up = false;
  let checking = false;
  /** A retry of a refused (inactive) socket is scheduled. */
  let pending = false;

  const giveUp = (why: ReconnectGiveUp) => {
    if (gaveUp) return;
    gaveUp = true;
    clearTimeout(timer);
    o.onGiveUp?.(why);
  };
  const schedule = () => {
    clearTimeout(timer);
    // 2 s, 4 s, 8 s … capped at `max`, with ±25% jitter so many boards do not reconnect in step.
    const delay = Math.min(max, base * 2 ** Math.min(attempts, 16)) * (0.75 + random() * 0.5);
    attempts += 1;
    pending = true;
    timer = setTimeout(() => {
      pending = false;
      if (!stopped && !gaveUp && !up) o.connect();
    }, delay);
  };

  return {
    connected() {
      up = true;
      pending = false;
      attempts = 0;
      authRefusals = 0;
      clearTimeout(timer);
    },
    refused(e, active) {
      up = false;
      if (stopped || gaveUp || active || checking) return;
      const code = handshakeCode(e);
      checking = true;
      void o
        .revalidate()
        .catch((): Revalidation => 'unavailable')
        .then((r) => {
          checking = false;
          if (stopped || gaveUp) return;
          if (r === 'signed-out') return giveUp('signed-out');
          if (code === 'UNAUTHENTICATED' && r === 'ok') {
            authRefusals += 1;
            if (authRefusals >= maxAuth) return giveUp('refused');
          }
          schedule();
        });
    },
    kick() {
      if (stopped || gaveUp || up || !pending) return;
      clearTimeout(timer);
      pending = false;
      o.connect();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    get attempts() {
      return attempts;
    },
    get gaveUp() {
      return gaveUp;
    },
  };
}
