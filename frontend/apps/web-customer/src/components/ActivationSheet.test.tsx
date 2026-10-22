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

// CSD01: a failed push setup must not say "You're all set" or report alerts as on; it offers a retry.
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

it('shows a failure with a retry when saving the push subscription fails, and never reports alerts on', async () => {
  f.enablePush.mockRejectedValueOnce(new Error('HTTP 500'));
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/Notifications could not be set up/);
  expect(screen.queryByText(/You're all set/)).toBeNull();
  expect(f.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(false));
  expect(onClose).not.toHaveBeenCalledWith(true);
});

it('succeeds on retry after a temporary failure', async () => {
  f.enablePush.mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValueOnce('granted');
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await screen.findByText(/You're all set/);
  expect(f.enablePush).toHaveBeenCalledTimes(2);
  expect(f.post).toHaveBeenCalledOnce();
});

it('closing the sheet after a failure does not report alerts on', async () => {
  f.enablePush.mockRejectedValueOnce(new Error('HTTP 500'));
  const onClose = vi.fn();
  render(<ActivationSheet token={T} fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/Notifications could not be set up/);
  fireEvent.click(screen.getByRole('button', { name: '×' }));
  expect(onClose).toHaveBeenCalledWith(false);
});
