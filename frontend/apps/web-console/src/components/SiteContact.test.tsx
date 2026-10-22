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
import { SiteContact } from './SiteContact';

// The website's public contact (email link, WhatsApp button) is set here by super admins.
const put = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: { put } }));

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => put.mockReset().mockResolvedValue(undefined));
afterEach(cleanup);

const renderForm = (onSaved = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FreshMfaProvider>
        <SiteContact value={{ email: 'support@tanbeeh.app', whatsapp: '' }} onSaved={onSaved} />
      </FreshMfaProvider>
    </QueryClientProvider>,
  );
  return onSaved;
};

it('saves the email and a WhatsApp number in international format', async () => {
  const onSaved = renderForm();
  fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '+966 50 000 0000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
  await waitFor(() => expect(put).toHaveBeenCalledWith('/settings/site.contact', { value: { email: 'support@tanbeeh.app', whatsapp: '+966500000000' } }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('refuses a local-format number and a bad email before sending', () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '0500000000' } });
  fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'not-an-email' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
  expect(screen.getByText('Use the international format, e.g. +966500000000.')).toBeTruthy();
  expect(screen.getByText('Enter a valid email or leave it empty.')).toBeTruthy();
  expect(put).not.toHaveBeenCalled();
});
