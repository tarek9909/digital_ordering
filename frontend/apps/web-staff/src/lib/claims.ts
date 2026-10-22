import type { StaffBoard } from '@dop/contracts';

// Staff-approved claims (FR-STF-15). Pending claims come in the board snapshot and through `claim.requested`;
// they leave on `claim.decided`, after a decision on this device, or 5 minutes after they were made.

export type PendingClaim = StaffBoard['pendingClaims'][number];
/** Live events carry no ticket id. */
export type ClaimItem = Omit<PendingClaim, 'ticketId'> & { ticketId?: string };

export const CLAIM_TTL_MS = 5 * 60_000;

export type ClaimAction =
  | { type: 'requested'; claim: ClaimItem }
  | { type: 'decided'; claimId: string }
  | { type: 'expire'; nowMs: number };

const createdMs = (c: ClaimItem) => Date.parse(c.createdAt);

export function claimsReducer(state: readonly ClaimItem[], a: ClaimAction): ClaimItem[] {
  switch (a.type) {
    case 'requested': {
      const others = state.filter((c) => c.claimId !== a.claim.claimId);
      const prev = state.find((c) => c.claimId === a.claim.claimId);
      // Keep the ticket id from the snapshot if the event repeats a claim we already know.
      const merged: ClaimItem = { ...a.claim, ...(prev?.ticketId && !a.claim.ticketId && { ticketId: prev.ticketId }) };
      return [...others, merged].sort((x, y) => createdMs(x) - createdMs(y));
    }
    case 'decided':
      return state.filter((c) => c.claimId !== a.claimId);
    case 'expire':
      return liveClaims(state, a.nowMs);
  }
}

/** Claims younger than 5 minutes, oldest first. */
export function liveClaims(state: readonly ClaimItem[], nowMs: number, ttlMs = CLAIM_TTL_MS): ClaimItem[] {
  return state.filter((c) => nowMs - createdMs(c) < ttlMs).sort((x, y) => createdMs(x) - createdMs(y));
}

/** Whole minutes since the claim was made (never negative). */
export const claimAgeMinutes = (c: ClaimItem, nowMs: number) => Math.max(0, Math.floor((nowMs - createdMs(c)) / 60_000));
