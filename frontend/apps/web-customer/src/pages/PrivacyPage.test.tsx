// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { i18next, initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyPage } from './PrivacyPage';

// W12: the platform-published customer privacy notice, with fallback to the built-in text.
const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ publicApi: { get } }));
const doc = { kind: 'customer_privacy', version: '3', locale: 'en', publishedAt: '2026-10-01T09:00:00Z', url: null, html: '<h2>Who we are</h2><p>Published <strong>notice</strong>.</p>' };
const fallback = /This page shows your order status/;

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } })}>
      <PrivacyPage />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  get.mockReset();
  await initI18n('customer', { ar, en }, 'en');
});
afterEach(cleanup);

it('renders the published notice in the page language with version and date', async () => {
  get.mockResolvedValue(doc);
  renderPage();
  await screen.findByRole('heading', { name: 'Who we are' });
  expect(screen.getByText('notice').tagName).toBe('STRONG');
  expect(screen.getByText('Version 3 · published October 1, 2026')).toBeTruthy();
  expect(screen.queryByText(fallback)).toBeNull();
  expect(get).toHaveBeenCalledWith('/legal/customer_privacy', { locale: 'en' });
});

it('asks for the current language', async () => {
  await i18next.changeLanguage('ar');
  get.mockResolvedValue({ ...doc, locale: 'ar' });
  renderPage();
  await screen.findByRole('heading', { name: 'Who we are' });
  expect(get).toHaveBeenCalledWith('/legal/customer_privacy', { locale: 'ar' });
});

it('falls back to the built-in text when nothing is published (404)', async () => {
  get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', null));
  renderPage();
  await screen.findByText(fallback);
  expect(get).toHaveBeenCalledTimes(1);
});

it('falls back to the built-in text when the document has no HTML', async () => {
  get.mockResolvedValue({ ...doc, html: null });
  renderPage();
  await screen.findByText(fallback);
});

it('shows an error with retry for other failures', async () => {
  get.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', null));
  renderPage();
  await screen.findByText('The privacy notice could not be loaded. Check your connection and try again.', undefined, { timeout: 4000 });
  expect(screen.queryByText(fallback)).toBeNull();
  get.mockResolvedValue(doc);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'Who we are' });
});
