// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { i18next, initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/site.json';
import en from '@dop/i18n/locales/en/site.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';
import { overlaySiteCopy as overlay } from '@dop/contracts';
import { applySiteCopy } from './content';

// Landing page content from the console (`site.landing`): text laid over the built-in copy, and hidden sections.

const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ publicApi: { get } }));
vi.mock('./motion', () => ({ animateLanding: () => () => undefined }));

beforeAll(async () => {
  await initI18n('site', { ar, en }, 'en');
});
afterEach(() => {
  cleanup();
  applySiteCopy(undefined);
});

describe('overlay', () => {
  it('replaces text, keeps the built-in text for blanks and unknown keys, and never changes the shape', () => {
    const base = { title: 'A', body: 'B', items: [{ q: 'q1', a: 'a1' }], words: ['x', 'y'] };
    expect(overlay(base, { title: 'New', body: '  ', extra: 'ignored' })).toEqual({ ...base, title: 'New' });
    expect(overlay(base, { title: ['not', 'text'] })).toEqual(base);
    expect(overlay(base, { words: ['only'] })).toEqual({ ...base, words: ['only'] });
    expect(overlay(base, { words: [{ q: 'x' }] })).toEqual(base);
    // A list is replaced whole; an added item missing a field gets it empty, not another item's text.
    expect(overlay(base, { items: [{ q: 'new' }, { q: 'q2', a: 'a2' }] })).toEqual({ ...base, items: [{ q: 'new', a: '' }, { q: 'q2', a: 'a2' }] });
  });

  it('lays the text over each language and restores the built-in copy', () => {
    applySiteCopy({ ar: { landing: { hero: { title: 'جرس' } } }, en: { landing: { hero: { title: 'Ring' } }, nav: { faq: 'Help' } } });
    expect(i18next.t('landing.hero.title', { ns: 'site' })).toBe('Ring');
    expect(i18next.t('nav.faq', { ns: 'site' })).toBe('Help');
    expect(i18next.t('landing.hero.title', { ns: 'site', lng: 'ar' })).toBe('جرس');
    expect(i18next.t('landing.hero.body', { ns: 'site' })).toBe(en.landing.hero.body);
    applySiteCopy(undefined);
    expect(i18next.t('landing.hero.title', { ns: 'site' })).toBe(en.landing.hero.title);
  });
});

it('shows the console text and leaves out hidden sections', async () => {
  const landing = { hidden: ['faq', 'trust'], copy: { ar: {}, en: { landing: { hero: { title: 'Ring them from the counter.' } } } } };
  get.mockImplementation(async (path: string) => (path === '/site' ? { contact: { email: null, whatsapp: null, whatsappUrl: null }, landing } : { items: [], trialDays: 14 }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Ring them from the counter.' })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('heading', { name: en.landing.faq.title })).toBeNull());
  expect(screen.queryByRole('heading', { name: en.landing.trust.title })).toBeNull();
  expect(screen.getByRole('heading', { name: en.landing.compare.title })).toBeTruthy();
});
