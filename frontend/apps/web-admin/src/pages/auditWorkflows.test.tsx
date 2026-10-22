// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { defaultVenueSettings } from '@dop/contracts';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/admin.json';
import en from '@dop/i18n/locales/en/admin.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressBody, generalValues } from '../components/venue/GeneralForm';
import { formToSettings, settingsToForm } from '../lib/settingsForm';
import type { Billing, Me, VenueAdmin } from '../lib/types';
import { AccountPage } from './Account';
import { BillingPage } from './Billing';
import { IntegrationsPage } from './Integrations';

// Admin workflows repaired after the 2026-10-22 audit: plans and offline billing (W02), POS lifecycle (W01), email change (W05),
// weekly-summary opt-out (W06), venue address (W10) and chime choice (W11).

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api, authApi: api }));
const assign = vi.fn();

const ME: Me = {
  user: { id: 'u1', email: 'owner@x.test', name: 'Owner', locale: 'en', emailVerified: true, mfaEnrolled: false, pendingEmail: null },
  preferences: { weeklySummary: true },
  memberships: [{ tenantId: 't1', slug: 'cafe', name: 'Cafe', status: 'active', role: 'owner' }],
  currentTenantId: 't1',
  currentRole: 'owner',
  csrfToken: 'c',
} as Me;

function routes(map: Record<string, unknown>) {
  api.get.mockImplementation(async (path: string) => {
    if (path in map) return map[path];
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderAt(ui: React.ReactElement, url = '/') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await initI18n('admin', { ar, en }, 'en');
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', { value: { ...window.location, assign, pathname: '/admin/' }, writable: true });
});
afterEach(cleanup);

const plan = (code: string, name: string, amountMinor: number, maxVenues = 1) => ({
  code,
  name,
  limits: { maxVenues, maxCountersPerVenue: 10, maxLanguages: 10, maxApiKeysPerVenue: 5 },
  features: [],
  prices: [{ period: 'month' as const, currency: 'SAR', amountMinor }],
});

describe('W02 plans and offline billing', () => {
  const billing = (over: Partial<Billing>): Billing => ({
    status: 'trial',
    plan: { code: 'trial', name: 'Trial' },
    complimentary: false,
    trialEndsAt: null,
    paidUntil: null,
    graceEndsAt: null,
    payments: [],
    prices: [],
    plans: [plan('standard', 'Standard', 9900), plan('pro', 'Pro', 17900), plan('multisite', 'Multi-site', 15900, 100)],
    ...over,
  });

  it('lists every catalogue plan and offers no online checkout', async () => {
    routes({ '/billing': billing({}), '/me': ME });
    renderAt(<BillingPage />);
    expect(await screen.findByText('Multi-site')).toBeTruthy();
    expect(screen.getByText('Standard')).toBeTruthy();
    expect(screen.getByText(/Contact us to choose a plan/)).toBeTruthy();
    expect(screen.getByText('No payments recorded yet.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the paid-until date and the recorded payments', async () => {
    const payment = { id: 'p1', amountMinor: 9000, currency: 'USD', months: 3, method: 'bank_transfer' as const, reference: 'TR-77', note: null, coversFrom: '2026-10-01T00:00:00.000Z', coversUntil: '2027-01-01T00:00:00.000Z', recordedAt: '2026-10-01T09:00:00.000Z' };
    routes({ '/billing': billing({ status: 'active', plan: { code: 'pro', name: 'Pro' }, paidUntil: '2027-01-01T00:00:00.000Z', payments: [payment] }), '/me': ME });
    renderAt(<BillingPage />);
    expect(await screen.findByText(/^Paid until/)).toBeTruthy();
    expect(screen.getByText('Bank transfer')).toBeTruthy();
    expect(screen.getByText('TR-77')).toBeTruthy();
    expect(screen.getByText(/\(3 months\)/)).toBeTruthy();
  });
});

describe('W01 POS lifecycle', () => {
  const base = { '/me': ME, '/venues': { items: [{ id: 'v1', name: 'Main', venue_code: 'ABC123', status: 'active' }] }, '/venues/v1/api-keys': { items: [] }, '/webhooks': { items: [] } };

  it('connects through the provider and disconnects', async () => {
    routes({ ...base, '/pos/connections': { items: [{ id: 'p1', venueId: 'v1', provider: 'foodics', locationId: 'L1', status: 'connected', lastSyncAt: null }] }, '/pos/providers': { items: ['foodics'] } });
    api.post.mockResolvedValue({ url: 'https://pos.example/authorize?state=s' });
    api.delete.mockResolvedValue(undefined);
    renderAt(<IntegrationsPage />, '/integrations?pos=connected');
    expect(await screen.findByText(/The point of sale is connected/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Foodics' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues/v1/pos/foodics/connect'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pos.example/authorize?state=s'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialogButtons = await screen.findAllByRole('button', { name: 'Disconnect' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]!);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/pos/connections/p1'));
  });

  it('says when no POS can be connected instead of showing a dead button', async () => {
    routes({ ...base, '/pos/connections': { items: [] }, '/pos/providers': { items: [] } });
    renderAt(<IntegrationsPage />);
    expect(await screen.findByText(/No point-of-sale connection is available/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
  });
});

describe('W05, W06 account', () => {
  it('requests an email change with the password and shows it pending', async () => {
    routes({ '/me': ME });
    api.post.mockResolvedValue({ pendingEmail: 'new@x.test' });
    renderAt(<AccountPage />);
    fireEvent.input(await screen.findByLabelText('New email'), { target: { value: 'new@x.test' } });
    const passwords = screen.getAllByLabelText('Current password');
    fireEvent.input(passwords[0]!, { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/email', { newEmail: 'new@x.test', password: 'secret-pass' }));
    expect((await screen.findAllByText(/We sent a confirmation link to new@x.test/)).length).toBeGreaterThan(0);
  });

  it('turns the weekly summary off', async () => {
    routes({ '/me': ME });
    api.put.mockResolvedValue(undefined);
    renderAt(<AccountPage />);
    const box = await screen.findByLabelText('Weekly summary email');
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/me/preferences', { weeklySummary: false }));
  });
});

describe('W10, W11 venue forms', () => {
  it('keeps the venue address and pending zone in the form, and sends only filled lines', () => {
    const v = { name: 'Main', timeZone: 'Asia/Riyadh', pendingTimeZone: 'UTC', locales: ['ar'], resetTime: '04:00', autoCloseTime: '04:00', pendingResetTime: null, pendingAutoCloseTime: null, address: { line1: 'King Fahd Rd 1', city: 'Riyadh' } } as unknown as VenueAdmin;
    const f = generalValues(v);
    expect(f.timeZone).toBe('UTC');
    expect(f.address).toMatchObject({ line1: 'King Fahd Rd 1', city: 'Riyadh', line2: '' });
    expect(addressBody(f.address)).toEqual({ line1: 'King Fahd Rd 1', city: 'Riyadh' });
    expect(addressBody({ line1: ' ', line2: '', city: '', region: '', postcode: '', country: '' })).toBeNull();
  });

  it('round-trips the chosen chime through the settings form', () => {
    const base = defaultVenueSettings();
    const form = { ...settingsToForm(base), chime: 'marimba' };
    expect(formToSettings(form, base).alerts.chime).toBe('marimba');
  });
});
