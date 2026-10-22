// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/staff.json';
import en from '@dop/i18n/locales/en/staff.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SignInPage } from './SignInPage';

// W17 / FR-ACC-06: after PIN_LOCKED the keypad unlocks by itself when the lock ends, with a countdown meanwhile.
const post = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), signInApi: { post } }));
const KEY = 'K'.repeat(32);

beforeAll(async () => {
  await initI18n('staff', { ar, en }, 'en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('dop.staff.deviceName', 'Front');
  post.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/${KEY}`]}>
        <Routes>
          <Route path="/:staffKey" element={<SignInPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const typePin = (pin: string) => [...pin].forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

it('unlocks the keypad when the lock duration passes', async () => {
  post.mockRejectedValueOnce(new ApiError(423, 'PIN_LOCKED', { type: 'x', title: 'x', status: 423, code: 'PIN_LOCKED', data: { retryAfterSeconds: 65 } }));
  renderPage();
  typePin('4821');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open board' }));
  });
  await screen.findByText('Too many wrong PINs. This device is temporarily locked.');
  expect(screen.getByText('You can try again in 1:05.')).toBeTruthy();
  expect((screen.getByRole('button', { name: '1' }) as HTMLButtonElement).disabled).toBe(true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(screen.getByText('You can try again in 0:35.')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(36_000);
  });
  expect(screen.queryByText(/locked/)).toBeNull();
  expect((screen.getByRole('button', { name: '1' }) as HTMLButtonElement).disabled).toBe(false);
});

it('without a duration from the server the lock lasts the documented 10 minutes', async () => {
  post.mockRejectedValueOnce(new ApiError(423, 'PIN_LOCKED', null));
  renderPage();
  typePin('4821');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open board' }));
  });
  await screen.findByText('You can try again in 10:00.');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9 * 60_000);
  });
  expect((screen.getByRole('button', { name: '1' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(61_000);
  });
  expect((screen.getByRole('button', { name: '1' }) as HTMLButtonElement).disabled).toBe(false);
});
