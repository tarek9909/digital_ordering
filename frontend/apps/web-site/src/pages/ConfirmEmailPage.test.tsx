// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/site.json';
import en from '@dop/i18n/locales/en/site.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmEmailPage } from './ConfirmEmailPage';

// W05 / FR-ADM-18: confirm a new sign-in email from the link sent to it.
const post = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), authApi: { post } }));
const TOKEN = 'T'.repeat(43);

beforeAll(async () => {
  await initI18n('site', { ar, en }, 'en');
});
beforeEach(() => post.mockReset());
afterEach(cleanup);

const renderPage = (search = `?token=${TOKEN}`) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/confirm-email${search}`]}>
        <Routes>
          <Route path="/confirm-email" element={<ConfirmEmailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const problem = (status: number, code: string) => new ApiError(status, code as never, { type: 'x', title: 'x', status, code: code as never });

it('confirms once and shows the new email', async () => {
  post.mockResolvedValue({ email: 'new@example.com' });
  renderPage();
  expect(await screen.findByText('new@example.com')).toBeTruthy();
  expect(screen.getByText('For your security, your account was signed out on other devices.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Continue to sign in' }).getAttribute('href')).toBe('/sign-in');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/email/change/confirm', { token: TOKEN });
});

it('an expired or used link (410) says so', async () => {
  post.mockRejectedValueOnce(problem(410, 'INVITATION_EXPIRED'));
  renderPage();
  expect(await screen.findByText('This confirmation link has expired or was already used.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it('a missing token is treated as an invalid link without calling the server', () => {
  renderPage('');
  expect(screen.getByText('This confirmation link has expired or was already used.')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('an email now used by another account (409) says so', async () => {
  post.mockRejectedValueOnce(problem(409, 'EMAIL_TAKEN'));
  renderPage();
  expect(await screen.findByText('Another account already uses this email.')).toBeTruthy();
});

it('other failures offer a retry', async () => {
  post.mockRejectedValueOnce(new ApiError(0, 'NETWORK', null)).mockResolvedValueOnce({ email: 'new@example.com' });
  renderPage();
  const retry = await screen.findByRole('button', { name: 'Try again' });
  await act(async () => {
    fireEvent.click(retry);
  });
  expect(await screen.findByText('new@example.com')).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(2);
});
