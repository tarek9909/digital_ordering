import { create } from 'zustand';
import { activeMember, msUntilIdle, touchMember, type MemberSession } from './memberSession';

// Named-staff session in memory (never stored): who is signed in on this board, and the PIN pad request.

interface MemberState {
  session: MemberSession | null;
  /** Set after the first "Enter your personal PIN" refusal: later writes ask for the PIN up front. */
  namedStaff: boolean;
  /** The PIN pad is open. */
  asking: boolean;
}

export const useMember = create<MemberState>(() => ({ session: null, namedStaff: false, asking: false }));

let idleTimer: ReturnType<typeof setTimeout> | undefined;
let waiting: Array<(ok: boolean) => void> = [];

function schedule(s: MemberSession | null) {
  clearTimeout(idleTimer);
  if (s) idleTimer = setTimeout(() => useMember.setState({ session: activeMember(useMember.getState().session, Date.now()) }), msUntilIdle(s, Date.now()) + 50);
}

/** The current session if still active. */
export const currentMember = () => activeMember(useMember.getState().session, Date.now());

export function signInMember(token: string, name: string) {
  const session: MemberSession = { token, name, lastUsedAt: Date.now() };
  useMember.setState({ session, namedStaff: true });
  schedule(session);
}

/** Called after each write that carried the token (the server slides its window too). */
export function touchCurrentMember() {
  const session = touchMember(useMember.getState().session, Date.now());
  useMember.setState({ session });
  schedule(session);
}

export function clearMember() {
  clearTimeout(idleTimer);
  useMember.setState({ session: null });
}

export const markNamedStaff = () => useMember.setState({ namedStaff: true });

/** Opens the PIN pad; resolves true once a person signed in, false if the pad was closed. */
export function requestPin(): Promise<boolean> {
  return new Promise((resolve) => {
    waiting.push(resolve);
    useMember.setState({ asking: true });
  });
}

/** The PIN pad finished: wakes every action waiting for it. */
export function finishPin(ok: boolean) {
  const run = waiting;
  waiting = [];
  useMember.setState({ asking: false });
  run.forEach((r) => r(ok));
}

/** "Switch": forget the current person and ask for a PIN now. */
export function switchMember() {
  clearMember();
  void requestPin();
}
