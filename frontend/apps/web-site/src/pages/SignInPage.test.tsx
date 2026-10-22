// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/site.json';
import en from '@dop/i18n/locales/en/site.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SignInPage } from './SignInPage';

// AS02 (docs/audits/2026-10-22-completeness/REMEDIATION.md): the public site offers Google sign-in for existing
// accounts and explains when Google found no Tanbeeh account, instead of a dead-end chooser.

const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), authApi: { get, post: vi.fn() } }));

beforeAll(async () => {
  await initI18n('site', { ar, en }, 'en');
});
beforeEach(() => {
  get.mockReset();
  get.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', null)); // no www session yet
});
afterEach(cleanup);

const renderAt = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <SignInPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

it('offers Google sign-in on the public site', async () => {
  renderAt('/sign-in');
  const google = await screen.findByRole('link', { name: /Continue with Google/ });
  expect(google.getAttribute('href')).toBe('/api/auth/v1/oauth/google/start');
  expect(screen.queryByText(/There is no Tanbeeh account/)).toBeNull();
});

it('explains that no account exists for the Google address', async () => {
  renderAt('/sign-in?google=no-account');
  expect((await screen.findByRole('alert')).textContent).toMatch(/There is no Tanbeeh account for that Google address/);
  expect(screen.getByLabelText('Email')).toBeTruthy(); // the password sign-in stays usable
});
