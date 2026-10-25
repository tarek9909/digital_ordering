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
import { generalValues } from '../components/venue/GeneralForm';
import { formToSettings, settingsToForm } from '../lib/settingsForm';
import type { Me, VenueAdmin } from '../lib/types';
import { AccountPage } from './Account';

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

describe('W05, W06 account', () => {
  it('requests an email change with the password and shows it pending', async () => {
    routes({ '/me': ME });
    api.post.mockResolvedValue({ pendingEmail: 'new@x.test' });
    renderAt(<AccountPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Sign-in email' }));
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Email preferences' }));
    const box = await screen.findByLabelText('Weekly summary email');
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/me/preferences', { weeklySummary: false }));
  });
});

describe('W10, W11 venue forms', () => {
  it('shows pending reset times in the general form', () => {
    const v = { name: 'Main', timeZone: 'Asia/Riyadh', locales: ['ar'], resetTime: '04:00', autoCloseTime: '04:00', pendingResetTime: '05:00', pendingAutoCloseTime: null } as unknown as VenueAdmin;
    expect(generalValues(v)).toMatchObject({ resetTime: '05:00', autoCloseTime: '04:00' });
  });

  it('round-trips the chosen chime through the settings form', () => {
    const base = defaultVenueSettings();
    const form = { ...settingsToForm(base), chime: 'marimba' };
    expect(formToSettings(form, base).alerts.chime).toBe('marimba');
  });
});
