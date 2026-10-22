// Report histograms (TR-RPT-07): 15 s buckets up to 10 min, 1 min buckets up to 2 h, then one overflow bucket.
// Percentiles over any range are computed from merged histograms, so medians stay correct after tickets are deleted.

export const HIST_BOUNDS: number[] = (() => {
  const b: number[] = [];
  for (let s = 15; s <= 600; s += 15) b.push(s);
  for (let s = 660; s <= 7200; s += 60) b.push(s);
  return b; // upper bounds (exclusive) of each bucket; index b.length = overflow
})();

export type Histogram = number[];
export const emptyHistogram = (): Histogram => new Array(HIST_BOUNDS.length + 1).fill(0);

export function bucketOf(seconds: number): number {
  const s = Math.max(0, seconds);
  for (let i = 0; i < HIST_BOUNDS.length; i++) if (s < HIST_BOUNDS[i]!) return i;
  return HIST_BOUNDS.length;
}

export function addToHistogram(h: Histogram, seconds: number): Histogram {
  h[bucketOf(seconds)]! += 1;
  return h;
}

export function mergeHistograms(hs: Histogram[]): Histogram {
  const out = emptyHistogram();
  for (const h of hs) for (let i = 0; i < out.length; i++) out[i]! += h[i] ?? 0;
  return out;
}

/** Nearest-rank percentile from a histogram; returns the bucket's upper bound in seconds (error ≤ one bucket). */
export function histogramPercentile(h: Histogram, p: number): number | null {
  const total = h.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * total));
  let seen = 0;
  for (let i = 0; i < h.length; i++) {
    seen += h[i]!;
    if (seen >= rank) return i < HIST_BOUNDS.length ? HIST_BOUNDS[i]! : HIST_BOUNDS[HIST_BOUNDS.length - 1]!;
  }
  return null;
}

/** Nearest-rank percentile from raw samples (used for live "Today" figures). */
export function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** Preparation time is measured from ticket creation when preparing_at is empty (TR-RPT-05, §20.1). */
export function prepSeconds(createdAt: Date, preparingAt: Date | null, firstReadyAt: Date | null): number | null {
  if (!firstReadyAt) return null;
  return Math.max(0, (firstReadyAt.getTime() - (preparingAt ?? createdAt).getTime()) / 1000);
}
