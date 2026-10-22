import { create } from 'zustand';
import { claimsReducer, type ClaimAction, type ClaimItem } from './claims';

// Connection, offline and transient UI state for the staff board (TR-FE-15).

interface StaffState {
  /** null until the first connect attempt finishes. */
  socketUp: boolean | null;
  /** Set on disconnect or a network failure; cleared when a fresh snapshot arrives. */
  needsReload: boolean;
  signedOut: boolean;
  revoked: boolean;
  /** Ticket id → ready round of the last `ticket.overdue` event (TR-FE-17). */
  overdue: Record<string, number>;
  /** Last ticket a phone followed (closes the new-ticket QR, FR-QR-01). */
  lastFollowed: { id: string; at: number } | null;
  /** Polite live-region text for status changes (TR-A11Y-02). */
  live: string;
  /** serverTime − local time, so ages and wait estimates match the server clock. */
  clockOffset: number;
  /** Ticket ids with a request in flight (spinner on the card, TR-FE-14). */
  busy: Record<string, boolean>;
  /** Pending staff-approved claims (FR-STF-15). */
  claims: ClaimItem[];
  /** The one-time "Enable sound" tap was done (FR-STF-16). */
  soundEnabled: boolean;
  /** Tickets just created by a POS, highlighted on the board. */
  posNew: Record<string, boolean>;
  setSocketUp(up: boolean): void;
  markStale(): void;
  markFresh(serverTime: string): void;
  setSignedOut(v: boolean): void;
  setRevoked(): void;
  markOverdue(id: string, round: number): void;
  markFollowed(id: string): void;
  announce(text: string): void;
  setBusy(id: string, v: boolean): void;
  setClaims(c: ClaimItem[]): void;
  claimAction(a: ClaimAction): void;
  setSoundEnabled(v: boolean): void;
  setPosNew(id: string, v: boolean): void;
}

export const useStaff = create<StaffState>((set) => ({
  socketUp: null,
  needsReload: false,
  signedOut: false,
  revoked: false,
  overdue: {},
  lastFollowed: null,
  live: '',
  clockOffset: 0,
  busy: {},
  claims: [],
  soundEnabled: false,
  posNew: {},
  setSocketUp: (up) => set(up ? { socketUp: true } : { socketUp: false, needsReload: true }),
  markStale: () => set({ needsReload: true }),
  markFresh: (serverTime) => set({ needsReload: false, clockOffset: new Date(serverTime).getTime() - Date.now() }),
  setSignedOut: (v) => set({ signedOut: v }),
  setRevoked: () => set({ revoked: true, signedOut: true }),
  markOverdue: (id, round) => set((s) => ({ overdue: { ...s.overdue, [id]: round } })),
  markFollowed: (id) => set({ lastFollowed: { id, at: Date.now() } }),
  announce: (text) => set({ live: text }),
  setBusy: (id, v) =>
    set((s) => {
      const busy = { ...s.busy };
      if (v) busy[id] = true;
      else delete busy[id];
      return { busy };
    }),
  setClaims: (claims) => set({ claims }),
  claimAction: (a) => set((s) => ({ claims: claimsReducer(s.claims, a) })),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  setPosNew: (id, v) =>
    set((s) => {
      const posNew = { ...s.posNew };
      if (v) posNew[id] = true;
      else delete posNew[id];
      return { posNew };
    }),
}));

/** Offline means actions are disabled (FR-STF-14). */
export const useOffline = () => useStaff((s) => s.socketUp === false || s.needsReload);
