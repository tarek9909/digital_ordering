import { session, type SessionStore } from './storage';

// Support-session mode (FR-SUP-04, TR-AUTH-12): a platform support agent arrives through /support-handoff, which
// sets an httpOnly support cookie. The app remembers the mode for this tab so it does not ask for a user session.

export const SUPPORT_FLAG = 'dop.admin.support';

export function isSupportMode(s: SessionStore | null = session()): boolean {
  try {
    return s?.getItem(SUPPORT_FLAG) === '1';
  } catch {
    return false;
  }
}

export function setSupportMode(on: boolean, s: SessionStore | null = session()) {
  try {
    if (on) s?.setItem(SUPPORT_FLAG, '1');
    else s?.removeItem(SUPPORT_FLAG);
  } catch {
    // storage unavailable
  }
}
