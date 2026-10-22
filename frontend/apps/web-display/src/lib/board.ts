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
