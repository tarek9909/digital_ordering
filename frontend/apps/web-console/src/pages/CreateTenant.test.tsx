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
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { CreateTenantPage, planChoices } from './CreateTenant';

// W04 / FR-SA-05: plan on create tenant; a console tenant is active at once, with no trial.
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ api: { get, post } }));

const plans = [
  { id: '1', code: 'trial', name: 'Trial', archived: false },
  { id: '2', code: 'standard', name: 'Standard', archived: false },
  { id: '3', code: 'pro', name: 'Pro', archived: false },
  { id: '4', code: 'old-plan', name: 'Old', archived: true },
  { id: '5', code: 'acme-custom', name: 'Acme custom', archived: false },
];

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) =>
    Promise.resolve(path === '/plans' ? { items: plans } : { items: [{ key: 'trial.days', value: 14, updatedAt: null }] }),
  );
});
afterEach(cleanup);

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tenants/new']}>
        <Routes>
          <Route path="/tenants/new" element={<CreateTenantPage />} />
          <Route path="/tenants/:id" element={<p>tenant page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const fill = (label: string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });
const planSelect = () => screen.getByLabelText('Plan') as HTMLSelectElement;
const optionValues = () => [...planSelect().options].map((o) => o.value);

function fillRequired() {
  fill('Restaurant name', 'Burger House');
  fill('Address (slug)', 'burger-house');
  fill('Owner email (an invitation is sent)', 'owner@example.com');
}

it('planChoices drops archived plans and never offers Trial', () => {
  expect(planChoices(plans, false).map((p) => p.code)).toEqual(['standard', 'pro', 'acme-custom']);
  expect(planChoices(plans, true).map((p) => p.code)).toEqual(['standard', 'pro', 'acme-custom']);
});

it('defaults to Standard, has no trial field and creates the tenant without trial days', async () => {
  post.mockResolvedValue({ tenantId: 't1' });
  renderPage();
  await waitFor(() => expect(optionValues()).toContain('acme-custom'));
  expect(planSelect().value).toBe('standard');
  expect(optionValues()).not.toContain('trial');
  expect(optionValues()).not.toContain('old-plan');
  expect(screen.queryByLabelText('Trial length (days)')).toBeNull();
  fillRequired();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create and invite owner' }));
  });
  await screen.findByText('tenant page');
  const body = post.mock.calls[0]![1] as Record<string, unknown>;
  expect(body).toMatchObject({ planCode: 'standard', complimentary: false, slug: 'burger-house' });
  expect(body.trialDays).toBeUndefined();
});

it('sends the chosen plan', async () => {
  post.mockResolvedValue({ tenantId: 't1' });
  renderPage();
  await waitFor(() => expect(optionValues()).toContain('pro'));
  fillRequired();
  fireEvent.change(planSelect(), { target: { value: 'pro' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create and invite owner' }));
  });
  await screen.findByText('tenant page');
  expect((post.mock.calls[0]![1] as Record<string, unknown>).planCode).toBe('pro');
});

it('complimentary keeps a paid plan', async () => {
  post.mockResolvedValue({ tenantId: 't1' });
  renderPage();
  await waitFor(() => expect(optionValues()).toContain('pro'));
  fireEvent.click(screen.getByLabelText('Complimentary'));
  await waitFor(() => expect(planSelect().value).toBe('standard'));
  fillRequired();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create and invite owner' }));
  });
  await screen.findByText('tenant page');
  expect(post.mock.calls[0]![1]).toMatchObject({ complimentary: true, planCode: 'standard' });
});

it('maps a server planCode error onto the plan field', async () => {
  post.mockRejectedValue(
    new ApiError(400, 'VALIDATION_FAILED', {
      type: 'x',
      title: 'x',
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'planCode', message: 'A complimentary tenant needs a paid plan' }],
    }),
  );
  renderPage();
  await waitFor(() => expect(optionValues()).toContain('pro'));
  fillRequired();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create and invite owner' }));
  });
  await screen.findByText('A complimentary tenant needs a paid plan, not Trial.');
  expect(planSelect().getAttribute('aria-invalid')).toBe('true');
});
