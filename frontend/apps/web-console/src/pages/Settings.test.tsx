// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { PLATFORM_SETTING_DEFAULTS } from '@dop/contracts';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { FreshMfaProvider } from '../components/FreshMfa';
import { checkSetting, groupSettings } from '../lib/settingsForm';
import { SettingsPage } from './Settings';

// Platform settings are edited as forms, not JSON; a section saves only the settings that changed.
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', () => ({ api }));

const rows = Object.entries(PLATFORM_SETTING_DEFAULTS).map(([key, value]) => ({ key, value, updatedAt: null }));

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path === '/settings') return { items: rows };
    if (path === '/languages') return { items: [{ code: 'ar', name: 'العربية', direction: 'rtl', customer_enabled: 1, tts_lang: 'ar-SA' }, { code: 'en', name: 'English', direction: 'ltr', customer_enabled: 1, tts_lang: null }] };
    if (path === '/chimes') return { items: [{ id: 'c1', code: 'classic', name: 'Classic', active: true, builtin: true, durationMs: 900, url: null }] };
    throw new Error(`unexpected GET ${path}`);
  });
  api.put.mockResolvedValue({});
});
afterEach(cleanup);

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FreshMfaProvider>
        <SettingsPage />
      </FreshMfaProvider>
    </QueryClientProvider>,
  );

it('groups settings, leaves the website settings out and puts unknown ones under Other', () => {
  const groups = groupSettings([...rows, { key: 'new.flag', value: true, updatedAt: null }]);
  expect(groups.map((g) => g.id)).toEqual(['newTenants', 'billing', 'maintenance', 'delivery', 'data', 'security', 'other']);
  expect(groups.flatMap((g) => g.rows.map((r) => r.key)).some((k) => k.startsWith('site.'))).toBe(false);
});

it('checks numbers, times and languages before saving', () => {
  expect(checkSetting('trial.days', 120)).toEqual([{ path: 'trial.days', message: 'settingsForm.invalid.range', values: { min: 1, max: 90 } }]);
  expect(checkSetting('trial.days', 30)).toEqual([]);
  const d = PLATFORM_SETTING_DEFAULTS['tenant.defaults'];
  expect(checkSetting('tenant.defaults', { ...d, resetTime: '25:00', locales: [] }).map((p) => p.path)).toEqual(['tenant.defaults.locales', 'tenant.defaults.resetTime']);
});

it('shows forms instead of JSON and saves only the changed setting', async () => {
  renderPage();
  const trial = (await screen.findByLabelText('Trial length')) as HTMLInputElement;
  expect(trial.value).toBe('14');
  expect(document.body.textContent).not.toContain('{"');
  expect(screen.getByRole('switch', { name: 'Maintenance mode is on' })).toBeTruthy();
  expect(screen.getByLabelText('Allowed networks')).toBeTruthy();
  fireEvent.change(trial, { target: { value: '30' } });
  const section = screen.getByRole('region', { name: 'New restaurants' });
  expect(within(section).getByText('1 unsaved change')).toBeTruthy();
  await act(async () => {
    fireEvent.click(within(section).getByRole('button', { name: 'Save changes' }));
  });
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put).toHaveBeenCalledWith('/settings/trial.days', { value: 30 });
}, 20_000); // renders every settings section; slow when the full suite runs in parallel

it('blocks an out-of-range value with a message on the field', async () => {
  renderPage();
  const trial = (await screen.findByLabelText('Trial length')) as HTMLInputElement;
  fireEvent.change(trial, { target: { value: '500' } });
  const section = screen.getByRole('region', { name: 'New restaurants' });
  await act(async () => {
    fireEvent.click(within(section).getByRole('button', { name: 'Save changes' }));
  });
  expect(within(section).getByText('Enter a whole number from 1 to 90.')).toBeTruthy();
  expect(api.put).not.toHaveBeenCalled();
}, 20_000);
