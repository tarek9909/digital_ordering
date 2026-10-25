// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Results as PilotResults } from './PilotReport';
import { ReachByPhone } from './PlatformReport';
import { TenantsPage } from './Tenants';

// Regressions for the 2026-10-22 completeness repairs AS08 (console pilot pickup p90, alert reach by phone type)
// and AS10 (catalogue-driven tenant plan filter). They assert the repaired behaviour.

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api, authApi: api }));
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Bar: Box, BarChart: Box, CartesianGrid: Box, Legend: Box, ResponsiveContainer: Box, Tooltip: Box, XAxis: Box, YAxis: Box, Line: Box, LineChart: Box };
});

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(cleanup);

const mount = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe('AS08 console report outputs', () => {
  it('pilot report shows pickup p90 next to prep p90', () => {
    const total = { tickets: 4, readyTickets: 4, alertReach: { push: 4, live: 0, closed: 0, none: 0 }, reachPushOrLivePct: 100, acknowledgedPct: 50, prepSecondsP50: 300, prepSecondsP90: 540, pickupSecondsP50: 120, pickupSecondsP90: 780, uncollected: 0, undoPct: 0 };
    mount(<PilotResults items={[{ tenant: { id: 't1', name: 'Cafe', slug: 'cafe' }, report: { from: '2026-10-01', to: '2026-10-14', prepLabel: '', total, days: [] } }]} />);
    const table = screen.getAllByRole('table')[0]!;
    const head = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(head).toContain('90th percentile pickup after ready');
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[head.indexOf('90th percentile pickup after ready')]).not.toBe('—');
    expect(cells[head.indexOf('90th percentile pickup after ready')]).not.toBe(cells[head.indexOf('Median pickup after ready')]);
  });

  it('platform report shows alert reach per phone type', () => {
    mount(<ReachByPhone reach={{ 'android-chrome': { push: 1, closed: 1 }, 'ios-safari': { push: 3, live: 1 } }} />);
    const table = screen.getByRole('table', { name: 'Alert level when marked Ready, by phone operating system and browser' });
    const rows = within(table).getAllByRole('row').slice(1).map((tr) => within(tr).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([
      ['iPhone – Safari', '3', '1', '0', '0', '100%'],
      ['Android – Chrome', '1', '0', '1', '0', '50%'],
    ]);
  });
});
