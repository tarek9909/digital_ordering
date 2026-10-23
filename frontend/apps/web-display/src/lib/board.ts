import type { DisplayBoard, DisplayTicket } from '@dop/contracts';

// Pure display-board logic (FR-DSP-02, FR-DSP-09).

export type Board = DisplayBoard & { csrfToken: string; displayName: string };

export const MAX_READY = 24;

const readyTime = (t: DisplayTicket) => (t.readyAt ? Date.parse(t.readyAt) : 0);

/** Counter filter applied client-side (TRD §10.2). */
export const matchesCounters = (counterIds: string[] | null, t: DisplayTicket) => !counterIds?.length || (t.counterId !== null && counterIds.includes(t.counterId));

/** Moves a ticket between columns, or removes it when collected, cancelled or expired. */
export function applyDisplayTicket<B extends Pick<DisplayBoard, 'ready' | 'preparing' | 'counterIds'>>(b: B, t: DisplayTicket): B {
  const ready = b.ready.filter((x) => x.id !== t.id);
  const preparing = b.preparing.filter((x) => x.id !== t.id);
  if (matchesCounters(b.counterIds, t)) {
    if (t.status === 'ready') ready.push(t);
    else if (t.status === 'preparing' || t.status === 'received') preparing.push(t);
  }
  return { ...b, ready, preparing };
}

/** Newest first, at most `max` shown; the oldest are dropped behind "+n more". */
export function readyView(ready: readonly DisplayTicket[], max = MAX_READY): { shown: DisplayTicket[]; more: number } {
  const sorted = [...ready].sort((a, b) => readyTime(b) - readyTime(a));
  return { shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

// ---- Ready capacity and paging (CSD03, FR-DSP-02/03/07). Every tile on screen must fit; when the Ready list is
// longer than the grid holds, it is shown in pages that rotate on a fixed interval with a "page x of y · +n more"
// indicator. Pages keep the board's newest-first order, and each page starts at the ticket after the last one
// shown, by ready time rather than by index: a ticket arriving mid-rotation sorts before the cursor (it waits for the
// next rotation) and a collected ticket never shifts the others, so every ticket that is Ready when a rotation
// starts — the oldest included — is on screen within that rotation, however busy the venue is. The ticket that just
// became ready (highlighted and announced) is pinned first on every page while it is highlighted.

/** Ready tile font size and minimum width, in vmin (BoardView). vmin equals vh in landscape. */
export const TILE_FONT_VMIN = 13;
export const TILE_MIN_VMIN = 28;

/**
 * Minimum tile width (vmin) so the longest display number fits inside its tile at `fontVmin` (CSD03). Digits are
 * 0.70em wide in the display font (tabular), letters (counter prefixes) up to about 1.1em; 3-digit numbers keep the
 * standard 28vmin tile.
 */
export function tileMinVmin(numbers: Iterable<string>, fontVmin = TILE_FONT_VMIN): number {
  let widest = 0;
  for (const n of numbers) {
    let em = 0;
    for (const ch of n) em += /[0-9]/.test(ch) ? 0.7 : 1.15;
    widest = Math.max(widest, em);
  }
  const needed = widest * fontVmin;
  return needed <= TILE_MIN_VMIN ? TILE_MIN_VMIN : Math.ceil(needed + 1.5);
}

/** Seconds each page stays on screen. */
export const READY_PAGE_MS = 8_000;

/** Measured Ready grid (px) as laid out by the browser. */
export interface GridMetrics {
  /** Inner height available to the tiles. */
  height: number;
  /** Resolved grid columns. */
  columns: number;
  rowGap: number;
  /** Layout height of one tile (without transforms). */
  tileHeight: number;
}

/** Tiles that fit completely in the grid; 0 when the grid has not been measured (e.g. no layout yet). */
export function gridCapacity(m: GridMetrics): number {
  if (!(m.height > 0) || !(m.tileHeight > 0) || !(m.columns >= 1)) return 0;
  // Half a pixel of tolerance for sub-pixel rounding of vh-based sizes.
  const rows = Math.floor((m.height + m.rowGap + 0.5) / (m.tileHeight + m.rowGap));
  return Math.max(1, rows) * Math.floor(m.columns);
}

/** Position of a ticket in the Ready order (ready time, then id). */
export interface ReadyKey {
  at: number;
  id: string;
}
const keyOf = (t: DisplayTicket): ReadyKey => ({ at: readyTime(t), id: t.id });
const cmpKey = (a: ReadyKey, b: ReadyKey) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Newest first; ties by id so the order is total and stable. */
const newestFirst = (ready: readonly DisplayTicket[]) => [...ready].sort((a, b) => cmpKey(keyOf(b), keyOf(a)));

export interface ReadyPage {
  /** Tiles to render, in order. */
  shown: DisplayTicket[];
  /** 1-based page and page count; `pages` is 1 when everything fits. */
  page: number;
  pages: number;
  /** Ready tickets not on screen right now. */
  hidden: number;
  /** Where the next page starts; null means back to the first page. */
  next: ReadyKey | null;
}

/**
 * The Ready tiles for the current page. `capacity` is from `gridCapacity` (0 = unknown: fall back to the
 * newest `MAX_READY`), `start` is the page start from the previous rotation (null = first page) and `pinnedId`
 * the highlighted ticket, kept first on every page.
 */
export function readyPage(ready: readonly DisplayTicket[], capacity: number, start: ReadyKey | null, pinnedId: string | null = null): ReadyPage {
  if (capacity <= 0) {
    const v = readyView(ready);
    return { shown: v.shown, page: 1, pages: 1, hidden: v.more, next: null };
  }
  const order = newestFirst(ready);
  if (order.length <= capacity) return { shown: order, page: 1, pages: 1, hidden: 0, next: null };
  const pinned = pinnedId ? order.find((t) => t.id === pinnedId) : undefined;
  const rest = pinned ? order.filter((t) => t !== pinned) : order;
  const slots = Math.max(1, capacity - (pinned ? 1 : 0));
  // First ticket not newer than the cursor: the page continues where the previous one stopped.
  let from = start ? rest.findIndex((t) => cmpKey(keyOf(t), start) <= 0) : 0;
  if (from < 0) from = 0;
  const window = rest.slice(from, from + slots);
  const shown = (pinned ? [pinned, ...window] : window).slice(0, capacity);
  const pages = Math.ceil(rest.length / slots);
  const page = Math.min(pages, Math.floor(from / slots) + 1);
  const after = rest[from + slots];
  return { shown, page, pages, hidden: ready.length - shown.length, next: after ? keyOf(after) : null };
}

/** The newest ready ticket, if it became ready less than `windowMs` ago. */
export function newestRecent(ready: readonly DisplayTicket[], nowMs: number, windowMs = 10_000): DisplayTicket | null {
  const newest = readyView(ready, 1).shown[0];
  return newest && nowMs - readyTime(newest) < windowMs ? newest : null;
}

export const isTenantBlocked = (s: string) => s === 'trial_expired' || s === 'cancelled' || s === 'deleted';

/** UI language: first announcement language we have strings for, else Arabic. */
export function displayLanguage(languages: readonly string[]): 'ar' | 'en' {
  const first = languages[0]?.split('-')[0];
  return first === 'en' ? 'en' : 'ar';
}

/** Milliseconds until the next local `hour`:00 (daily reload at 05:00, TR-FE-20). */
export function msUntilNextHour(hour: number, now: Date): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** Burn-in shift of up to ±`max` px on each axis (TR-FE-19). */
export const burnInShift = (rand: () => number, max = 4) => ({
  x: Math.round((rand() * 2 - 1) * max),
  y: Math.round((rand() * 2 - 1) * max),
});
