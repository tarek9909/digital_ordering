// Display announcements (TR-ALR-15 – TR-ALR-17). Pure helpers plus an `Announcer` queue whose side effects
// (chime, speech, clock) are injected so the merging rules can be unit-tested.

export interface QuietRange {
  from: string;
  to: string;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** True when `minuteOfDay` (0–1439) falls in any range; ranges may wrap past midnight (22:00 → 07:00). */
export function isQuietAt(minuteOfDay: number, ranges: readonly QuietRange[]): boolean {
  return ranges.some(({ from, to }) => {
    const f = toMinutes(from);
    const t = toMinutes(to);
    if (f === t) return false;
    return f < t ? minuteOfDay >= f && minuteOfDay < t : minuteOfDay >= f || minuteOfDay < t;
  });
}

/** Minute of the day in a time zone (the venue's), falling back to the device zone. */
export function minuteOfDayIn(date: Date, timeZone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return (h % 24) * 60 + m;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

/** Prefixes are spelled letter by letter and kept apart from the digits: "A27" → "A 27", "AB-5" → "A B 5". */
export function spokenNumber(displayNumber: string): string {
  const letters = displayNumber.replace(/[^A-Za-z]/g, '').toUpperCase().split('');
  const digits = displayNumber.replace(/\D/g, '');
  return [...letters, digits].filter(Boolean).join(' ');
}

/** Splits numbers into announcements of at most `max` numbers, dropping duplicates. */
export function chunk(numbers: readonly string[], max = 5): string[][] {
  const unique = [...new Set(numbers)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += max) out.push(unique.slice(i, i + max));
  return out;
}

export interface AnnouncerDeps {
  /** Plays the 2-second chime; resolves when finished. */
  chime(): Promise<void>;
  /** Speaks `text`; resolves when finished. */
  speak(text: string, lang: string): Promise<void>;
  hasVoice(lang: string): boolean;
  /** Announcement sentence for these numbers in `lang`. */
  text(numbers: string[], lang: string): string;
  /** Current settings, read at play time so changes apply immediately. */
  settings(): { enabled: boolean; languages: string[]; quiet: boolean; soundOn: boolean };
  onMissingVoice?(lang: string): void;
  /** Revalidates a queued ticket right before it is played: false when it is no longer Ready (Undo, Collected). */
  isCurrent?(id: string): boolean;
  setTimeout(fn: () => void, ms: number): unknown;
}

/** A queued announcement entry: the number to speak and, when known, the ticket it belongs to. */
interface Item {
  number: string;
  id?: string;
}

/**
 * Queue: events arriving within `windowMs` of the first one are merged; at most `max` numbers per announcement;
 * announcements never overlap; quiet hours suppress speech but not the chime (TR-ALR-16). Entries carry the ticket
 * id, so a ticket that leaves Ready before it is spoken is dropped (`cancel`, and `isCurrent` at play time).
 */
export class Announcer {
  private pending: Item[] = [];
  private timer: unknown = null;
  private queue: Item[][] = [];
  private busy = false;
  /** Every announcement played, for tests and diagnostics. */
  readonly log: Array<{ numbers: string[]; spoken: string[] }> = [];

  constructor(
    private readonly d: AnnouncerDeps,
    private readonly windowMs = 3_000,
    private readonly max = 5,
  ) {}

  add(displayNumber: string, id?: string) {
    const same = this.pending.find((p) => p.number === displayNumber);
    if (same) same.id = id ?? same.id;
    else this.pending.push({ number: displayNumber, id });
    if (this.timer === null) this.timer = this.d.setTimeout(() => this.flush(), this.windowMs);
  }

  /** Drops a ticket that is not waiting or not yet spoken (it left Ready). */
  cancel(id: string) {
    this.pending = this.pending.filter((p) => p.id !== id);
    this.queue = this.queue.map((g) => g.filter((p) => p.id !== id)).filter((g) => g.length > 0);
  }

  flush() {
    this.timer = null;
    for (let i = 0; i < this.pending.length; i += this.max) this.queue.push(this.pending.slice(i, i + this.max));
    this.pending = [];
    return this.run();
  }

  get idle() {
    return !this.busy && this.queue.length === 0 && this.pending.length === 0;
  }

  private async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) await this.play(next);
    } finally {
      this.busy = false;
    }
  }

  private async play(items: Item[]) {
    const live = items.filter((p) => p.id === undefined || (this.d.isCurrent?.(p.id) ?? true));
    if (live.length === 0) return;
    const numbers = live.map((p) => p.number);
    const s = this.d.settings();
    const spoken: string[] = [];
    if (s.soundOn && s.enabled) {
      await this.d.chime().catch(() => undefined);
      if (!s.quiet) {
        for (const lang of s.languages) {
          if (!this.d.hasVoice(lang)) {
            this.d.onMissingVoice?.(lang);
            continue;
          }
          const text = this.d.text(numbers.map(spokenNumber), lang);
          spoken.push(text);
          await this.d.speak(text, lang).catch(() => undefined);
        }
      }
    }
    this.log.push({ numbers, spoken });
  }
}
