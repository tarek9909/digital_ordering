// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/admin.json';
import en from '@dop/i18n/locales/en/admin.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegalGate } from '../components/LegalGate';
import { useVenueStore, venuesKey } from '../lib/venue';
import type { LegalPending, TodayReport } from '../lib/types';
import { TodayStats } from './Home';
import { RatingsPage } from './Ratings';
import { ReportsPage } from './Reports';

// Regressions for the 2026-10-22 completeness repairs AS04–AS08 in tenant admin. They assert the repaired behaviour;
// docs/audits/2026-10-22-completeness/admin-console-site-characterization.test.tsx keeps the original defect probes.

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api, authApi: api }));
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Bar: Box, BarChart: Box, CartesianGrid: Box, Legend: Box, ResponsiveContainer: Box, Tooltip: Box, XAxis: Box, YAxis: Box };
});

const ME = { user: { id: 'u1', email: 'owner@x.test', name: 'Owner', locale: 'en', emailVerified: true, mfaEnrolled: false }, memberships: [], currentTenantId: 't1', currentRole: 'owner', csrfToken: 'c' };
const V1 = { id: '01930000-0000-7000-8000-000000000001', name: 'Only venue', venue_code: 'CODE12', status: 'active' };
const V2 = { id: '01930000-0000-7000-8000-000000000002', name: 'Second venue', venue_code: 'CODE34', status: 'active' };
const summary = {
  tickets: 12,
  collected: 9,
  cancelled: 3,
  cancelReasons: { customer_left: 2, refunded: 0, out_of_stock: 1, duplicate: 0, mistake: 0, other: 0 },
  uncollected: 0,
  reachPushOrLivePct: 100,
  acknowledgedPct: 100,
  repeatPct: 0,
  undoPct: 0,
  prepSecondsP50: 60,
  pickupSecondsP50: 120,
  totalSecondsP50: 754,
  ratingAvg: null,
  ratingsCount: 0,
};
const trends = { from: '2026-10-01', to: '2026-10-14', prepLabel: '', current: summary, previous: { from: '2026-09-17', to: '2026-09-30', ...summary, cancelled: 1, cancelReasons: { customer_left: 1 } }, series: [] };

const doc = (kind: LegalPending['kind'], id: string): LegalPending => ({ id, kind, version: `${kind}-v1`, locale: 'en', publishedAt: '2026-10-01T00:00:00Z', html: `<p>Text of ${kind}</p>` });
const DOCS = [doc('terms', '01930000-0000-7000-8000-0000000000a1'), doc('privacy', '01930000-0000-7000-8000-0000000000a2'), doc('dpa', '01930000-0000-7000-8000-0000000000a3')];

function mount(ui: React.ReactElement, url = '/', client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

let routes: Record<string, unknown | (() => unknown)>;
beforeAll(async () => {
  await initI18n('admin', { ar, en }, 'en');
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  useVenueStore.setState({ venueId: null });
  routes = { '/me': ME, '/reports/trends': trends };
  api.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/counters')) return { items: [{ id: 'c1', name: 'Food', archived: false }] };
    if (path in routes) {
      const v = routes[path];
      return typeof v === 'function' ? (v as () => unknown)() : v;
    }
    throw new Error(`unexpected GET ${path}`);
  });
});
afterEach(cleanup);

describe('AS06 legal gate fails closed and recovers', () => {
  it('covers the app while loading and after a failure, and retries into the acceptance dialog', async () => {
    let fail = true;
    routes['/legal/pending'] = () => {
      if (fail) throw new ApiError(0, 'NETWORK', null);
      return { items: DOCS };
    };
    mount(
      <>
        <p>Application content</p>
        <LegalGate />
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'Checking for updated terms…' })).toBeTruthy();
    // The gate retries once by itself before it reports the failure.
    const failed = await screen.findByRole('dialog', { name: 'Terms could not be checked' }, { timeout: 4000 });
    expect(screen.queryByRole('dialog', { name: 'Updated terms' })).toBeNull();
    expect(within(failed).getByRole('alert')).toBeTruthy();
    fail = false;
    fireEvent.click(within(failed).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Updated terms' })).toBeTruthy();
  });
});

describe('AS04/AS05 legal gate shows and records the exact versions', () => {
  it('shows terms, privacy and DPA content, requires explicit consent naming all three, and posts their exact ids', async () => {
    routes['/legal/pending'] = { items: DOCS };
    api.post.mockResolvedValue(undefined);
    mount(<LegalGate />);
    const dialog = await screen.findByRole('dialog', { name: 'Updated terms' });
    expect(api.get).toHaveBeenCalledWith('/legal/pending', { locale: 'en' });
    for (const k of ['terms', 'privacy', 'dpa']) expect(within(dialog).getByText(`Text of ${k}`)).toBeTruthy();
    const links = within(dialog).getAllByRole('link', { name: 'Open this version in a new tab' }).map((a) => a.getAttribute('href'));
    expect(links).toEqual(DOCS.map((d) => expect.stringContaining(`/legal/${d.kind}?document=${d.id}`)));
    const accept = within(dialog).getByRole('button', { name: 'I accept' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(within(dialog).getByLabelText('I have read and accept the Terms of service, Privacy policy, Data processing agreement shown above.'));
    expect(accept.disabled).toBe(false);
    fireEvent.click(accept);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/legal/accept', { documentIds: DOCS.map((d) => d.id), locale: 'en' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a stale list is refetched and must be accepted again', async () => {
    let n = 0;
    const newer = { ...DOCS[1]!, id: '01930000-0000-7000-8000-0000000000b2', version: 'privacy-v2', html: '<p>Newer privacy</p>' };
    routes['/legal/pending'] = () => ({ items: n++ === 0 ? DOCS : [DOCS[0], newer, DOCS[2]] });
    api.post.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', null));
    mount(<LegalGate />);
    const dialog = await screen.findByRole('dialog', { name: 'Updated terms' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'I accept' }));
    expect(await screen.findByText('Newer privacy')).toBeTruthy();
    expect(screen.getByText(/updated while you were reading/)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });
});

describe('AS07 reports cold load', () => {
  it('a one-venue tenant gets its counter filter once venues arrive', async () => {
    let resolveVenues!: (v: unknown) => void;
    routes['/venues'] = () => new Promise((r) => (resolveVenues = r));
    const client = mount(<ReportsPage />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/venues'));
    await act(async () => resolveVenues({ items: [V1] }));
    await waitFor(() => expect(client.getQueryState(venuesKey)?.status).toBe('success'));
    expect(await screen.findByLabelText('Counter')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith(`/venues/${V1.id}/counters`);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reports/trends', expect.objectContaining({ venueId: V1.id })));
  });

  it('keeps a deliberate "All venues" choice of a multi-venue tenant', async () => {
    routes['/venues'] = { items: [V1, V2] };
    mount(<ReportsPage />);
    const venue = (await screen.findByLabelText('Venue')) as HTMLSelectElement;
    await waitFor(() => expect(venue.value).toBe(V1.id));
    fireEvent.change(venue, { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(api.get.mock.calls.filter(([p]) => p === '/reports/trends').at(-1)?.[1]).not.toHaveProperty('venueId'));
    expect(venue.value).toBe('all');
  });
});

describe('AS08 report outputs', () => {
  it('daily pilot table renders prep and pickup p90', async () => {
    const pilot = { ...summary, readyTickets: 1, alertReach: { push: 1, live: 0, closed: 0, none: 0 }, prepSecondsP90: 540, pickupSecondsP90: 780 };
    routes['/reports/pilot'] = { from: '2026-10-01', to: '2026-10-14', days: [{ date: '2026-10-01', ...pilot }], total: pilot };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(venuesKey, [V1]);
    mount(<ReportsPage />, '/?tab=daily', client);
    expect(await screen.findByRole('columnheader', { name: '90th percentile preparation' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '90th percentile pickup' })).toBeTruthy();
    expect(screen.getAllByText('9:00').length).toBe(2); // day + total rows
    expect(screen.getAllByText('13:00').length).toBe(2);
  });

  it('trends render total wait, cancellations and the reason breakdown', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(venuesKey, [V1]);
    mount(<ReportsPage />, '/', client);
    expect(await screen.findByText('Median total wait (created to collected)')).toBeTruthy();
    expect(screen.getByText('12:34')).toBeTruthy();
    const reasons = screen.getByRole('table', { name: 'Cancellations by reason' });
    const row = within(reasons).getByText('Customer left').closest('tr')!;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Customer left', '2', '1']);
    expect(within(within(reasons).getByText('Out of stock').closest('tr')!).getAllByRole('cell')[1]!.textContent).toBe('1');
  });

  it('Today lists the longest-waiting tickets', () => {
    const r: TodayReport = {
      businessDate: '2026-10-22',
      tickets: 3,
      byStatus: {},
      open: 2,
      alertReach: { push: 0, live: 0, closed: 0, none: 0 },
      reachPushOrLivePct: null,
      acknowledgedPct: null,
      prepSecondsP50: null,
      pickupSecondsP50: null,
      prepLabel: '',
      longestWaiting: [
        { id: 'a', displayNumber: 'A7', status: 'preparing', createdAt: '2026-10-22T09:00:00Z', waitingSeconds: 900 },
        { id: 'b', displayNumber: 'A9', status: 'ready', createdAt: '2026-10-22T09:05:00Z', waitingSeconds: 600 },
      ],
    };
    mount(<TodayStats r={r} />);
    const table = screen.getByRole('table', { name: 'Longest-waiting orders' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((tr) => within(tr).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['A7', 'Preparing', '15:00'],
      ['A9', 'Ready', '10:00'],
    ]);
  });

  it('Ratings shows the distribution over all ratings', async () => {
    routes['/venues'] = { items: [V1] };
    routes['/ratings'] = { items: [], summary: { count: 10, average: 4.1, distribution: [1, 0, 1, 3, 5] } };
    mount(<RatingsPage />);
    expect(await screen.findByText('Average 4.1 / 5 from 10 ratings')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Rating distribution' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((tr) => within(tr).getAllByRole('cell').slice(1).map((c) => c.textContent))).toEqual([
      ['5', '50%'],
      ['3', '30%'],
      ['1', '10%'],
      ['0', '0%'],
      ['1', '10%'],
    ]);
  });
});
