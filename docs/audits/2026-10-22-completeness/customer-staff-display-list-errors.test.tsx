import { initI18n } from '@dop/i18n';
import ar from '../../../frontend/packages/i18n/locales/ar/customer.json';
import en from '../../../frontend/packages/i18n/locales/en/customer.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router } from '../../../frontend/apps/web-customer/src/lib/router';
import { VenuePage } from '../../../frontend/apps/web-customer/src/pages/VenuePage';
import { MyTicketsPage } from '../../../frontend/apps/web-customer/src/pages/MyTicketsPage';
const f = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../frontend/apps/web-customer/src/lib/api', () => ({ publicApi: { get: f.get, post: f.post } }));
beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear();
  localStorage.setItem('dop.tickets', JSON.stringify([{ token: 'AAAAAAAAAAAAAAAAAAAAAA', venueCode: 'AUDIT1', addedAt: Date.now() }]));
  await initI18n('customer', { ar, en }, 'en');
});
afterEach(cleanup);
it('reproduces a failed My Tickets fetch being presented as no saved tickets', async () => {
  f.get.mockRejectedValue(new Error('HTTP 500'));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MyTicketsPage /></QueryClientProvider>);
  await waitFor(() => expect(qc.getQueryState(['ticket', 'AAAAAAAAAAAAAAAAAAAAAA'])?.status).toBe('error'));
  expect(screen.getByText(en.tickets.empty)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
});
it('reproduces a failed venue ticket-list fetch being presented as no tickets and ask staff', async () => {
  f.get.mockResolvedValue({ claimsMode: 'off', tenantStatus: 'active', venue: { name: 'Audit Venue', venueCode: 'AUDIT1', logoUrl: null, brandColor: '#1F6FEB', locales: ['en'], showPoweredBy: false, messages: {} } });
  f.post.mockRejectedValue(new Error('HTTP 500'));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  history.replaceState(null, '', '/v/AUDIT1');
  render(<QueryClientProvider client={qc}><Router routes={[{ path: '/v/:venueCode', element: <VenuePage /> }]} /></QueryClientProvider>);
  await waitFor(() => expect(qc.getQueryState(['venue-mine', 'AUDIT1'])?.status).toBe('error'));
  expect(screen.getByText(en.venue.noTickets)).toBeTruthy();
  expect(screen.getByText(en.venue.askStaff)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
