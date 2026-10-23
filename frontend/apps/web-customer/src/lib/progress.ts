import type { WaitView } from './wait';

// How far the call ring has closed (0–1). The server sends only the remaining wait, so the largest wait this page
// has seen for a ticket stands for its whole wait. Received fills the first third, preparing runs on toward
// "almost ready" (never fully closed: only Ready closes the ring).

const RECEIVED = [0.08, 0.34] as const;
const PREPARING = [0.4, 0.92] as const;
const longest = new Map<string, number>();

export function ringProgress(token: string, status: string, wait: WaitView | null): number {
  if (status === 'ready' || status === 'collected') return 1;
  if (status !== 'received' && status !== 'preparing') return 0;
  const [lo, hi] = status === 'received' ? RECEIVED : PREPARING;
  if (!wait) return status === 'received' ? 0.14 : 0.55;
  if (wait.late) return hi;
  const total = Math.max(longest.get(token) ?? 0, wait.minutes);
  longest.set(token, total);
  const elapsed = total > 0 ? 1 - wait.minutes / total : 0;
  return lo + (hi - lo) * elapsed;
}
