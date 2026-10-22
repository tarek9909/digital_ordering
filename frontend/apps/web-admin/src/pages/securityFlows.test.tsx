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
import type { Me } from '../lib/types';
import { AccountPage } from './Account';

// Admin flows changed by the 2026-10-22 security repairs (docs/security/2026-10-22/REMEDIATION.md, H-5).

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
