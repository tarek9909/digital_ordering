import { initI18n } from '@dop/i18n';
import ar from '../../../frontend/packages/i18n/locales/ar/customer.json';
import en from '../../../frontend/packages/i18n/locales/en/customer.json';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActivationSheet } from '../../../frontend/apps/web-customer/src/components/ActivationSheet';
import { ReadyScreen } from '../../../frontend/apps/web-customer/src/components/ReadyScreen';
const f = vi.hoisted(() => ({ enablePush: vi.fn(), post: vi.fn() }));
vi.mock('../../../frontend/apps/web-customer/src/lib/api', () => ({ publicApi: { post: f.post } }));
vi.mock('../../../frontend/apps/web-customer/src/lib/audio', () => ({ unlockAudio: async () => true, testChime: async () => undefined, keepAwake: async () => undefined }));
vi.mock('../../../frontend/apps/web-customer/src/lib/push', () => ({ enablePush: f.enablePush, notificationsBlocked: () => false }));
beforeEach(async () => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  await initI18n('customer', { ar, en }, 'en');
  f.post.mockResolvedValue(undefined);
});
afterEach(cleanup);
it('reproduces false activation success when push subscription persistence rejects', async () => {
  f.enablePush.mockRejectedValue(new Error('PUT push-subscription returned 500'));
  const onClose = vi.fn();
  render(<ActivationSheet token="AAAAAAAAAAAAAAAAAAAAAA" fromHomeScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /Allow notifications/ }));
  await screen.findByText(/You're all set/);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledWith(true);
  expect(f.enablePush).toHaveBeenCalledOnce();
});
it('reproduces collection instructions ignoring the selected customer language', () => {
  const ticket = { displayNumber: '11', status: 'ready', acknowledged: false, checkCode: null, venue: { locales: ['ar', 'en'], messages: { ar: { collection: 'تعليمات عربية' }, en: { collection: 'Collect at the blue counter' } } } } as any;
  render(<ReadyScreen ticket={ticket} alerting={false} needsTap={false} onTapToHear={() => undefined} onComing={() => undefined} />);
  expect(screen.getByText('تعليمات عربية')).toBeTruthy();
  expect(screen.queryByText('Collect at the blue counter')).toBeNull();
});
