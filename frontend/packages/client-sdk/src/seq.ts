// Kept apart from socket.ts so importing it does not pull socket.io into a bundle.

/**
 * Sequence tracking (TR-RT-04): ignore events with seq ≤ known; when seq jumps by more than one, ask for a
 * snapshot refetch.
 */
export class SeqTracker {
  private readonly known = new Map<string, number>();
  set(key: string, seq: number) {
    this.known.set(key, seq);
  }
  /** 'apply' | 'stale' | 'gap' */
  check(key: string, seq: number): 'apply' | 'stale' | 'gap' {
    const k = this.known.get(key);
    if (k === undefined) return 'apply';
    if (seq <= k) return 'stale';
    if (seq > k + 1) return 'gap';
    return 'apply';
  }
  reset() {
    this.known.clear();
  }
}
