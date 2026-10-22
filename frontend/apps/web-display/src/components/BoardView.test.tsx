// @vitest-environment jsdom
import * as React from 'react';
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/display.json';
import en from '@dop/i18n/locales/en/display.json';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { READY_PAGE_MS, type Board } from '../lib/board';
import { useDisplay } from '../lib/store';
import { BoardView } from './BoardView';

// CSD03 (component level; real geometry is checked in Chromium by tools/display-layout-check.mjs): with a grid
// that holds 6 tiles, 14 Ready tickets rotate through pages with a visible "Page x of y · +n more" indicator.
// CSD04: a stale board shows the reconnecting badge while it keeps the last list.
const T0 = Date.parse('2026-10-22T12:00:00Z');
const ready = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(2, '0')}`, displayNumber: String(100 + i), status: 'ready' as const, version: 1, seq: 1, counterId: null, readyAt: new Date(T0 - (i + 1) * 60_000).toISOString() }));
const board = (n: number): Board =>
  ({
    ready: ready(n),
    preparing: [],
    counterIds: null,
    csrfToken: 'c',
    displayName: 'TV',
    tenantStatus: 'active',
    serverTime: new Date(T0).toISOString(),
    voices: {},
    venueUrl: 'http://t.example/v/A',
    venue: { name: 'V', logoUrl: null, brandColor: '#1F6FEB', timeZone: 'UTC' },
    settings: { showPreparing: false, announce: { enabled: true, languages: ['en'], quietHours: [] }, qr: { show: false }, message: {}, promo: null },
  }) as unknown as Board;

let restore: Array<() => void> = [];
function stubLayout() {
  // A list 2 tiles high (2 × 100 px + 10 px gap) and 3 columns wide → 6 tiles.
  const realGcs = window.getComputedStyle;
  const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, p?: string | null) =>
    el.tagName === 'UL' ? ({ gridTemplateColumns: '300px 300px 300px', rowGap: '10px' } as CSSStyleDeclaration) : realGcs(el, p),
  );
  const oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const ch = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.tagName === 'LI' ? 100 : 0; } });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get() { return this.tagName === 'UL' ? 215 : 0; } });
  restore = [
    () => gcs.mockRestore(),
    () => (oh ? Object.defineProperty(HTMLElement.prototype, 'offsetHeight', oh) : undefined),
    () => (ch ? Object.defineProperty(Element.prototype, 'clientHeight', ch) : undefined),
  ];
}

beforeEach(async () => {
  await initI18n('display', { ar, en }, 'en');
  useDisplay.setState({ connected: true, resyncing: false, stale: false, soundEnabled: true, missingVoices: [], highlightId: null });
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  restore.forEach((f) => f());
  restore = [];
  vi.useRealTimers();
});

const numbers = () => screen.getAllByRole('listitem').map((li) => li.textContent);

it('CSD03: shows only whole tiles, indicates the overflow and rotates until every number was shown', async () => {
  stubLayout();
  render(<BoardView board={board(14)} />);
  expect(numbers()).toEqual(['100', '101', '102', '103', '104', '105']);
  expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  expect(screen.getByText('+8 more')).toBeTruthy();
  // The column heading still counts every Ready ticket.
  expect(screen.getByText('14')).toBeTruthy();
  const seen = new Set(numbers());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(READY_PAGE_MS);
  });
  expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  numbers().forEach((n) => seen.add(n));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(READY_PAGE_MS);
  });
  expect(screen.getByText('Page 3 of 3')).toBeTruthy();
  expect(screen.getByText('+12 more')).toBeTruthy();
  numbers().forEach((n) => seen.add(n));
  expect(seen.size).toBe(14);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(READY_PAGE_MS);
  });
  expect(screen.getByText('Page 1 of 3')).toBeTruthy();
});

it('CSD03: no indicator when everything fits', () => {
  stubLayout();
  render(<BoardView board={board(5)} />);
  expect(numbers()).toHaveLength(5);
  expect(screen.queryByTestId('ready-overflow')).toBeNull();
});

it('CSD04: a stale board keeps its list and shows the reconnecting badge although the socket is up', () => {
  useDisplay.setState({ connected: true, resyncing: false, stale: true });
  render(<BoardView board={board(3)} />);
  expect(screen.getAllByRole('status').some((s) => /Reconnecting/.test(s.textContent ?? ''))).toBe(true);
  expect(numbers()).toHaveLength(3);
});
