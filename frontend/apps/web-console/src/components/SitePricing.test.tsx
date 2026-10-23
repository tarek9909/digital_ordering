// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { PLATFORM_SETTING_DEFAULTS } from '@dop/contracts';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { FreshMfaProvider } from './FreshMfa';
import { SitePricing } from './SitePricing';

// The website's packages section (wording, periods, plan names and the highlighted plan) is set here by super admins.
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api }));

const plan = (code: string, name: string, isPublic = true) => ({ id: code, code, name, isPublic, archived: false, limits: {}, features: [], prices: [] });

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  api.put.mockReset().mockResolvedValue(undefined);
  api.get.mockReset().mockResolvedValue({ items: [plan('standard', 'Standard'), plan('pro', 'Pro'), plan('internal', 'Internal', false)] });
});
afterEach(cleanup);

const value = PLATFORM_SETTING_DEFAULTS['site.pricing'];
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

it('lists only public plans and saves names, the highlight, periods and the included list', async () => {
  const onSaved = renderForm();
  expect(await screen.findByText('Pro')).toBeTruthy();
  expect(screen.queryByText('Internal')).toBeNull();
  fireEvent.change(screen.getAllByLabelText('Name on the website (EN)')[1]!, { target: { value: 'Pro+' } });
  fireEvent.change(screen.getAllByLabelText('Short description (EN)')[1]!, { target: { value: 'For busy counters' } });
  fireEvent.click(screen.getAllByLabelText('Highlight as most popular')[1]!);
  fireEvent.click(screen.getByLabelText('Every 3 months'));
  fireEvent.change(screen.getByLabelText('In every plan (EN)'), { target: { value: 'Alerts\n\n  QR posters  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save packages' }));
  await waitFor(() => expect(api.put).toHaveBeenCalled());
  const [path, body] = api.put.mock.calls[0]!;
  expect(path).toBe('/settings/site.pricing');
  expect(body.value.periods).toEqual(['month', 'year']);
  expect(body.value.included.en).toEqual(['Alerts', 'QR posters']);
  expect(body.value.included.ar).toEqual(value.included.ar);
  // Untouched plans are left out so the site keeps their catalogue names.
  expect(body.value.plans).toEqual({ pro: { name: { ar: '', en: 'Pro+' }, tagline: { ar: '', en: 'For busy counters' }, featured: true } });
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('needs at least one period before sending', async () => {
  renderForm();
  await screen.findByText('Pro');
  for (const p of ['Monthly', 'Every 3 months', 'Yearly']) fireEvent.click(screen.getByLabelText(p));
  fireEvent.click(screen.getByRole('button', { name: 'Save packages' }));
  expect(screen.getByRole('alert').textContent).toBe('Pick at least one period.');
  expect(api.put).not.toHaveBeenCalled();
});
