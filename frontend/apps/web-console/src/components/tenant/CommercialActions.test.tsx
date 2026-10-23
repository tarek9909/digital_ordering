// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TenantDetail } from '../../lib/types';
import { FreshMfaProvider } from '../FreshMfa';
import { PlanForm } from './CommercialActions';

// W02 / FR-SA-10: the console can assign any non-archived catalogue plan, including Multi-site and custom plans.
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ api: { get, post } }));

const tenant = { id: 't1', plan: 'standard' } as unknown as TenantDetail['tenant'];

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  get.mockReset().mockResolvedValue({
    items: [
      { id: '1', code: 'standard', name: 'Standard', archived: false },
      { id: '2', code: 'multisite', name: 'Multi-site', archived: false },
      { id: '3', code: 'acme-custom', name: 'Acme custom', archived: false },
      { id: '4', code: 'legacy', name: 'Legacy', archived: true },
    ],
  });
  post.mockReset();
});
afterEach(cleanup);

const renderForm = (onDone = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {/* Plan changes ask for a fresh second factor when the server says so (L-6). */}
      <FreshMfaProvider>
        <PlanForm tenant={tenant} onCancel={() => {}} onDone={onDone} />
      </FreshMfaProvider>
    </QueryClientProvider>,
  );
  return onDone;
};
const select = () => screen.getByLabelText('Plan') as HTMLSelectElement;

it('offers the non-archived catalogue plans, custom ones by name, and posts the chosen code', async () => {
  post.mockResolvedValue({ effective: 'now' });
  const onDone = renderForm();
  await waitFor(() => expect([...select().options].map((o) => o.value)).toEqual(['standard', 'multisite', 'acme-custom']));
  expect(select().value).toBe('standard');
  expect(screen.getByRole('option', { name: 'Acme custom' })).toBeTruthy();
  fireEvent.change(select(), { target: { value: 'acme-custom' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
  });
  expect(post).toHaveBeenCalledWith('/tenants/t1/plan', { planCode: 'acme-custom' });
  expect(onDone).toHaveBeenCalledWith('now');
});

it('keeps the downgrade-blocked excess list', async () => {
  post.mockRejectedValue(
    new ApiError(409, 'PLAN_DOWNGRADE_BLOCKED', {
      type: 'x',
      title: 'x',
      status: 409,
      code: 'PLAN_DOWNGRADE_BLOCKED',
      data: { excess: [{ limit: 'maxVenues', current: 4, allowed: 1 }] },
    }),
  );
  renderForm();
  await waitFor(() => expect(select().options.length).toBe(3));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
  });
  await screen.findByText('Usage exceeds the target plan. Ask the tenant to remove these first:');
  expect(screen.getByText(/4 in use, 1 allowed/)).toBeTruthy();
});
