// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { CreateTenantPage } from './CreateTenant';

// W04 / FR-SA-05: a console tenant is created with the owner's credentials; one plan, no invitation.
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ api: { get, post } }));

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  get.mockReset();
  post.mockReset();
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

function fillRequired() {
  fill('Restaurant name', 'Burger House');
  fill('Address (slug)', 'burger-house');
  fill('Owner email', 'owner@example.com');
  fill('Owner password', 'Quiet-Harbor-5521-xq');
}

it('asks only for name, address, email and password, and creates the tenant with those', async () => {
  post.mockResolvedValue({ tenantId: 't1' });
  renderPage();
  await screen.findByLabelText('Restaurant name');
  for (const gone of ['Plan', 'Country', 'Default language', 'Complimentary', 'Trial length (days)']) expect(screen.queryByLabelText(gone)).toBeNull();
  fillRequired();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create restaurant' }));
  });
  await screen.findByText('tenant page');
  expect(post.mock.calls[0]![0]).toBe('/tenants');
  expect(post.mock.calls[0]![1]).toMatchObject({ name: 'Burger House', slug: 'burger-house', ownerEmail: 'owner@example.com', ownerPassword: 'Quiet-Harbor-5521-xq' });
});

it('does not submit without a password', async () => {
  renderPage();
  await screen.findByLabelText('Restaurant name');
  fill('Restaurant name', 'Burger House');
  fill('Owner email', 'owner@example.com');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create restaurant' }));
  });
  expect(post).not.toHaveBeenCalled();
});
