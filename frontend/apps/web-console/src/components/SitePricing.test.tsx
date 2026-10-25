// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { FreshMfaProvider } from './FreshMfa';
import { SitePricing } from './SitePricing';

// W09: pricing section on the landing page (title, included list, WhatsApp line, periods).

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api }));

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  api.put.mockReset().mockResolvedValue(undefined);
  api.get.mockReset();
});
afterEach(cleanup);

const value = {
  title: { ar: 'خططنا', en: 'Our plans' },
  included: { ar: ['تنبيهات', 'ملصقات'], en: ['Alerts', 'Posters'] },
  note: { ar: 'فروع أكثر؟ كلمنا', en: 'Several branches or a chain? Talk to us about a price.' },
  periods: ['month', 'quarter', 'year'] as ('month' | 'quarter' | 'year')[],
  plans: {},
};

const renderForm = (onSaved = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FreshMfaProvider>
        <SitePricing value={value} onSaved={onSaved} />
      </FreshMfaProvider>
    </QueryClientProvider>,
  );
  return onSaved;
};

it('saves periods and the included list, and no longer edits plans (they come from the Plans page)', async () => {
  const onSaved = renderForm();
  await screen.findByLabelText('In every plan (EN)');
  expect(screen.queryByLabelText('Name on the website (EN)')).toBeNull();
  expect(screen.queryByLabelText('Highlight as most popular')).toBeNull();
  fireEvent.click(screen.getByLabelText('Every 3 months'));
  fireEvent.change(screen.getByLabelText('In every plan (EN)'), { target: { value: 'Alerts\n\n  QR posters  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save packages' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/settings/site.pricing', expect.any(Object)));
  const body = api.put.mock.calls[0]![1] as { value: typeof value };
  expect(body.value.periods).toEqual(['month', 'year']);
  expect(body.value.included.en).toEqual(['Alerts', 'QR posters']);
  expect(body.value.included.ar).toEqual(value.included.ar);
  expect(body.value.plans).toEqual({});
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('needs at least one period before sending', async () => {
  renderForm();
  await screen.findByLabelText('In every plan (EN)');
  for (const p of ['Monthly', 'Every 3 months', 'Yearly']) fireEvent.click(screen.getByLabelText(p));
  fireEvent.click(screen.getByRole('button', { name: 'Save packages' }));
  expect(screen.getByRole('alert').textContent).toBe('Pick at least one period.');
  expect(api.put).not.toHaveBeenCalled();
});
