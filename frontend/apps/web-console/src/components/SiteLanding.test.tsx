// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { PLATFORM_SETTING_DEFAULTS } from '@dop/contracts';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import siteEn from '@dop/i18n/locales/en/site.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { diffCopy, missingPlaceholders } from '../lib/siteCopy';
import { FreshMfaProvider } from './FreshMfa';
import { SiteLanding } from './SiteLanding';

// The landing page's sections and text are edited here by super admins (`site.landing`).
const put = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: { put } }));

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => put.mockReset().mockResolvedValue(undefined));
afterEach(cleanup);

describe('copy helpers', () => {
  it('keeps only what changed, drops blank text and blank list items', () => {
    const base = { a: 'A', b: 'B', list: ['x', 'y'], items: [{ q: '1', a: '2' }] };
    expect(diffCopy(base, base)).toBeUndefined();
    expect(diffCopy(base, { ...base, a: 'New', b: '  ' })).toEqual({ a: 'New' });
    expect(diffCopy(base, { ...base, list: ['x', 'y', ' '] })).toBeUndefined();
    expect(diffCopy(base, { ...base, items: [{ q: '1', a: '2' }, { q: '', a: '' }, { q: '3', a: '' }] })).toEqual({ items: [{ q: '1', a: '2' }, { q: '3', a: '' }] });
  });

  it('finds texts that lost a placeholder', () => {
    const base = { tv: { announce: 'Order {{number}} is ready', scan: 'Scan' } };
    expect(missingPlaceholders(base, { tv: { announce: 'Order ready', scan: 'x' } })).toEqual(['tv.announce']);
    expect(missingPlaceholders(base, { tv: { announce: 'Number {{number}}!', scan: 'x' } })).toEqual([]);
    expect(missingPlaceholders(base, { tv: { announce: '', scan: 'x' } })).toEqual([]);
  });
});

const renderEditor = (onSaved = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FreshMfaProvider>
        <SiteLanding value={PLATFORM_SETTING_DEFAULTS['site.landing']} onSaved={onSaved} />
      </FreshMfaProvider>
    </QueryClientProvider>,
  );
  return onSaved;
};

it('saves hidden sections, changed text and an edited list, and nothing else', async () => {
  const onSaved = renderEditor();
  const title = (await screen.findByLabelText('Title (EN)')) as HTMLInputElement;
  expect(title.value).toBe(siteEn.landing.hero.title);
  fireEvent.change(title, { target: { value: 'Ring them from the counter.' } });
  expect(screen.getByRole('button', { name: "Use the website's text for Title (EN)" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Partner logos'));

  fireEvent.change(screen.getByLabelText('Part of the page'), { target: { value: 'faq' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove Items item 1 (EN)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add to Items (EN)' }));
  const n = siteEn.landing.faq.items.length;
  fireEvent.change(screen.getByLabelText(`Question ${n} (EN)`), { target: { value: 'Do you take cash?' } });
  fireEvent.change(screen.getByLabelText(`Answer ${n} (EN)`), { target: { value: 'Yes, in dollars.' } });

  fireEvent.click(screen.getByRole('button', { name: 'Save landing page' }));
  await waitFor(() => expect(put).toHaveBeenCalled());
  const [path, body] = put.mock.calls[0]!;
  expect(path).toBe('/settings/site.landing');
  expect(body.value.hidden).toEqual(['trust']);
  expect(body.value.copy.ar).toEqual({});
  expect(body.value.copy.en.landing.hero).toEqual({ title: 'Ring them from the counter.' });
  expect(body.value.copy.en.landing.faq.items).toEqual([...siteEn.landing.faq.items.slice(1), { q: 'Do you take cash?', a: 'Yes, in dollars.' }]);
  expect(Object.keys(body.value.copy.en.landing)).toEqual(['hero', 'faq']);
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('refuses text that drops a placeholder the site fills in', async () => {
  renderEditor();
  fireEvent.change(await screen.findByLabelText('Part of the page'), { target: { value: 'tv' } });
  fireEvent.change(screen.getByLabelText('Announce (EN)'), { target: { value: 'Your order is ready.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save landing page' }));
  expect(screen.getByRole('alert').textContent).toContain('landing.tv.announce (EN)');
  expect(put).not.toHaveBeenCalled();
});
