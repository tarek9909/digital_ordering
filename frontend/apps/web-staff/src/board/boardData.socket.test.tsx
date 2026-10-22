// @vitest-environment jsdom
import * as React from 'react';
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStaff } from '../lib/store';
import { useBoardSocket } from './boardData';

// CSD06: a staff board whose handshake the server refused (Socket.IO leaves `active = false`) revalidates over HTTP
// and retries with back-off; a signed-out session or repeated refusals stop the retries with a visible state.
type Fake = { handlers: any; active: boolean; connected: boolean; events: Record<string, (p: unknown) => void>; on: any; emit: any; disconnect: any; connect: any };
const f = vi.hoisted(() => ({ get: vi.fn(), sockets: [] as Fake[] }));
vi.mock('@dop/client-sdk', async (orig) => ({
  ...(await orig<object>()),
  connectSocket: (_auth: unknown, handlers: unknown) => {
    const s: Fake = { handlers, active: false, connected: false, events: {}, on: (e: string, fn: (p: unknown) => void) => void (s.events[e] = fn), emit: vi.fn(), disconnect: vi.fn(), connect: vi.fn() };
    f.sockets.push(s);
    return s;
  },
}));
vi.mock('../lib/api', async () => {
  const { ApiError: E } = await import('@dop/client-sdk');
  return { api: { get: f.get }, isApiError: (e: unknown, code?: string) => e instanceof E && (code === undefined || e.code === code), venueId: null, vq: (s: string) => s };
});

const board = { open: [], recent: [], csrfToken: 'c', serverTime: '2026-10-22T12:00:00Z', pendingClaims: [], venue: { timeZone: 'UTC', settings: {} }, collectedToday: 0, businessDate: '2026-10-22' };
function setup() {
  const qc = new QueryClient();
  function Hook() {
    useBoardSocket(true);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Hook />
    </QueryClientProvider>,
  );
  return f.sockets[0]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  f.sockets.length = 0;
  useStaff.setState({ socketUp: true, needsReload: false, signedOut: false, liveRefused: false });
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('CSD06: a transient refusal is revalidated over HTTP and the inactive socket is reconnected', async () => {
  f.get.mockResolvedValue(board);
  const s = setup();
  await act(async () => {
    s.handlers.onError(new Error('RATE_LIMITED'));
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(f.get).toHaveBeenCalled();
  expect(s.connect).toHaveBeenCalled();
  // The server accepts the next handshake: live again, retries stop.
  await act(async () => {
    s.handlers.onConnect();
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(useStaff.getState()).toMatchObject({ socketUp: true, needsReload: false, liveRefused: false });
  const n = s.connect.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(s.connect.mock.calls.length).toBe(n);
});

it('CSD06: a dependency failure reported as UNAUTHENTICATED is retried while HTTP still accepts the session', async () => {
  f.get.mockResolvedValue(board);
  const s = setup();
  await act(async () => {
    s.handlers.onError(new Error('UNAUTHENTICATED'));
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(s.connect).toHaveBeenCalledOnce();
  expect(useStaff.getState().signedOut).toBe(false);
});

it('CSD06: HTTP 401 on revalidation is terminal: signed out, no socket retries', async () => {
  f.get.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', null));
  const s = setup();
  await act(async () => {
    s.handlers.onError(new Error('UNAUTHENTICATED'));
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(useStaff.getState().signedOut).toBe(true);
  expect(s.connect).not.toHaveBeenCalled();
});

it('CSD06: repeated UNAUTHENTICATED refusals with a valid HTTP session stop with a needs-attention state', async () => {
  f.get.mockResolvedValue(board);
  const s = setup();
  s.connect.mockImplementation(() => s.handlers.onError(new Error('UNAUTHENTICATED')));
  await act(async () => {
    s.handlers.onError(new Error('UNAUTHENTICATED'));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
  });
  expect(useStaff.getState()).toMatchObject({ liveRefused: true, socketUp: false, signedOut: false });
  const n = s.connect.mock.calls.length;
  expect(n).toBeLessThan(6);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30 * 60_000);
  });
  expect(s.connect.mock.calls.length).toBe(n);
});
