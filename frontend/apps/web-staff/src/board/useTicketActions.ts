import type { ApiError } from '@dop/client-sdk';
import type { CancelReason, StaffTicket, TransitionBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import type { ToastItem } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, errorText, isApiError, vq } from '../lib/api';
import { useStaff } from '../lib/store';
import { findTicket, type Board } from '../lib/ticketState';
import { BOARD_KEY, putTicket } from './boardData';

// Ticket actions without optimistic UI (TR-FE-14): the card shows a spinner until the server answers, then the
// confirmed ticket replaces the card. Conflicts name the other device (FR-STF-13).

type Toast = (t: Omit<ToastItem, 'id'>) => void;
type TicketResponse = { ticket: StaffTicket };
export type TransitionTo = TransitionBody['to'];
export interface TransitionExtra {
  checkCode?: string;
  cancelReason?: CancelReason;
  cancelNote?: string;
}

export interface ActionHooks {
  toast: Toast;
  /** Asks the user for the 4-character check code, then calls back. */
  askCheckCode: (t: StaffTicket, invalid: boolean) => void;
}

export function useTicketActions({ toast, askCheckCode }: ActionHooks) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const latest = useCallback((tk: StaffTicket) => findTicket(qc.getQueryData<Board>(BOARD_KEY), tk.id) ?? tk, [qc]);

  const handleError = useCallback(
    (e: unknown, tk: StaffTicket) => {
      if (isApiError(e, 'TICKET_VERSION_CONFLICT')) {
        const data = ((e as ApiError).problem?.data ?? {}) as { ticket?: StaffTicket; actor?: string | null };
        if (data.ticket) putTicket(qc, data.ticket);
        const name = data.actor ?? (e as ApiError).problem?.detail ?? '';
        toast({ text: name ? t('conflictBy', { number: tk.displayNumber, name }) : t('conflict', { number: tk.displayNumber }), tone: 'danger' });
        return;
      }
      if (isApiError(e, 'CHECK_CODE_REQUIRED') || isApiError(e, 'CHECK_CODE_INVALID')) {
        askCheckCode(tk, isApiError(e, 'CHECK_CODE_INVALID'));
        return;
      }
      toast({ text: errorText(t, e), tone: 'danger' });
    },
    [askCheckCode, qc, t, toast],
  );

  const run = useCallback(
    async (tk: StaffTicket, call: (cur: StaffTicket) => Promise<TicketResponse>): Promise<StaffTicket | null> => {
      const s = useStaff.getState();
      s.setBusy(tk.id, true);
      const cur = latest(tk);
      try {
        const r = await call(cur);
        putTicket(qc, r.ticket);
        s.announce(`${r.ticket.displayNumber}: ${t(`common:status.${r.ticket.status}`)}`);
        return r.ticket;
      } catch (e) {
        handleError(e, cur);
        return null;
      } finally {
        useStaff.getState().setBusy(tk.id, false);
      }
    },
    [handleError, latest, qc, t],
  );

  const transition = useCallback(
    async (tk: StaffTicket, to: TransitionTo, extra: TransitionExtra = {}): Promise<StaffTicket | null> => {
      const from = latest(tk).status;
      const done = await run(tk, (cur) => api.post<TicketResponse>(vq(`/tickets/${cur.id}/transitions`), { to, version: cur.version, ...extra }));
      if (done && to === 'ready' && (from === 'preparing' || from === 'received')) {
        // Undo bar for 10 s, only after the server confirmed (FR-STF-03, EX-04).
        toast({
          text: t('markedReady', { number: done.displayNumber }),
          tone: 'ok',
          ttlMs: 10_000,
          action: { label: t('undo'), onClick: () => void transition(done, 'preparing') },
        });
      }
      return done;
    },
    [latest, run, t, toast],
  );

  const edit = useCallback(
    (tk: StaffTicket, body: { note?: string | null; externalRef?: string | null; waitDeltaMinutes?: number }) =>
      run(tk, (cur) => api.patch<TicketResponse>(vq(`/tickets/${cur.id}`), { version: cur.version, ...body })),
    [run],
  );

  const alertAgain = useCallback(
    async (tk: StaffTicket) => {
      const r = await run(tk, (cur) => api.post<TicketResponse>(vq(`/tickets/${cur.id}/alerts`)));
      if (r) toast({ text: t('alertSent', { number: r.displayNumber }), tone: 'ok' });
      return r;
    },
    [run, t, toast],
  );

  return { transition, edit, alertAgain };
}

export type TicketActions = ReturnType<typeof useTicketActions>;
