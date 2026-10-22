import { connectSocket, SeqTracker, setCsrfToken, type DopSocket } from '@dop/client-sdk';
import type { StaffTicket } from '@dop/contracts';
import { i18next } from '@dop/i18n';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, isApiError, venueId, vq } from '../lib/api';
import { useStaff } from '../lib/store';
import { playChime } from '../lib/chime';
import { applyTicket, businessDateOf, isOpenStatus, isPosTicket, soundOnApiTicket, type Board } from '../lib/ticketState';

// Board snapshot + live updates (TRD §10). Events that arrive while a snapshot reload is running are queued and
// applied afterwards, so a reconnect never mixes old and new state (TR-RT-05).

export const BOARD_KEY = ['staff-board'] as const;
export const seq = new SeqTracker();

/**
 * When this board first saw each Recent ticket closed (server clock). Snapshot rows get the snapshot's server time
 * (the server only says they changed within the last 30 minutes); live closures get the time they arrived.
 * Used to age the Recent list out the same way the server's window does (FR-STF-05).
 */
const closedSeen = new Map<string, number>();
export const closedSeenAt = (id: string) => closedSeen.get(id);
function noteClosed(t: StaffTicket, at: number) {
  if (isOpenStatus(t.status)) closedSeen.delete(t.id);
  else if (!closedSeen.has(t.id)) closedSeen.set(t.id, at);
}
/** How long a POS-created card stays highlighted (FR-STF-16). */
const POS_HIGHLIGHT_MS = 20_000;

export async function fetchBoard(): Promise<Board> {
  const b = await api.get<Board>(vq('/board'));
  setCsrfToken(b.csrfToken);
  seq.reset();
  for (const t of [...b.open, ...b.recent]) seq.set(t.id, t.seq);
  const at = Date.parse(b.serverTime);
  const inSnapshot = new Set(b.recent.map((t) => t.id));
  for (const id of [...closedSeen.keys()]) if (!inSnapshot.has(id)) closedSeen.delete(id);
  for (const t of b.recent) noteClosed(t, Number.isFinite(at) ? at : Date.now());
  useStaff.getState().markFresh(b.serverTime);
  useStaff.getState().setClaims(b.pendingClaims ?? []);
  return b;
}

/** Puts a server-confirmed ticket into the cache. */
export function putTicket(qc: QueryClient, t: StaffTicket) {
  seq.set(t.id, t.seq);
  noteClosed(t, Date.now() + useStaff.getState().clockOffset);
  qc.setQueryData<Board>(BOARD_KEY, (b) => (b ? applyTicket(b, t) : b));
}

const statusLine = (t: StaffTicket) => `${t.displayNumber}: ${i18next.t(`common:status.${t.status}`)}`;

export function useBoardQuery() {
  return useQuery({
    queryKey: BOARD_KEY,
    queryFn: fetchBoard,
    retry: (n, e) => !isApiError(e, 'UNAUTHENTICATED') && n < 2,
    refetchOnWindowFocus: false,
  });
}

/** Opens the staff socket for the lifetime of the board. */
export function useBoardSocket(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const st = useStaff.getState;
    let reloading = false;
    let queued: Array<() => void> = [];

    const reload = async () => {
      if (reloading) return;
      reloading = true;
      try {
        await qc.fetchQuery({ queryKey: BOARD_KEY, queryFn: fetchBoard, staleTime: 0, retry: false });
        const run = queued;
        queued = [];
        run.forEach((f) => f());
      } catch {
        st().markStale();
      } finally {
        reloading = false;
      }
    };
    const whenFresh = (f: () => void) => (reloading ? queued.push(f) : f());

    const applyUpdate = (t: StaffTicket) => {
      const verdict = seq.check(t.id, t.seq);
      if (verdict === 'stale') return;
      if (verdict === 'gap') return void reload();
      putTicket(qc, t);
      st().announce(statusLine(t));
      // A ticket from a newer business date means the day rolled over: reload so "Collected today" restarts.
      const b = qc.getQueryData<Board>(BOARD_KEY);
      if (b?.businessDate && businessDateOf(t, b.venue) > b.businessDate) void reload();
    };

    const socket: DopSocket = connectSocket(venueId ? { app: 'staff', venueId } : { app: 'staff' }, {
      // After a disconnect `needsReload` is already set, so actions stay disabled until the snapshot is back.
      onConnect: () => {
        st().setSocketUp(true);
        void reload();
      },
      onDisconnect: () => st().setSocketUp(false),
      onError: () => st().setSocketUp(false),
    });

    // POS tickets: chime (after the one-time "Enable sound" tap) and highlight the new card (FR-STF-16).
    const onPosTicket = (t: StaffTicket) => {
      const settings = qc.getQueryData<Board>(BOARD_KEY)?.venue.settings;
      if (!isPosTicket(t) || !soundOnApiTicket(settings)) return;
      st().setPosNew(t.id, true);
      setTimeout(() => st().setPosNew(t.id, false), POS_HIGHLIGHT_MS);
      if (st().soundEnabled) playChime();
    };

    socket.on('ticket.created', (p) =>
      whenFresh(() => {
        if (!p.staff) return;
        applyUpdate(p.staff);
        onPosTicket(p.staff);
      }),
    );
    socket.on('ticket.updated', (p) => whenFresh(() => applyUpdate(p.ticket as StaffTicket)));
    socket.on('ticket.followed', (p) => st().markFollowed(p.id));
    socket.on('ticket.overdue', (p) => st().markOverdue(p.id, p.round));
    socket.on('claim.requested', (p) => whenFresh(() => st().claimAction({ type: 'requested', claim: p })));
    socket.on('claim.decided', (p) => whenFresh(() => st().claimAction({ type: 'decided', claimId: p.claimId })));
    socket.on('tenant.status_changed', () => void reload());
    socket.on('venue.settings_changed', () => void reload());
    socket.on('resync.required', () => void reload());
    socket.on('device.revoked', () => {
      st().setRevoked();
      socket.disconnect();
    });
    socket.on('app.version', (p) => {
      if (p.mandatory && p.app === 'staff') window.location.reload();
    });

    const goOffline = () => st().setSocketUp(false);
    const goOnline = () => void reload();
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    // Keep trying to reload while offline but connected (a failed request marked the board stale).
    const retry = setInterval(() => {
      const s = st();
      if (s.needsReload && s.socketUp) void reload();
    }, 5_000);

    return () => {
      clearInterval(retry);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      socket.disconnect();
    };
  }, [enabled, qc]);
}
