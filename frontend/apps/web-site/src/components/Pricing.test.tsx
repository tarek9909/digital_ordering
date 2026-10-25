// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/site.json';
import en from '@dop/i18n/locales/en/site.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { pickPrice, Pricing } from './Pricing';

// W02 / FR-BIL-02: prices come from the public plan catalogue.
const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ publicApi: { get } }));

const limits = { maxVenues: 1, maxCountersPerVenue: 0, maxLanguages: 2, maxDisplaysPerVenue: 2, maxStaffDevicesPerVenue: 5, maxApiKeysPerVenue: 0, trialTicketsPerDay: 50 };
const catalogue = {
  trialDays: 21,
  items: [
    {
      code: 'standard',
      name: 'Standard',
      limits,
      features: ['ratings', 'some_future_flag'],
      prices: [
        { period: 'year', currency: 'SAR', amountMinor: 99000 },
        { period: 'month', currency: 'USD', amountMinor: 2700 },
        { period: 'month', currency: 'SAR', amountMinor: 9900 },
      ],
    },
    {
      code: 'pro',
      name: 'Pro',
      limits: { ...limits, maxCountersPerVenue: 4, maxApiKeysPerVenue: 3 },
      features: ['counters', 'api_access', 'webhooks'],
      prices: [{ period: 'month', currency: 'USD', amountMinor: 4900 }],
    },
  ],
};

beforeAll(async () => {
  await initI18n('site', { ar, en }, 'en');
});
beforeEach(() => get.mockReset());
afterEach(cleanup);

const renderPricing = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    </QueryClientProvider>,
  );

it('pickPrice prefers a monthly USD price, then the first monthly price', () => {
  expect(pickPrice(catalogue.items[0]!.prices as never)).toEqual({ period: 'month', currency: 'USD', amountMinor: 2700 });
  expect(pickPrice([{ period: 'month', currency: 'SAR', amountMinor: 9900 }])?.currency).toBe('SAR');
  expect(pickPrice([{ period: 'year', currency: 'USD', amountMinor: 1 }])?.period).toBe('year');
  expect(pickPrice([])).toBeNull();
});

it('renders the single plan card with price, limits, translated features and the trial length', async () => {
  get.mockResolvedValue(catalogue);
  renderPricing();
  const std = (await screen.findByRole('heading', { name: 'Standard' })).parentElement!;
  expect(get).toHaveBeenCalledWith('/plans');
  // Lebanon: the US-dollar price is shown when the plan has one.
  expect(within(std).getByText(/\$27/)).toBeTruthy();
  expect(within(std).getByText('per venue / month')).toBeTruthy();
  expect(within(std).getByText('Venues: up to 1')).toBeTruthy();
  expect(within(std).queryByText(/Pickup counters/)).toBeNull();
  expect(within(std).getByText('Customer ratings')).toBeTruthy();
  expect(within(std).queryByText(/some_future_flag/)).toBeNull();
  expect(within(std).getByText('21-day free trial. We set up your account; then pay monthly or yearly.')).toBeTruthy();
  // No checkout or self-signup: the card leads to the contact page (venues are set up by the platform team).
  expect(within(std).getByRole('link', { name: 'Get started' }).getAttribute('href')).toBe('/contact');

  // One plan only: further catalogue entries are not shown.
  expect(screen.queryByRole('heading', { name: 'Pro' })).toBeNull();
  expect(screen.queryByText(/coming soon/i)).toBeNull();
});

it('shows an error with a retry', async () => {
  let calls = 0;
  get.mockImplementation(async (path: string) => {
    if (path === '/site') return { contact: { email: null, whatsapp: null, whatsappUrl: null } };
    if (calls++ === 0) throw new ApiError(503, 'SERVICE_UNAVAILABLE', null);
    return catalogue;
  });
  renderPricing();
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'Standard' });
});
