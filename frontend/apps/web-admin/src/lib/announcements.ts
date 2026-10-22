import type { Announcement, AnnouncementSeverity } from './types';

// Platform announcements (FR-SA-13, TR-FE-22): shown in the banner area, dismissible for this browser session.

export const DISMISSED_KEY = 'dop.admin.dismissedAnnouncements';

export const SEVERITY_TONE: Record<AnnouncementSeverity, 'info' | 'warn' | 'danger'> = { info: 'info', warning: 'warn', critical: 'danger' };

/** Message in the UI language, else English, else Arabic, else any. */
export function pickMessage(message: Record<string, string>, lang: string): string {
  return message[lang] ?? message.en ?? message.ar ?? Object.values(message)[0] ?? '';
}

interface SessionLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const session = (): SessionLike | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function readDismissed(s: SessionLike | null = session()): string[] {
  try {
    const v: unknown = JSON.parse(s?.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeDismissed(ids: readonly string[], s: SessionLike | null = session()) {
  try {
    s?.setItem(DISMISSED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // storage unavailable: dismissal lasts until reload
  }
}

/** Critical announcements cannot be dismissed. */
export const visibleAnnouncements = (items: readonly Announcement[], dismissed: readonly string[]) =>
  items.filter((a) => a.severity === 'critical' || !dismissed.includes(a.id));
