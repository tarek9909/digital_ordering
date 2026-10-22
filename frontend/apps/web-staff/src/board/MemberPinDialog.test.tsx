// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/staff.json';
import en from '@dop/i18n/locales/en/staff.json';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { useMember } from '../lib/member';
import { MemberPinDialog } from './MemberPinDialog';

// W17 / FR-ACC-06 for the personal PIN pad: the lock ends by itself, using the server's retryAfterSeconds.
const post = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), signInApi: { post } }));

beforeAll(async () => {
  await initI18n('staff', { ar, en }, 'en');
});
beforeEach(() => {
  post.mockReset();
  useMember.setState({ asking: true });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('unlocks after the server lock duration with a countdown', async () => {
  post.mockRejectedValueOnce(new ApiError(423, 'PIN_LOCKED', { type: 'x', title: 'x', status: 423, code: 'PIN_LOCKED', data: { retryAfterSeconds: 20, lockedUntil: new Date(Date.now() + 20_000).toISOString() } }));
  render(<MemberPinDialog />);
  for (const d of '1357') fireEvent.click(screen.getByRole('button', { name: d }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  });
  await screen.findByText('You can try again in 0:20.');
  expect((screen.getByRole('button', { name: '1' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(21_000);
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: '1' }) as HTMLButtonElement).disabled).toBe(false);
});
