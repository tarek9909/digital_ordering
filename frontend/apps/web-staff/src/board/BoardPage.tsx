import type { CancelReason, StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, LiveRegion, OfflineBar, Spinner, Toasts, useToasts } from '@dop/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Notice } from '../components/Notice';
import { errorText, isApiError } from '../lib/api';
import { useNow } from '../lib/hooks';
import { useOffline, useStaff } from '../lib/store';
import { liveClaims } from '../lib/claims';
import { useMember } from '../lib/member';
import { findTyped, type ShortcutCommand } from '../lib/shortcuts';
import {
  checkCodeMode,
  claimsMode,
  countTickets,
  findTicket,
  isTenantBlocked,
  pruneRecent,
  showReceivedColumn,
  soundOnApiTicket,
  ticketUrl,
  toColumns,
  type Board,
} from '../lib/ticketState';
import { closedSeenAt, useBoardQuery, useBoardSocket } from './boardData';
import { CardMenu } from './CardMenu';
import { ClaimsPanel } from './ClaimsPanel';
import { KitchenBoard } from './KitchenBoard';
import { MemberPinDialog } from './MemberPinDialog';
import { BoardColumns } from './Columns';
import { CancelDialog, CheckCodeDialog, EditDialog } from './dialogs';
import { NewTicketDialog } from './NewTicketDialog';
import { QrScreen } from './QrScreen';
import { RecentDrawer, SearchDialog } from './TicketList';
import { TopBar } from './TopBar';
import { KeyBuffer, useShortcuts } from './useShortcuts';
import { useTicketActions, type TransitionTo } from './useTicketActions';

type Dialog =
  | { kind: 'menu' | 'cancel' | 'edit'; ticket: StaffTicket }
  | { kind: 'check'; ticket: StaffTicket; invalid: boolean }
  | { kind: 'new' }
  | { kind: 'recent' }
  | { kind: 'search'; q: string };

interface Qr {
  ticketId: string;
  number: string;
  url: string;
  claimCode: string | null;
}

export function SignedOut() {
  const { t } = useTranslation();
  return <Notice title={t('signedOut.title')}>{t('signedOut.body')}</Notice>;
}

/** The staff board; `kitchen` forces kitchen mode (route `/kitchen`), otherwise the device setting decides. */
export function BoardPage({ kitchen = false }: { kitchen?: boolean }) {
  const { t } = useTranslation();
  const query = useBoardQuery();
  const signedOut = useStaff((s) => s.signedOut);
  const unauth = signedOut || isApiError(query.error, 'UNAUTHENTICATED');
  useBoardSocket(Boolean(query.data) && !unauth);

  if (unauth) return <SignedOut />;
  if (query.data) return <Board board={query.data} forceKitchen={kitchen} />;
  if (query.error)
    return (
      <Notice title={t('common:somethingWrong')}>
        <p className="mb-4">{errorText(t, query.error)}</p>
        <Button onClick={() => void query.refetch()}>{t('common:retry')}</Button>
      </Notice>
    );
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <Spinner label={t('common:loading')} />
    </main>
  );
}

function Board({ board, forceKitchen }: { board: Board; forceKitchen: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const claimNow = useNow(5_000);
  const offline = useOffline();
  const liveRefused = useStaff((s) => s.liveRefused);
  const offlineText = liveRefused ? t('liveRefused') : t('common:offline');
  const live = useStaff((s) => s.live);
  const allClaims = useStaff((s) => s.claims);
  const memberAsking = useMember((s) => s.asking);
  const toasts = useToasts();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const close = useCallback(() => setDialog(null), []);
  const closeQr = useCallback(() => setQr(null), []);
  // useToasts returns new functions every render; keep stable ones so toast timers are not restarted.
  const toastFns = useRef(toasts);
  toastFns.current = toasts;
  const toast = useCallback((x: Parameters<typeof toasts.push>[0]) => toastFns.current.push(x), []);
  const dismiss = useCallback((id: number) => toastFns.current.dismiss(id), []);

  const askCheckCode = useCallback((ticket: StaffTicket, invalid: boolean) => setDialog({ kind: 'check', ticket, invalid }), []);
  const actions = useTicketActions({ toast, askCheckCode });

  const showReceived = showReceivedColumn(board.venue.settings);
  const columns = useMemo(() => toColumns(board.open, showReceived), [board.open, showReceived]);
  // Recent uses the server's 30-minute window, so live closures age out as a reload would; the Collected total is
  // the server's business-date count kept live by applyTicket (W16, FR-STF-01/05).
  const recent = useMemo(() => pruneRecent(board.recent, now, closedSeenAt), [board.recent, now]);
  const counts = useMemo(
    () => countTickets({ open: board.open, recent, collectedToday: board.collectedToday }, showReceived),
    [board.open, recent, board.collectedToday, showReceived],
  );
  const claims = useMemo(() => liveClaims(allClaims, claimNow), [allClaims, claimNow]);
  const status = board.tenantStatus;
  const settings = board.venue.settings;
  const kitchen = forceKitchen || board.device?.mode === 'kitchen';
  const canCreate = status !== 'suspended';
  const showSound = soundOnApiTicket(settings);

  /** Keyboard shortcuts (FR-STF-12): results go to the live region; misses also show a toast. */
  const onKey = (c: ShortcutCommand) => {
    const st = useStaff.getState();
    const fail = (text: string) => {
      st.announce(text);
      toast({ text, tone: 'danger' });
    };
    if (c.kind === 'new') {
      if (!kitchen && canCreate && !offline) setDialog({ kind: 'new' });
      return;
    }
    if (c.kind === 'search') {
      if (!kitchen) document.getElementById('board-search')?.focus();
      return;
    }
    if (c.kind === 'escape' || (c.kind === 'collected' && kitchen)) return;
    const found = findTyped(board.open, c.number);
    if (found === 'ambiguous') {
      if (kitchen) fail(t('keys.ambiguous', { number: c.number }));
      else setDialog({ kind: 'search', q: c.number });
      return;
    }
    if (!found) return fail(t('keys.notFound', { number: c.number }));
    if (offline) return fail(t('common:offline'));
    if (c.kind === 'ready') {
      if (found.status === 'ready') st.announce(t('keys.alreadyReady', { number: found.displayNumber }));
      else void actions.transition(found, 'ready');
      return;
    }
    if (found.status !== 'ready') return fail(t('keys.notReady', { number: found.displayNumber }));
    void actions.transition(found, 'collected');
  };
  const typed = useShortcuts(dialog !== null || qr !== null || memberAsking, onKey);

  if (isTenantBlocked(status)) return <Notice title={t('blocked.title')}>{t('blocked.body')}</Notice>;

  /** Dialogs keep showing the freshest copy of their ticket. */
  const fresh = (tk: StaffTicket) => findTicket(board, tk.id) ?? tk;
  const showQr = (tk: StaffTicket, url = ticketUrl(board.venueUrl, tk.token)) =>
    setQr({ ticketId: tk.id, number: tk.displayNumber, url, claimCode: claimsMode(settings) !== 'off' ? tk.claimCode : null });
  const onAction = (tk: StaffTicket, to: TransitionTo) => void actions.transition(tk, to);
  const afterOk = (r: StaffTicket | null) => r && close();

  const common = (
    <>
      <MemberPinDialog />
      <KeyBuffer buffer={typed} kitchen={kitchen} />
      <Toasts items={toasts.items} onDismiss={dismiss} />
      <LiveRegion text={live} />
    </>
  );

  if (kitchen) {
    // Kitchen mode (FR-STF-11): Preparing cards with one Ready action; the Undo bar is the only other control.
    return (
      <div className="flex min-h-dvh flex-col bg-[#0b0d12]">
        {offline && <OfflineBar text={offlineText} />}
        {status === 'suspended' && <Banner tone="warn">{t('suspended')}</Banner>}
        <KitchenBoard
          venueName={board.venue.name}
          tickets={[...columns.received, ...columns.preparing]}
          now={now}
          disabled={offline}
          showSound={showSound}
          onReady={(tk) => onAction(tk, 'ready')}
        />
        {common}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {offline && <OfflineBar text={offlineText} />}
      {status === 'suspended' && <Banner tone="warn">{t('suspended')}</Banner>}
      <TopBar
        venueName={board.venue.name}
        claimCount={claims.length}
        showSound={showSound}
        counts={counts}
        showReceived={showReceived}
        canCreate={canCreate}
        disabled={offline}
        onNew={() => setDialog({ kind: 'new' })}
        onSearch={(q) => setDialog({ kind: 'search', q })}
        onRecent={() => setDialog({ kind: 'recent' })}
      />
      <ClaimsPanel claims={claims} now={claimNow} disabled={offline} onError={(text) => toast({ text, tone: 'danger' })} />
      <BoardColumns
        columns={columns}
        showReceived={showReceived}
        now={now}
        disabled={offline}
        showCheckCode={checkCodeMode(settings) !== 'off'}
        onAction={onAction}
        onMenu={(tk) => setDialog({ kind: 'menu', ticket: tk })}
      />

      {dialog?.kind === 'menu' && (
        <CardMenu
          ticket={fresh(dialog.ticket)}
          now={now}
          disabled={offline}
          onClose={close}
          onQr={() => {
            showQr(fresh(dialog.ticket));
            close();
          }}
          onTransition={(to) => void actions.transition(fresh(dialog.ticket), to).then(afterOk)}
          onWait={(d) => void actions.edit(fresh(dialog.ticket), { waitDeltaMinutes: d })}
          onEdit={() => setDialog({ kind: 'edit', ticket: dialog.ticket })}
          onCancel={() => setDialog({ kind: 'cancel', ticket: dialog.ticket })}
          onAlert={() => void actions.alertAgain(fresh(dialog.ticket)).then(afterOk)}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelDialog
          ticket={fresh(dialog.ticket)}
          disabled={offline}
          onClose={close}
          onConfirm={(cancelReason: CancelReason, cancelNote?: string) =>
            actions.transition(fresh(dialog.ticket), 'cancelled', { cancelReason, ...(cancelNote && { cancelNote }) }).then(afterOk)
          }
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditDialog ticket={fresh(dialog.ticket)} disabled={offline} onClose={close} onSave={(b) => actions.edit(fresh(dialog.ticket), b).then(afterOk)} />
      )}
      {dialog?.kind === 'check' && (
        <CheckCodeDialog
          key={`${dialog.ticket.id}-${String(dialog.invalid)}`}
          ticket={fresh(dialog.ticket)}
          invalid={dialog.invalid}
          disabled={offline}
          onClose={close}
          onSubmit={(checkCode) => actions.transition(fresh(dialog.ticket), 'collected', { checkCode }).then(afterOk)}
        />
      )}
      {dialog?.kind === 'new' && (
        <NewTicketDialog
          counters={board.counters}
          disabled={offline}
          onClose={close}
          onCreated={(tk, url) => {
            close();
            showQr(tk, url);
          }}
          onOpenExisting={(tk) => setDialog({ kind: 'menu', ticket: tk })}
        />
      )}
      {dialog?.kind === 'recent' && (
        <RecentDrawer
          tickets={recent}
          now={now}
          disabled={offline}
          timeZone={board.venue.timeZone}
          onClose={close}
          onOpen={(tk) => setDialog({ kind: 'menu', ticket: tk })}
          onReopen={(tk) => void actions.transition(tk, 'ready')}
        />
      )}
      {dialog?.kind === 'search' && (
        <SearchDialog
          initial={dialog.q}
          now={now}
          disabled={offline}
          timeZone={board.venue.timeZone}
          onClose={close}
          onOpen={(tk) => setDialog({ kind: 'menu', ticket: tk })}
        />
      )}
      {qr && <QrScreen {...qr} onClose={closeQr} />}
      {common}
    </div>
  );
}
