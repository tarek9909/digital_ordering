// Support-session mode (FR-SUP-04, TR-AUTH-12): a platform support agent arrives through /support-handoff, which
// sets an httpOnly support cookie. The app remembers the mode for this tab so it does not ask for a user session.

export const SUPPORT_FLAG = 'dop.admin.support';

interface FlagStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const session = (): FlagStorage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function isSupportMode(s: FlagStorage | null = session()): boolean {
  try {
    return s?.getItem(SUPPORT_FLAG) === '1';
  } catch {
    return false;
  }
}

export function setSupportMode(on: boolean, s: FlagStorage | null = session()) {
  try {
    if (on) s?.setItem(SUPPORT_FLAG, '1');
    else s?.removeItem(SUPPORT_FLAG);
  } catch {
    // storage unavailable
  }
}
