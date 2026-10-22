// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/site.json';
import en from '@dop/i18n/locales/en/site.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppButton } from './Closing';
import { Hero } from './Hero';
import { BrandPreview } from './Product';
import { Steps } from './Story';

// Landing page behaviour: the live demo, "Make it yours" handing the name to the contact page, the steps, and the contact
// set by super admins in the console.

const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ publicApi: { get } }));

beforeAll(async () => {
  await initI18n('site', { ar, en }, 'en');
});
beforeEach(() => get.mockReset());
afterEach(cleanup);

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderAt(ui: React.ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/contact" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('hero live demo', () => {
  it('rings the phone and lights the number on the TV when staff tap Ready', () => {
    renderAt(<Hero />);
    expect(screen.getByText('About 5 min')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Ready$/ }));
    expect(screen.getByText('Your order is ready. Come to the counter.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Next order/ }).getAttribute('aria-pressed')).toBe('true');
    // The next order starts again from Preparing with the following number.
    fireEvent.click(screen.getByRole('button', { name: /Next order/ }));
    expect(screen.getAllByText('64').length).toBeGreaterThan(0);
    expect(screen.getByText('About 5 min')).toBeTruthy();
  });
});

describe('make it yours', () => {
  it('shows the typed name and hands it to the contact page', () => {
    renderAt(<BrandPreview />);
    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Abu Ali Grill' } });
    expect(screen.getByText('Abu Ali Grill')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask us to set it up' }));
    expect(screen.getByTestId('where').textContent).toBe('/contact?name=Abu%20Ali%20Grill');
  });

  it('previews the customer page in the chosen language', () => {
    renderAt(<BrandPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    expect(screen.getByText('رقم طلبك')).toBeTruthy();
  });
});

describe('how it works', () => {
  it('lets a step be chosen without scrolling', () => {
    const onSelect = vi.fn();
    renderAt(<Steps active={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Staff tap Ready/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});

describe('WhatsApp button', () => {
  it('appears with the number set in the console', async () => {
    get.mockResolvedValue({ contact: { email: 'hello@x.test', whatsapp: '+966500000000', whatsappUrl: 'https://wa.me/966500000000' } });
    renderAt(<WhatsAppButton />);
    const link = await screen.findByRole('link', { name: 'Message us on WhatsApp' });
    expect(link.getAttribute('href')).toBe('https://wa.me/966500000000');
    expect(get).toHaveBeenCalledWith('/site');
  });

  it('stays hidden when no number is set', async () => {
    get.mockResolvedValue({ contact: { email: 'hello@x.test', whatsapp: null, whatsappUrl: null } });
    renderAt(<WhatsAppButton />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole('link')).toBeNull();
  });
});
