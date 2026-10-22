// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { Cohorts, Delivery } from './PlatformReport';

// W09 / FR-RPT-07: sign-up cohorts and delivery health tables.

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
afterEach(cleanup);

it('renders one cohort row per sign-up month, with a caption and — for no conversion base', () => {
  render(
    <Cohorts
      cohorts={[
        { month: '2026-09', signups: 10, converted: 3, complimentary: 2, conversionPct: 37.5 },
        { month: '2026-10', signups: 1, converted: 0, complimentary: 1, conversionPct: null },
      ]}
    />,
  );
  const table = screen.getByRole('table', { name: 'Sign-ups per month and how many converted to a paid plan' });
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(3);
  expect(within(rows[1]!).getByText('2026-09')).toBeTruthy();
  expect(within(rows[1]!).getByText('37.5%')).toBeTruthy();
  expect(within(rows[2]!).getByText('—')).toBeTruthy();
});

it('says so when there are no cohorts', () => {
  render(<Cohorts cohorts={[]} />);
  expect(screen.getByText('No sign-ups in this range.')).toBeTruthy();
});

it('renders delivery health with row headers', () => {
  render(<Delivery health={{ pushSent: 980, pushFailures: 20, pushFailurePct: 2, webhookFailures: 4 }} />);
  const table = screen.getByRole('table', { name: 'Push notification and webhook delivery over the range' });
  expect(within(table).getByRole('rowheader', { name: 'Push notifications sent' })).toBeTruthy();
  expect(within(table).getByText('980')).toBeTruthy();
  expect(within(table).getByText('2%')).toBeTruthy();
  expect(within(table).getByRole('rowheader', { name: 'Webhook failures' }).nextElementSibling?.textContent).toBe('4');
});
