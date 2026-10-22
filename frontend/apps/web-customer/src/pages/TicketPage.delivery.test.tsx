// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Router } from '../lib/router';
import { resetLanguageChoice } from '../lib/lang';
import { TicketPage } from './TicketPage';

// CSD01 at page level: "Alerts are on" appears only for a capability actually reached; a failed explicit
// activation leaves an honest failure with "Turn on alerts" as the retry.
const f = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), enablePush: vi.fn(), link: vi.fn() }));
vi.mock('../lib/api', () => ({ publicApi: { get: f.get, post: f.post, put: vi.fn() } }));
vi.mock('../lib/socket', () => ({
  connectSocket: () => ({ active: true, connect: vi.fn(), on: vi.fn(), close: vi.fn(), emit: vi.fn() }),
}));
vi.mock('../lib/audio', () => ({
  audioState: () => 'running',
  keepAwake: vi.fn(),
  startAlertLoop: () => ({ stop: vi.fn() }),
  unlockAudio: vi.fn(),
  testChime: vi.fn(),
}));
vi.mock('../lib/push', () => ({ enablePush: f.enablePush, notificationsBlocked: () => false, linkExistingSubscription: f.link }));
const A = 'AAAAAAAAAAAAAAAAAAAAAA';
const ticket = {
  token: A,
  displayNumber: '11',
  status: 'preparing',
  version: 1,
  seq: 1,
  counterName: null,
  waitRemainingMinutes: 5,
  waitOverdue: false,
  acknowledged: false,
  checkCode: null,
  ratingAllowed: false,
  readyRound: 1,
  cancelReason: null,
  tenantStatus: 'active',
  reviewLinkUrl: null,
  venue: { name: 'V', venueCode: 'V1', logoUrl: null, brandColor: '#1F6FEB', locales: ['en'], timeZone: 'UTC', messages: {}, showPoweredBy: true, chime: 'default', liveLoopSeconds: 60 },
};

beforeAll(async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  await initI18n('customer', { ar, en }, 'en');
});
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetLanguageChoice();
  f.get.mockResolvedValue(ticket);
  f.post.mockResolvedValue(undefined);
  f.link.mockResolvedValue('none');
  history.replaceState(null, '', '/' + A + '?src=hs');
});
afterEach(cleanup);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router routes={[{ path: '/:token', element: <TicketPage /> }]} />
    </QueryClientProvider>,
  );
}

it('CSD01: a failed subscription save never shows "Alerts are on" on the ticket page', async () => {
  f.enablePush.mockRejectedValue(new Error('PUT push-subscription returned 500'));
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/Notifications could not be set up/);
  fireEvent.click(screen.getByRole('button', { name: '×' }));
  await screen.findByText(en.alertsLinkFailed);
  expect(screen.queryByText(/Alerts are on/)).toBeNull();
  expect(screen.getByRole('button', { name: /Turn on alerts/ })).toBeTruthy();
});

it('CSD01: activation waits for this ticket follow registration, then reports background push', async () => {
  let followDone: () => void = () => undefined;
  f.post.mockImplementation((p: string) => (p.endsWith('/follow') ? new Promise<void>((r) => (followDone = r)) : Promise.resolve()));
  f.enablePush.mockResolvedValue('granted');
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /Allow notifications/ }));
  await new Promise((r) => setTimeout(r, 20));
  expect(f.enablePush).not.toHaveBeenCalled();
  followDone();
  await screen.findByText(/You're all set/);
  expect(f.enablePush).toHaveBeenCalledWith(A);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await screen.findByText(/Alerts are on/);
  expect(screen.getByText(en.alertsPushOn)).toBeTruthy();
  await waitFor(() => expect(f.post.mock.calls.filter((c) => String(c[0]).endsWith('/follow'))).toHaveLength(1));
});
