// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router } from '../lib/router';
import { storedTickets } from '../lib/storage';
import { MyTicketsPage } from './MyTicketsPage';
import { VenuePage } from './VenuePage';

// CSD08: loading, empty, partial failure and unavailable are distinct; failures never read as "no orders".
const f = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', () => ({ publicApi: { get: f.get, post: f.post } }));
const A = 'AAAAAAAAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBBBBBBBB';
const venue = { name: 'Audit Venue', venueCode: 'AUDIT1', logoUrl: null, brandColor: '#1F6FEB', locales: ['en'], timeZone: 'UTC', showPoweredBy: false, messages: {}, chime: 'default', liveLoopSeconds: 60 };
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem(
    'dop.tickets',
    JSON.stringify([
      { token: A, venueCode: 'AUDIT1', addedAt: Date.now() },
      { token: B, venueCode: 'AUDIT1', addedAt: Date.now() },
    ]),
  );
  await initI18n('customer', { ar, en }, 'en');
});
afterEach(cleanup);

function myTickets() {
  return render(
    <QueryClientProvider client={qc()}>
      <MyTicketsPage />
    </QueryClientProvider>,
  );
}

it('CSD08: every saved-ticket fetch failing shows an error with retry, not the empty message, and keeps the entries', async () => {
  f.get.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', null));
  myTickets();
  await screen.findByText(en.tickets.loadFailed);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText(en.tickets.empty)).toBeNull();
  expect(storedTickets().map((t) => t.token).sort()).toEqual([A, B]);
  f.get.mockImplementation((p: string) => Promise.resolve({ token: p.split('/').pop(), displayNumber: '7', status: 'preparing', venue }));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getAllByText('7')).toHaveLength(2));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('CSD08: a partial failure keeps the loaded tickets and flags the rest', async () => {
  f.get.mockImplementation((p: string) =>
    p.includes(B) ? Promise.reject(new Error('network')) : Promise.resolve({ token: A, displayNumber: '11', status: 'preparing', venue }),
  );
  myTickets();
  await screen.findByText('11');
  await screen.findByText(en.tickets.partialFailed);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(screen.queryByText(en.tickets.empty)).toBeNull();
});

it('CSD08: the empty message appears only when nothing is saved', () => {
  localStorage.clear();
  myTickets();
  expect(screen.getByText(en.tickets.empty)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

function venuePage() {
  history.replaceState(null, '', '/v/AUDIT1');
  return render(
    <QueryClientProvider client={qc()}>
      <Router routes={[{ path: '/v/:venueCode', element: <VenuePage /> }]} />
    </QueryClientProvider>,
  );
}

it('CSD08: a failed venue ticket list shows an error with retry instead of "no tickets, ask staff"', async () => {
  f.get.mockResolvedValue({ claimsMode: 'off', tenantStatus: 'active', venue });
  f.post.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', null));
  venuePage();
  await screen.findByText(en.venue.ticketsFailed);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText(en.venue.noTickets)).toBeNull();
  expect(screen.queryByText(en.venue.askStaff)).toBeNull();
  f.post.mockResolvedValueOnce({ tickets: [{ token: A, displayNumber: '42', status: 'ready' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('42');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('CSD08: a genuine empty venue list still says so', async () => {
  f.get.mockResolvedValue({ claimsMode: 'off', tenantStatus: 'active', venue });
  f.post.mockResolvedValue({ tickets: [] });
  venuePage();
  await screen.findByText(en.venue.noTickets);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('CSD08: venue metadata 404 is not-found, but a 503 is a retryable error', async () => {
  f.get.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', null));
  venuePage();
  await screen.findByText(en.notFoundBody);
  cleanup();
  f.get.mockRejectedValueOnce(new ApiError(503, 'INTERNAL_ERROR', null)).mockResolvedValueOnce({ claimsMode: 'off', tenantStatus: 'active', venue });
  f.post.mockResolvedValue({ tickets: [] });
  venuePage();
  await screen.findByText(en.venue.loadFailed);
  expect(screen.queryByText(en.notFoundBody)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(en.venue.noTickets);
});
