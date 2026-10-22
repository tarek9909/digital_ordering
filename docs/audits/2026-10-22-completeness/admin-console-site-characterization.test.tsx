// Characterization tests: these assert current defects. PASS means reproduction, not acceptance.
import * as React from 'react';
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import adminAr from '../../../frontend/packages/i18n/locales/ar/admin.json';
import adminEn from '../../../frontend/packages/i18n/locales/en/admin.json';
import siteAr from '../../../frontend/packages/i18n/locales/ar/site.json';
import siteEn from '../../../frontend/packages/i18n/locales/en/site.json';
import consoleAr from '../../../frontend/packages/i18n/locales/ar/console.json';
import consoleEn from '../../../frontend/packages/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Banners } from '../../../frontend/apps/web-admin/src/components/Banners';
import { LegalGate } from '../../../frontend/apps/web-admin/src/components/LegalGate';
import { ReportsPage } from '../../../frontend/apps/web-admin/src/pages/Reports';
import { useVenueStore, venuesKey } from '../../../frontend/apps/web-admin/src/lib/venue';
import { SignUpPage } from '../../../frontend/apps/web-site/src/pages/SignUpPage';
import { CredentialsForm } from '../../../frontend/apps/web-site/src/components/SignInForms';
import { TenantsPage } from '../../../frontend/apps/web-console/src/pages/Tenants';
import { AccountPage, TotpEnrolment } from '../../../frontend/apps/web-admin/src/pages/Account';
import { TwoFactorRequiredPage } from '../../../frontend/apps/web-admin/src/pages/TwoFactorRequired';
import { totpRemoveBody } from '../../../backend/packages/contracts/src/api';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../../../frontend/apps/web-admin/src/lib/api', async (orig) => ({ ...(await orig<typeof import('../../../frontend/apps/web-admin/src/lib/api')>()), api, authApi: api }));
vi.mock('../../../frontend/apps/web-site/src/lib/api', async (orig) => ({ ...(await orig<typeof import('../../../frontend/apps/web-site/src/lib/api')>()), publicApi: api, authApi: api }));
vi.mock('../../../frontend/apps/web-console/src/lib/api', async (orig) => ({ ...(await orig<typeof import('../../../frontend/apps/web-console/src/lib/api')>()), api, authApi: api }));
vi.mock('recharts', () => new Proxy({}, { get: (_o, name) => name === 'then' ? undefined : ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));

const ME = { user: { id: 'u1', email: 'owner@x.test', name: 'Owner', locale: 'en', emailVerified: true, mfaEnrolled: false }, memberships: [], currentTenantId: 't1', currentRole: 'owner', csrfToken: 'c' };
const VENUE = { id: '01930000-0000-7000-8000-000000000001', name: 'Only venue', venue_code: 'CODE12', status: 'active' };
const summary = { tickets: 1, collected: 1, cancelled: 0, uncollected: 0, reachPushOrLivePct: 100, acknowledgedPct: 100, repeatPct: 0, undoPct: 0, prepSecondsP50: 60, pickupSecondsP50: 120, totalSecondsP50: 180, ratingAvg: null, ratingsCount: 0 };

function mount(ui: React.ReactElement, url = '/', client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></QueryClientProvider>);
  return client;
}

class Catch extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>Support UI crashed</p> : this.props.children; }
}

beforeEach(async () => {
  Object.values(api).forEach((f) => f.mockReset());
  useVenueStore.setState({ venueId: null });
  await initI18n('admin', { ar: adminAr, en: adminEn }, 'en');
  api.get.mockImplementation(async (path: string) => {
    if (path === '/me') return ME;
    if (path === '/announcements' || path === '/support-sessions') return { items: [] };
    if (path === '/tenant') return { status: 'active', complimentary: true };
    if (path === '/billing') return {};
    if (path === '/reports/trends') return { from: '2026-10-01', to: '2026-10-14', current: summary, previous: { from: '2026-09-17', to: '2026-09-30', ...summary }, series: [] };
    if (path.endsWith('/counters')) return { items: [{ id: 'c1', name: 'Food', archived: false }] };
    throw new Error(`unexpected GET ${path}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Current admin/console/site completeness defects', () => {
  it('the actual support /auth/me response crashes the global admin banners', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string, ...rest: unknown[]) => path === '/me'
      ? { support: { agentName: 'Agent', supportSessionId: 's1' }, currentTenantId: 't1', currentRole: 'support', csrfToken: 'c' }
      : base(path, ...rest));
    mount(<Catch><Banners /></Catch>);
    expect(await screen.findByText('Support UI crashed')).toBeTruthy();
    expect(error).toHaveBeenCalled();
  });

  it('cold-loading single-venue reports never enables the counter filter after venues arrive', async () => {
    let resolveVenues!: (v: unknown) => void;
    const pending = new Promise((resolve) => { resolveVenues = resolve; });
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation((path: string, ...rest: unknown[]) => path === '/venues' ? pending : base(path, ...rest));
    const client = mount(<ReportsPage />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reports/trends', expect.not.objectContaining({ venueId: VENUE.id })));
    await act(async () => { resolveVenues({ items: [VENUE] }); });
    await waitFor(() => expect(client.getQueryState(venuesKey)?.status).toBe('success'));
    expect(screen.queryByLabelText('Counter')).toBeNull();
    expect(api.get.mock.calls.some(([path]) => path === `/venues/${VENUE.id}/counters`)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(api.get.mock.calls.filter(([path]) => path === '/reports/trends').every(([, q]) => !q.venueId)).toBe(true);
  });

  it('pilot daily table drops both p90 values returned by the report API', async () => {
    const pilot = { ...summary, readyTickets: 1, alertReach: { push: 1, live: 0, closed: 0, none: 0 }, prepSecondsP90: 540, pickupSecondsP90: 780 };
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string, ...rest: unknown[]) => path === '/reports/pilot'
      ? { from: '2026-10-01', to: '2026-10-14', days: [{ date: '2026-10-01', ...pilot }], total: pilot }
      : base(path, ...rest));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(venuesKey, [VENUE]);
    mount(<ReportsPage />, '/?tab=daily', client);
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(document.body.textContent).not.toContain('9m');
    expect(document.body.textContent).not.toContain('13m');
    expect(document.body.textContent).not.toMatch(/90th|P90/i);
  });

  it('a legal-pending API failure silently removes the required acceptance gate', async () => {
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string, ...rest: unknown[]) => {
      if (path === '/legal/pending') throw new ApiError(0, 'NETWORK', null);
      return base(path, ...rest);
    });
    const client = mount(<><p>Application remains usable</p><LegalGate /></>);
    await waitFor(() => expect(client.getQueryState(['legal-pending'])?.status).toBe('error'));
    expect(screen.getByText('Application remains usable')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('site signup consent has no DPA link or DPA wording, and no Google entry', async () => {
    await initI18n('site', { ar: siteAr, en: siteEn }, 'en');
    api.get.mockResolvedValue({ available: true });
    mount(<SignUpPage />);
    const links = screen.getAllByRole('link').map((e) => e.getAttribute('href'));
    expect(links).toContain('/legal/terms');
    expect(links).toContain('/legal/privacy');
    expect(links).not.toContain('/legal/dpa');
    expect(document.body.textContent).not.toMatch(/data processing|Google/i);
    expect(document.querySelector('a[href*="oauth/google"]')).toBeNull();
  });

  it('the site password login also offers no Google sign-in', async () => {
    await initI18n('site', { ar: siteAr, en: siteEn }, 'en');
    mount(<CredentialsForm onDone={() => undefined} />);
    expect(document.querySelector('a[href*="oauth/google"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Google');
  });

  it('console tenant plan filtering cannot select a custom catalogue plan', async () => {
    await initI18n('console', { ar: consoleAr, en: consoleEn }, 'en');
    api.get.mockImplementation(async (path: string) => {
      if (path === '/me') return { platformUser: { id: 'p1', role: 'super_admin', name: 'Platform' }, csrfToken: 'c', environment: 'test' };
      if (path === '/tenants') return { items: [], nextCursor: null };
      if (path === '/plans') return { items: [{ code: 'enterprise', name: 'Enterprise', archived: false }] };
      throw new Error(`unexpected GET ${path}`);
    });
    mount(<TenantsPage />);
    await screen.findByRole('table');
    const select = screen.getByLabelText('Plan') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'trial', 'standard', 'pro', 'multisite']);
    expect([...select.options].some((o) => o.value === 'enterprise')).toBe(false);
    expect(api.get.mock.calls.some(([path]) => path === '/plans')).toBe(false);
  });

  it('account authenticator enrollment sends no password proof and cannot reach the QR step', async () => {
    api.post.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', null, 'Password is incorrect'));
    mount(<TotpEnrolment onEnrolled={() => undefined} />);
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/mfa/totp/enroll'));
    expect(api.post.mock.calls[0]?.[1]).toBeUndefined();
    await screen.findByRole('alert');
    expect(screen.queryByRole('img', { name: 'QR code for your authenticator app' })).toBeNull();
  });

  it('mandatory two-factor enrollment uses the same missing-proof request and remains blocked', async () => {
    api.post.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', null, 'Password is incorrect'));
    mount(<TwoFactorRequiredPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up two-factor' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/mfa/totp/enroll'));
    expect(api.post.mock.calls[0]?.[1]).toBeUndefined();
    await screen.findByRole('alert');
    expect(screen.queryByRole('img', { name: 'QR code for your authenticator app' })).toBeNull();
  });

  it('authenticator removal sends no code and fails the current backend request schema', async () => {
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string, ...rest: unknown[]) => path === '/me'
      ? { ...ME, user: { ...ME.user, mfaEnrolled: true } }
      : base(path, ...rest));
    api.delete.mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', null));
    mount(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off two-factor' }));
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    const buttons = await screen.findAllByRole('button', { name: 'Turn off two-factor' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/mfa/totp'));
    expect(api.delete.mock.calls[0]?.[1]).toBeUndefined();
    expect(totpRemoveBody.safeParse(api.delete.mock.calls[0]?.[1] ?? {}).success).toBe(false);
    await screen.findByRole('alert');
  });
});
