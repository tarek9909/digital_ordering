import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createReconnector, type Revalidation } from './reconnect';

// CSD06: a handshake the server refused (socket.active = false) is retried with bounded back-off after an HTTP
// revalidation; a signed-out session or repeated UNAUTHENTICATED refusals stop the retries.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(revalidate: () => Promise<Revalidation> = async () => 'ok', maxAuthRefusals = 3) {
  const connect = vi.fn();
  const onGiveUp = vi.fn();
  const rc = createReconnector({ connect, revalidate: vi.fn(revalidate), onGiveUp, baseMs: 1_000, maxMs: 8_000, maxAuthRefusals, random: () => 0.5 });
  return { rc, connect, onGiveUp };
}

it('retries a rate-limited refusal with growing, capped delays and resets after connecting', async () => {
  const { rc, connect } = setup();
  const delays: number[] = [];
  let last = Date.now();
  connect.mockImplementation(() => {
    delays.push(Date.now() - last);
    last = Date.now();
    rc.refused(new Error('RATE_LIMITED'), false);
  });
  rc.refused(new Error('RATE_LIMITED'), false);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(delays.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  connect.mockImplementation(() => rc.connected());
  await vi.advanceTimersByTimeAsync(8_000);
  rc.refused(new Error('RATE_LIMITED'), false);
  connect.mockClear();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(connect).toHaveBeenCalledOnce();
});

it('leaves an active socket to Socket.IO (transport drops reconnect by themselves)', async () => {
  const { rc, connect } = setup();
  rc.refused(new Error('xhr poll error'), true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(connect).not.toHaveBeenCalled();
});

it('stops when HTTP revalidation says the session is gone', async () => {
  const { rc, connect, onGiveUp } = setup(async () => 'signed-out');
  rc.refused(new Error('UNAUTHENTICATED'), false);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(connect).not.toHaveBeenCalled();
  expect(onGiveUp).toHaveBeenCalledWith('signed-out');
  expect(rc.gaveUp).toBe(true);
});

it('retries UNAUTHENTICATED a bounded number of times while HTTP still accepts the session, then gives up', async () => {
  const { rc, connect, onGiveUp } = setup(async () => 'ok', 3);
  connect.mockImplementation(() => rc.refused(new Error('UNAUTHENTICATED'), false));
  rc.refused(new Error('UNAUTHENTICATED'), false);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(onGiveUp).toHaveBeenCalledWith('refused');
});

it('keeps retrying transient refusals while HTTP is unavailable, and kick() retries a waiting socket now', async () => {
  const { rc, connect, onGiveUp } = setup(async () => 'unavailable', 2);
  connect.mockImplementation(() => rc.refused(new Error('UNAUTHENTICATED'), false));
  rc.refused(new Error('UNAUTHENTICATED'), false);
  await vi.advanceTimersByTimeAsync(100_000);
  expect(connect.mock.calls.length).toBeGreaterThan(5);
  expect(onGiveUp).not.toHaveBeenCalled();
  connect.mockReset();
  await vi.advanceTimersByTimeAsync(0);
  rc.kick();
  expect(connect).toHaveBeenCalledOnce();
  rc.stop();
  await vi.advanceTimersByTimeAsync(100_000);
  expect(connect).toHaveBeenCalledOnce();
});
