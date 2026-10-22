// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ActivationSheet } from './ActivationSheet';

// CSD01: the sheet reports the delivery capability it actually reached. A failed push setup never says
// "You're all set", never reports `push`, and offers a retry; `push` is reported only after the PUT succeeded.
const f = vi.hoisted(() => ({ enablePush: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', () => ({ publicApi: { post: f.post } }));
vi.mock('../lib/audio', () => ({ unlockAudio: async () => true, testChime: async () => undefined, keepAwake: async () => undefined }));
vi.mock('../lib/push', () => ({ enablePush: f.enablePush, notificationsBlocked: () => false }));
const T = 'AAAAAAAAAAAAAAAAAAAAAA';

beforeAll(async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  await initI18n('customer', { ar, en }, 'en');
});
beforeEach(() => {
  vi.clearAllMocks();
  f.post.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('CSD01: shows a failure with a retry when saving the push subscription fails, and never reports push', async () => {
  f.enablePush.mockRejectedValueOnce(new Error('HTTP 500'));
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/Notifications could not be set up/);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/You're all set/)).toBeNull();
  expect(f.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith('failed'));
  expect(onClose).not.toHaveBeenCalledWith('push');
});

it('CSD01: succeeds on retry after a temporary failure and reports push only then', async () => {
  f.enablePush.mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValueOnce('granted');
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await screen.findByText(/You're all set/);
  expect(f.enablePush).toHaveBeenCalledTimes(2);
  expect(f.post).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledWith('push');
});

it('CSD01: closing the sheet after a failure reports the failure', async () => {
  f.enablePush.mockRejectedValueOnce(new Error('HTTP 500'));
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/Notifications could not be set up/);
  fireEvent.click(screen.getByRole('button', { name: '×' }));
  expect(onClose).toHaveBeenCalledWith('failed');
});

it('CSD01: waits for the follower registration before saving the subscription; a failed follow is a failure', async () => {
  const ensureFollowed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  f.enablePush.mockResolvedValue('granted');
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen ensureFollowed={ensureFollowed} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/Notifications could not be set up/);
  expect(f.enablePush).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(/You're all set/);
  expect(ensureFollowed).toHaveBeenCalledTimes(2);
  expect(f.enablePush).toHaveBeenCalledOnce();
  expect(ensureFollowed.mock.invocationCallOrder[1]!).toBeLessThan(f.enablePush.mock.invocationCallOrder[0]!);
});

it('CSD01: a browser without push reports live-only alerts; a refusal reports blocked', async () => {
  f.enablePush.mockResolvedValueOnce('unsupported');
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/You're all set/);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenLastCalledWith('live');
  cleanup();

  f.enablePush.mockResolvedValueOnce('denied');
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/Notifications are blocked/);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenLastCalledWith('blocked');
});
