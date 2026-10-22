// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { RatingForm } from './RatingForm';

// A20: a failed rating save must not say "Thank you"; the draft stays for a retry.
const post = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ publicApi: { post } }));
const T = 'AAAAAAAAAAAAAAAAAAAAAA';

beforeAll(async () => {
  await initI18n('customer', { ar, en }, 'en');
});
beforeEach(() => post.mockReset());
afterEach(cleanup);

it('keeps the draft and shows an error when the save fails (HTTP 500)', async () => {
  post.mockRejectedValueOnce(new Error('HTTP 500'));
  render(<RatingForm token={T} />);
  fireEvent.click(screen.getByRole('radio', { name: '3 stars' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Slow' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('Your rating was not sent. Please try again.');
  expect(screen.queryByText('Thank you for your feedback!')).toBeNull();
  expect(screen.getByRole('radio', { name: '3 stars' }).getAttribute('aria-checked')).toBe('true');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Slow');
});

it('a retry after a network failure succeeds and shows the review link', async () => {
  post.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ reviewLinkUrl: 'https://example.com/review' });
  render(<RatingForm token={T} />);
  fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Your rating was not sent. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Thank you for your feedback!');
  expect(screen.getByRole('link', { name: 'Leave a review' }).getAttribute('href')).toBe('https://example.com/review');
  expect(post).toHaveBeenCalledTimes(2);
});
