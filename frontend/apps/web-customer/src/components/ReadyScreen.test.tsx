// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { i18next, initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadyScreen } from './ReadyScreen';

// CSD09: the collection instruction follows the customer's selected language, then the venue default.
vi.mock('../lib/audio', () => ({ unlockAudio: async () => true }));
const ticket = (messages: Record<string, { collection?: string }>) =>
  ({ displayNumber: '11', status: 'ready', acknowledged: false, checkCode: null, venue: { locales: ['ar', 'en'], messages } }) as never;
const props = { alerting: false, needsTap: false, onTapToHear: () => undefined, onComing: () => undefined };

beforeEach(async () => {
  await initI18n('customer', { ar, en }, 'en');
});
afterEach(cleanup);

it('CSD09: English UI shows the English collection instruction, not the venue default', () => {
  render(<ReadyScreen ticket={ticket({ ar: { collection: 'تعليمات عربية' }, en: { collection: 'Collect at the blue counter' } })} {...props} />);
  expect(screen.getByText('Collect at the blue counter')).toBeTruthy();
  expect(screen.queryByText('تعليمات عربية')).toBeNull();
});

it('CSD09: switching language switches the instruction; a missing translation falls back to the venue default', async () => {
  render(<ReadyScreen ticket={ticket({ ar: { collection: 'تعليمات عربية' }, en: { collection: 'Collect at the blue counter' } })} {...props} />);
  await act(async () => {
    await i18next.changeLanguage('ar');
  });
  expect(screen.getByText('تعليمات عربية')).toBeTruthy();
  cleanup();
  await act(async () => {
    await i18next.changeLanguage('en');
  });
  render(<ReadyScreen ticket={ticket({ ar: { collection: 'تعليمات عربية' }, en: {} })} {...props} />);
  expect(screen.getByText('تعليمات عربية')).toBeTruthy();
});
