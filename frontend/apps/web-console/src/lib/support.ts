// Support access helpers (FR-SUP-02 – FR-SUP-06).

export interface SupportSession {
  id: string;
  status: 'requested' | 'active' | 'refused' | 'ended' | 'expired' | 'cancelled';
  kind: 'normal' | 'emergency' | string;
  reason: string;
  agentName: string;
  requestedAt: string;
  expiresAt: string | null;
  endedAt: string | null;
}

export const SUPPORT_MIN_MINUTES = 15;
export const SUPPORT_MAX_MINUTES = 480;
export const SUPPORT_DEFAULT_MINUTES = 120;

/** The list returns the agent's name only; the server re-checks ownership on verify/enter/end. */
export const isMine = (s: SupportSession, myName: string | undefined) => Boolean(myName) && s.agentName === myName;

/** An active session past its expiry is shown as expired until the minute job catches up. */
export const isLive = (s: SupportSession, now = Date.now()) => s.status === 'active' && (!s.expiresAt || new Date(s.expiresAt).getTime() > now);

/** Digits only, max 8 (support codes are read out by phone; spaces are tolerated). */
export const cleanCode = (s: string) => s.replace(/\D/g, '').slice(0, 8);
