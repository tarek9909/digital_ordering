import type { DisplayTicket } from '@dop/contracts';
import { describe, expect, it } from 'vitest';
import { gridCapacity, readyPage, tileMinVmin, type ReadyKey } from './board';

// CSD03: capacity comes from the measured grid; longer Ready lists rotate through pages so every number is shown.
const T0 = Date.parse('2026-10-22T12:00:00Z');
const tk = (i: number, minutesAgo = i): DisplayTicket => ({ id: `t${String(i).padStart(3, '0')}`, displayNumber: String(100 + i), status: 'ready', version: 1, seq: 1, counterId: null, readyAt: new Date(T0 - minutesAgo * 60_000).toISOString() });
const list = (n: number) => Array.from({ length: n }, (_, i) => tk(i));

describe('gridCapacity', () => {
  it('counts only whole rows of tiles', () => {
    // 1920×1080 with Preparing: 582 px tall list, 3 columns, 166 px tiles, 19.44 px gaps → 3 rows.
    expect(gridCapacity({ height: 582, columns: 3, rowGap: 19.44, tileHeight: 166 })).toBe(9);
    expect(gridCapacity({ height: 360, columns: 5, rowGap: 19.44, tileHeight: 166 })).toBe(10);
    expect(gridCapacity({ height: 340, columns: 5, rowGap: 19.44, tileHeight: 166 })).toBe(5);
    // Portrait list: 1422 px, 2 columns.
    expect(gridCapacity({ height: 1422, columns: 2, rowGap: 19.44, tileHeight: 166 })).toBe(14);
  });
  it('is 0 (unknown) without a layout, and at least one row otherwise', () => {
    expect(gridCapacity({ height: 0, columns: 3, rowGap: 10, tileHeight: 166 })).toBe(0);
    expect(gridCapacity({ height: 500, columns: 0, rowGap: 10, tileHeight: 166 })).toBe(0);
    expect(gridCapacity({ height: 100, columns: 2, rowGap: 10, tileHeight: 166 })).toBe(2);
  });
});

describe('readyPage', () => {
  it('shows everything newest first, with no indicator, when it fits', () => {
    const p = readyPage(list(9), 9, null);
    expect(p).toMatchObject({ page: 1, pages: 1, hidden: 0, next: null });
    expect(p.shown.map((t) => t.displayNumber)).toEqual(['100', '101', '102', '103', '104', '105', '106', '107', '108']);
  });

  it('falls back to the newest 24 with "+n more" before the grid is measured', () => {
    const p = readyPage(list(30), 0, null);
    expect(p.shown).toHaveLength(24);
    expect(p.hidden).toBe(6);
  });

  it('pages a longer list and indicates what is hidden', () => {
    const p = readyPage(list(24), 9, null);
    expect(p.shown).toHaveLength(9);
    expect(p).toMatchObject({ page: 1, pages: 3, hidden: 15 });
    const p2 = readyPage(list(24), 9, p.next);
    expect(p2).toMatchObject({ page: 2, pages: 3, hidden: 15 });
    expect(p2.shown[0]!.displayNumber).toBe('109');
    const p3 = readyPage(list(24), 9, p2.next);
    expect(p3).toMatchObject({ page: 3, pages: 3 });
    expect(p3.shown.map((t) => t.displayNumber)).toEqual(['118', '119', '120', '121', '122', '123']);
    expect(p3.next).toBeNull();
  });

  it('pins the highlighted (just ready) ticket first on every page', () => {
    const first = readyPage(list(24), 9, null, 't000');
    const second = readyPage(list(24), 9, first.next, 't000');
    expect(first.shown[0]!.id).toBe('t000');
    expect(second.shown[0]!.id).toBe('t000');
    expect(second.shown).toHaveLength(9);
    expect(new Set([...first.shown, ...second.shown].map((t) => t.id)).size).toBe(17);
  });

  it('shows every ticket within one rotation while tickets keep arriving and leaving', () => {
    // A busy venue: each page interval one new ticket becomes ready and the oldest shown one is collected.
    let ready = list(40);
    const atStart = new Set(ready.map((t) => t.id));
    const seen = new Set<string>();
    let start: ReadyKey | null = null;
    let nextId = 40;
    for (let step = 0; step < 40 && [...atStart].some((id) => !seen.has(id) && ready.some((t) => t.id === id)); step++) {
      const p = readyPage(ready, 9, start);
      for (const t of p.shown) seen.add(t.id);
      start = p.next;
      if (start === null) break; // rotation complete
      ready = [tk(nextId, -(nextId - 39)), ...ready.filter((t) => t.id !== p.shown[0]!.id)];
      nextId++;
    }
    const stillReady = ready.filter((t) => atStart.has(t.id));
    expect(stillReady.every((t) => seen.has(t.id))).toBe(true);
  });

  it('wraps to the first page after the last one', () => {
    const last = readyPage(list(12), 9, readyPage(list(12), 9, null).next);
    expect(last.next).toBeNull();
    expect(readyPage(list(12), 9, last.next).page).toBe(1);
  });
});

describe('tileMinVmin', () => {
  it('keeps the standard tile for 3-digit numbers and widens it for longer ones', () => {
    expect(tileMinVmin(['100', '999'])).toBe(28);
    expect(tileMinVmin(['1000'])).toBeGreaterThan(28);
    expect(tileMinVmin(['B100'])).toBeGreaterThan(tileMinVmin(['1000']));
    expect(tileMinVmin([])).toBe(28);
  });
});
