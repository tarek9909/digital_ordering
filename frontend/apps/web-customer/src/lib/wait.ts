// Wait estimate shown on the ticket page (FR-CUS-03). The server's `waitRemainingMinutes` is true when the
// projection is received; the page ages it from that moment so an idle page counts down and turns overdue.

export interface WaitView {
  late: boolean;
  minutes: number;
}

/** `anchorMs` is when the projection was received; `nowMs` the current time. */
export function agedWait(remainingMinutes: number | null, overdue: boolean, anchorMs: number, nowMs: number): WaitView | null {
  if (remainingMinutes === null) return null;
  if (overdue) return { late: true, minutes: 0 };
  const leftMs = anchorMs + remainingMinutes * 60_000 - nowMs;
  if (leftMs <= 0) return { late: true, minutes: 0 };
  return { late: false, minutes: Math.ceil(leftMs / 60_000) };
}
