// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/site.json';
import en from '@dop/i18n/locales/en/site.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { LegalPage } from './LegalPage';

// W12: the published document is the server-sanitised `html`; the raw URL is no longer fetched by the client.
const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), publicApi: { get } }));
const fetchSpy = vi.fn();

const doc = { kind: 'privacy', version: '3', locale: 'en', url: 'https://cdn.example/legal/privacy-en-3.html', publishedAt: '2026-10-01T00:00:00Z' };

beforeAll(async () => {
  await initI18n('site', { ar, en }, 'en');
});
beforeEach(() => {
  get.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/legal/privacy']}>
        <Routes>
          <Route path="/legal/:kind" element={<LegalPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

it('renders the sanitised HTML as markup', async () => {
  get.mockResolvedValue({ ...doc, html: '<h2>Data we keep</h2><ul><li>Your order number</li></ul><p>See <a href="https://example.com/x">details</a>.</p>' });
  renderPage();
  expect(await screen.findByRole('heading', { level: 2, name: 'Data we keep' })).toBeTruthy();
  expect(screen.getByRole('listitem').textContent).toBe('Your order number');
  expect(screen.getByRole('link', { name: 'details' }).getAttribute('href')).toBe('https://example.com/x');
  expect(get).toHaveBeenCalledWith('/legal/privacy', { locale: 'en' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('falls back to the original link when there is no HTML', async () => {
  get.mockResolvedValue({ ...doc, html: null });
  renderPage();
  expect(await screen.findByText('The document could not be shown here. Open the original below.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open the original document' }).getAttribute('href')).toBe(doc.url);
  expect(fetchSpy).not.toHaveBeenCalled();
});
