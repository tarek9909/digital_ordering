// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/admin.json';
import en from '@dop/i18n/locales/en/admin.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@dop/client-sdk';
import { Banners } from '../components/Banners';
import { normalizeMe } from '../lib/me';
import type { Me } from '../lib/types';
import { AccountPage } from './Account';
import { TwoFactorRequiredPage } from './TwoFactorRequired';

// Admin flows changed by the 2026-10-22 security repairs (docs/security/2026-10-22/REMEDIATION.md, H-5) and the
// completeness repairs AS01 / AS11 (docs/audits/2026-10-22-completeness/REMEDIATION.md).

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api, authApi: api }));

const me = (mfaEnrolled: boolean): Me =>
  ({
    user: { id: 'u1', email: 'owner@x.test', name: 'Owner', locale: 'en', emailVerified: true, mfaEnrolled, pendingEmail: null },
    preferences: { weeklySummary: true },
    memberships: [{ tenantId: 't1', slug: 'cafe', name: 'Cafe', status: 'active', role: 'owner' }],
    currentTenantId: 't1',
    currentRole: 'owner',
    csrfToken: 'c',
  }) as Me;

function renderAccount(m: Me) {
  api.get.mockImplementation(async (path: string) => {
    if (path === '/me') return m;
    throw new Error(`unexpected GET ${path}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await initI18n('admin', { ar, en }, 'en');
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(cleanup);

describe('authenticator changes re-prove the account (H-5)', () => {
  it('sends the password when starting enrolment', async () => {
    api.post.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' });
    renderAccount(me(false));
    fireEvent.input(await screen.findByLabelText('Confirm with your password'), { target: { value: 'my-current-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/mfa/totp/enroll', { password: 'my-current-pass' }));
  });

  it('sends a current code when turning two-factor off, and does nothing without one', async () => {
    api.delete.mockResolvedValue(undefined);
    renderAccount(me(true));
    const confirm = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Turn off two-factor' }));
      const buttons = await screen.findAllByRole('button', { name: 'Turn off two-factor' });
      fireEvent.click(buttons.at(-1)!);
    };
    await confirm();
    await waitFor(() => expect(screen.getByText('Enter the 6-digit code.')).toBeTruthy());
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    await confirm();
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/mfa/totp', { code: '123456' }));
  });
});

const problem = (status: number, code: 'UNAUTHENTICATED' | 'FORBIDDEN') => new ApiError(status, code, { type: 'about:blank', title: code, status, code });

function renderWith(ui: React.ReactElement, routes: Record<string, unknown>) {
  api.get.mockImplementation(async (path: string) => {
    if (path in routes) return routes[path];
    throw new Error(`unexpected GET ${path}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('approved support identity (AS01)', () => {
  const supportResponse = { support: { agentName: 'Sara (Tanbeeh)', supportSessionId: 's1' }, currentTenantId: 't1', currentRole: 'support', csrfToken: 'c' };
  it('normalises the server support response into a support identity', () => {
    const m = normalizeMe(supportResponse as never);
    expect(m).toMatchObject({ support: true, currentRole: null, currentTenantId: 't1', agentName: 'Sara (Tanbeeh)', supportSessionId: 's1', csrfToken: 'c' });
    expect(m.user.emailVerified).toBe(true);
    expect(normalizeMe(me(false))).toEqual(me(false));
  });
  it('renders the admin banners for a support agent without crashing or reading the owner-only tenant', async () => {
    renderWith(<Banners />, {
      '/me': supportResponse,
      '/support-sessions': { items: [{ id: 's1', status: 'active', kind: 'approved', reason: 'r', agentName: 'Sara (Tanbeeh)', requestedAt: '2026-10-22T09:00:00Z', expiresAt: '2026-10-22T11:00:00Z', endedAt: null }] },
    });
    expect(await screen.findByText(/You are in an approved support session/)).toBeTruthy();
    expect(api.get.mock.calls.map((c) => c[0])).not.toContain('/tenant');
    expect(api.get.mock.calls.map((c) => c[0])).not.toContain('/announcements');
  });
});

describe('authenticator proof errors stay recoverable (AS11)', () => {
  it('shows a wrong password on the field and lets the user retry', async () => {
    api.post.mockRejectedValueOnce(problem(401, 'UNAUTHENTICATED')).mockResolvedValueOnce({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' });
    renderAccount(me(false));
    const field = await screen.findByLabelText('Confirm with your password');
    fireEvent.input(field, { target: { value: 'wrong-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    expect(await screen.findByText('The password is incorrect.')).toBeTruthy();
    fireEvent.input(field, { target: { value: 'right-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/mfa/totp/enroll', { password: 'right-pass' }));
    expect(await screen.findByLabelText('QR code for your authenticator app')).toBeTruthy();
  });

  it('the mandatory two-factor screen sends the password too', async () => {
    api.post.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' });
    renderWith(<TwoFactorRequiredPage />, { '/me': me(false) });
    fireEvent.input(await screen.findByLabelText('Confirm with your password'), { target: { value: 'my-current-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/mfa/totp/enroll', { password: 'my-current-pass' }));
  });

  it('explains the multi-venue rule when removal is refused', async () => {
    api.delete.mockRejectedValue(problem(403, 'FORBIDDEN'));
    renderAccount(me(true));
    fireEvent.input(await screen.findByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off two-factor' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Turn off two-factor' })).at(-1)!);
    expect(await screen.findByText(/required while you manage several venues/)).toBeTruthy();
  });
});
