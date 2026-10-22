// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closedAtOf, rememberTicket, storedTickets } from '../lib/storage';
import { MyTicketsPage } from './MyTicketsPage';

// W15: tickets seen closed on /tickets start their 24-hour prune clock; tickets the server dropped are forgotten.
const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ publicApi: { get } }));
const OPEN_T = 'AAAAAAAAAAAAAAAAAAAAAA';
const CLOSED_T = 'BBBBBBBBBBBBBBBBBBBBBB';
const GONE_T = 'CCCCCCCCCCCCCCCCCCCCCC';
const venue = { name: 'V', venueCode: 'V1', logoUrl: null, brandColor: '#1F6FEB', locales: ['en'], timeZone: 'UTC', messages: {}, showPoweredBy: true, chime: 'default', liveLoopSeconds: 60 };

beforeAll(async () => {
  await initI18n('customer', { ar, en }, 'en');
});
beforeEach(() => {
  localStorage.clear();
  get.mockImplementation((path: string) => {
    if (path.includes(GONE_T)) return Promise.reject(new ApiError(404, 'NOT_FOUND', null));
    const token = path.split('/').pop()!;
    return Promise.resolve({ token, displayNumber: '7', status: token === CLOSED_T ? 'collected' : 'preparing', venue });
  });
});
afterEach(cleanup);

it('records closedAt for closed tickets and drops 404 tickets', async () => {
  rememberTicket(OPEN_T, 'V1');
  rememberTicket(CLOSED_T, 'V1');
  rememberTicket(GONE_T, 'V1');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MyTicketsPage />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(closedAtOf(CLOSED_T)).toBeTypeOf('number'));
  await waitFor(() => expect(storedTickets().map((t) => t.token)).toEqual([OPEN_T, CLOSED_T]));
  expect(closedAtOf(OPEN_T)).toBeUndefined();
});
