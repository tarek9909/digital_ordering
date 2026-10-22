import type { DisplayTicket } from '@dop/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer, chunk, isQuietAt, spokenNumber, type AnnouncerDeps } from './announce';
import { applyDisplayTicket, burnInShift, displayLanguage, msUntilNextHour, readyView } from './board';

function setup(over: Partial<ReturnType<AnnouncerDeps['settings']>> = {}, voices = ['ar', 'en']) {
  const calls: string[] = [];
  const missing: string[] = [];
  const deps: AnnouncerDeps = {
    chime: async () => void calls.push('chime'),
    speak: async (text, lang) => void calls.push(`${lang}:${text}`),
    hasVoice: (l) => voices.includes(l),
    text: (n, lang) => (n.length === 1 ? `${lang} order ${n[0]}` : `${lang} orders ${n.join(', ')}`),
    settings: () => ({ enabled: true, languages: ['en'], quiet: false, soundOn: true, ...over }),
    onMissingVoice: (l) => void missing.push(l),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
  return { a: new Announcer(deps), calls, missing };
}

describe('Announcer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('merges events that arrive within 3 seconds into one announcement', async () => {
    const { a, calls } = setup();
    a.add('12');
    await vi.advanceTimersByTimeAsync(1_500);
    a.add('15');
    await vi.advanceTimersByTimeAsync(1_600);
    expect(calls).toEqual(['chime', 'en:en orders 12, 15']);
  });

  it('caps announcements at 5 numbers and never overlaps', async () => {
    const { a } = setup();
    ['1', '2', '3', '4', '5', '6', '7'].forEach((n) => a.add(n));
    await vi.advanceTimersByTimeAsync(3_100);
    expect(a.log.map((l) => l.numbers)).toEqual([
      ['1', '2', '3', '4', '5'],
      ['6', '7'],
    ]);
  });

  it('spells prefixes and speaks each language in turn', async () => {
    const { a, calls } = setup({ languages: ['ar', 'en'] });
    a.add('A27');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual(['chime', 'ar:ar order A 27', 'en:en order A 27']);
  });

  it('plays only the chime during quiet hours', async () => {
    const { a, calls } = setup({ quiet: true });
    a.add('9');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual(['chime']);
  });

  it('plays the chime only and reports a missing voice', async () => {
    const { a, calls, missing } = setup({ languages: ['ar'] }, ['en']);
    a.add('9');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual(['chime']);
    expect(missing).toEqual(['ar']);
  });

  it('stays silent until sound is enabled', async () => {
    const { a, calls } = setup({ soundOn: false });
    a.add('9');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual([]);
  });
});

describe('announcement helpers', () => {
  it('handles quiet hours that wrap past midnight', () => {
    const ranges = [{ from: '22:00', to: '07:00' }];
    expect(isQuietAt(23 * 60, ranges)).toBe(true);
    expect(isQuietAt(6 * 60 + 59, ranges)).toBe(true);
    expect(isQuietAt(7 * 60, ranges)).toBe(false);
    expect(isQuietAt(12 * 60, [{ from: '12:00', to: '13:00' }])).toBe(true);
  });

  it('spells prefixes and dedupes chunks', () => {
    expect(spokenNumber('A27')).toBe('A 27');
    expect(spokenNumber('42')).toBe('42');
    expect(chunk(['1', '1', '2'], 5)).toEqual([['1', '2']]);
  });
});

const dt = (id: string, status: DisplayTicket['status'], readyAt: string | null = null, counterId: string | null = null): DisplayTicket => ({
  id,
  displayNumber: id,
  status,
  version: 1,
  seq: 1,
  counterId,
  readyAt,
});

describe('display board', () => {
  it('moves tickets between columns and removes collected ones', () => {
    const b0 = { ready: [] as DisplayTicket[], preparing: [dt('1', 'preparing')], counterIds: null };
    const b1 = applyDisplayTicket(b0, dt('1', 'ready', '2026-10-22T10:00:00Z'));
    expect(b1.ready.map((t) => t.id)).toEqual(['1']);
    expect(b1.preparing).toEqual([]);
    expect(applyDisplayTicket(b1, dt('1', 'collected')).ready).toEqual([]);
  });

  it('applies the counter filter', () => {
    const b = { ready: [] as DisplayTicket[], preparing: [] as DisplayTicket[], counterIds: ['c1'] };
    expect(applyDisplayTicket(b, dt('1', 'ready', null, 'c2')).ready).toEqual([]);
    expect(applyDisplayTicket(b, dt('1', 'ready', null, 'c1')).ready).toHaveLength(1);
  });

  it('shows newest first, at most 24, with "+n more"', () => {
    const ready = Array.from({ length: 30 }, (_, i) => dt(String(i), 'ready', new Date(Date.UTC(2026, 9, 22, 10, i)).toISOString()));
    const v = readyView(ready);
    expect(v.shown).toHaveLength(24);
    expect(v.shown[0]?.id).toBe('29');
    expect(v.more).toBe(6);
  });

  it('computes the next 05:00 reload, burn-in range and UI language', () => {
    expect(msUntilNextHour(5, new Date(2026, 9, 22, 4, 0, 0))).toBe(3_600_000);
    expect(msUntilNextHour(5, new Date(2026, 9, 22, 5, 0, 0))).toBe(24 * 3_600_000);
    expect(burnInShift(() => 1)).toEqual({ x: 4, y: 4 });
    expect(burnInShift(() => 0)).toEqual({ x: -4, y: -4 });
    expect(displayLanguage(['en', 'ar'])).toBe('en');
    expect(displayLanguage([])).toBe('ar');
  });
});

// A27: a ticket that leaves Ready inside the merge window (or while earlier announcements play) is not spoken.
describe('Announcer cancellation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cancel() drops a pending ticket; the rest of the merged announcement still plays', async () => {
    const { a, calls } = setup();
    a.add('11', 't11');
    a.add('12', 't12');
    a.cancel('t11');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual(['chime', 'en:en order 12']);
  });

  it('cancelling the only pending ticket plays nothing at all (no chime)', async () => {
    const { a, calls } = setup();
    a.add('11', 't11');
    a.cancel('t11');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual([]);
    expect(a.idle).toBe(true);
  });

  it('revalidates queued groups at play time with isCurrent()', async () => {
    const current = new Set(['t1', 't2', 't3', 't4', 't5', 't6']);
    const calls: string[] = [];
    const a = new Announcer({
      // The chime takes 2 s, so the second group waits while the first plays.
      chime: () => (calls.push('chime'), new Promise<void>((r) => setTimeout(r, 2_000))),
      speak: async (text) => void calls.push(text),
      hasVoice: () => true,
      text: (n) => n.join(','),
      settings: () => ({ enabled: true, languages: ['en'], quiet: false, soundOn: true }),
      isCurrent: (id) => current.has(id),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    });
    ['1', '2', '3', '4', '5', '6'].forEach((n) => a.add(n, `t${n}`));
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual(['chime']);
    // First group (1–5) is playing; ticket 6 is undone before its turn.
    current.delete('t6');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual(['chime', '1,2,3,4,5']);
    expect(a.idle).toBe(true);
  });

  it('numbers without a ticket id are still announced', async () => {
    const { a, calls } = setup();
    a.add('7');
    a.cancel('anything');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toEqual(['chime', 'en:en order 7']);
  });
});
