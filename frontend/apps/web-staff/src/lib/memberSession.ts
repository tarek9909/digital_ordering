import { ApiError } from '@dop/client-sdk';

// Named staff (FR-ACC-07, TR-AUTH-12). Pure rules for the personal-PIN token: it is kept in memory only, lasts
// 2 idle minutes (the server slides the same window on each use) and identifies the person on every write.

export const MEMBER_IDLE_MS = 2 * 60_000;
export const PIN_REQUIRED_DETAIL = 'Enter your personal PIN';
export const MEMBER_HEADER = 'X-Staff-Member';

export interface MemberSession {
  token: string;
  name: string;
  lastUsedAt: number;
}

/** The session if it was used within the idle window, else null. */
export function activeMember(s: MemberSession | null, nowMs: number, idleMs = MEMBER_IDLE_MS): MemberSession | null {
  return s && nowMs - s.lastUsedAt < idleMs ? s : null;
}

/** Marks a use; an expired session stays expired. */
export function touchMember(s: MemberSession | null, nowMs: number, idleMs = MEMBER_IDLE_MS): MemberSession | null {
  const a = activeMember(s, nowMs, idleMs);
  return a ? { ...a, lastUsedAt: nowMs } : null;
}

/** Milliseconds until the session expires (0 when it already has). */
export function msUntilIdle(s: MemberSession | null, nowMs: number, idleMs = MEMBER_IDLE_MS): number {
  return s ? Math.max(0, s.lastUsedAt + idleMs - nowMs) : 0;
}

/** The server refused a write because no valid personal PIN token came with it. */
export function isPinRequired(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'FORBIDDEN' && (e.problem?.detail ?? e.message) === PIN_REQUIRED_DETAIL;
}

/** Header to add to a write, if a person is signed in. */
export function memberHeaders(s: MemberSession | null, nowMs: number): Record<string, string> | undefined {
  const a = activeMember(s, nowMs);
  return a ? { [MEMBER_HEADER]: a.token } : undefined;
}

/** What to do before a write: go ahead, or ask for the PIN first because named staff are known to be in use. */
export function beforeWrite(namedStaff: boolean, s: MemberSession | null, nowMs: number): 'send' | 'ask' {
  return namedStaff && !activeMember(s, nowMs) ? 'ask' : 'send';
}
