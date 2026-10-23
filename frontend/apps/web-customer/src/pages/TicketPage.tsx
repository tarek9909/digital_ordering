import type { PublicTicket } from '@dop/contracts';
import { ApiError, applyBrand, prefetchChime, type DopSocket } from '@dop/client-sdk';
import { i18next, useTranslation } from '@dop/i18n';
import { Banner, Button, LiveRegion, Spinner } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from '../lib/router';
import { ActivationSheet, type AlertDelivery } from '../components/ActivationSheet';
import { BellIcon, CheckIcon, ChevronIcon, ClockIcon } from '../components/icons';
import { numberSize, OrderRing } from '../components/OrderRing';
import { RatingForm } from '../components/RatingForm';
import { ReadyScreen } from '../components/ReadyScreen';
import { VenueHeader, VenueFooter } from '../components/VenueChrome';
import { publicApi } from '../lib/api';
import { audioState, keepAwake, startAlertLoop, type AlertLoop } from '../lib/audio';
import { applyVenueLanguage } from '../lib/lang';
import { uaFamily } from '../lib/platform';
import { linkExistingSubscription } from '../lib/push';
import { clientId, closedAtOf, markClosed, rememberTicket } from '../lib/storage';
import { ringProgress } from '../lib/progress';
import { agedWait, type WaitView } from '../lib/wait';

// Ticket page (TRD §16.2; FR-CUS-01 – FR-CUS-08, FR-CUS-11; FR-ALR-01 – FR-ALR-06).

const HEARTBEAT_MS = 20_000;
const OPEN = new Set(['received', 'preparing', 'ready']);
/** Staff can reopen a collected ticket for 30 minutes (BR-22); the page keeps listening that long. */
export const REOPEN_WINDOW_MS = 30 * 60_000;
/** Snapshot polling while the socket is down, so the page never sits on stale data (TR-RT-05). */
const POLL_WHILE_DOWN_MS = 30_000;
const FOLLOW_RETRY_BASE_MS = 2_000;
const FOLLOW_RETRY_MAX_MS = 60_000;
const SOCKET_RETRY_MS = 10_000;
const WAIT_TICK_MS = 30_000;

const isRetriable = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;

export function TicketPage() {
  const { token = '' } = useParams();
  // Keyed by token: direct A → B navigation starts B with fresh refs (seq, follow, alert loop, socket).
  return <TicketView key={token} token={token} />;
}

/** The ticket's own web app manifest in <head> (TR-ALR-02), kept in step with SPA navigation. */
function useTicketManifest(token: string, valid: boolean) {
  useEffect(() => {
    if (!valid) return;
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.setAttribute('href', `/m/${token}.webmanifest`);
    const el = link;
    return () => el.remove();
  }, [token, valid]);
}

function TicketView({ token }: { token: string }) {
  const [search] = useSearchParams();
  const fromHomeScreen = search.get('src') === 'hs';
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['ticket', token];
  const valid = /^[0-9A-Za-z]{22}$/.test(token);

  const [connected, setConnected] = useState(true);
  const ticketQ = useQuery({
    queryKey: key,
    queryFn: () => publicApi.get<PublicTicket>(`/tickets/${token}`),
    enabled: valid,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    refetchInterval: connected ? false : POLL_WHILE_DOWN_MS,
  });
  const ticket = ticketQ.data;
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;

  const [undoNotice, setUndoNotice] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(fromHomeScreen);
  // The sheet stays mounted for its closing slide; what it reported is applied at once (CSD01).
  const [sheetMounted, setSheetMounted] = useState(fromHomeScreen);
  useEffect(() => {
    if (sheetOpen) return setSheetMounted(true);
    const id = setTimeout(() => setSheetMounted(false), 260);
    return () => clearTimeout(id);
  }, [sheetOpen]);
  // What this ticket can alert through (CSD01): only `push` after the subscription was saved for this ticket.
  const [delivery, setDelivery] = useState<AlertDelivery>('none');
  const [followFailed, setFollowFailed] = useState(false);
  const [windowOver, setWindowOver] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const loopRef = useRef<AlertLoop | null>(null);
  const socketRef = useRef<DopSocket | null>(null);
  const knownSeq = useRef<number | null>(null);
  const undoSeq = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastRound = useRef(0);
  const alive = useRef(true);

  useTicketManifest(token, valid);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Leaving the page (or switching ticket) stops the alert loop and pending timers (A23).
      loopRef.current?.stop();
      loopRef.current = null;
      clearTimeout(undoTimer.current);
    };
  }, []);

  // Language follows the venue once; an explicit choice in the header is kept (TR-L10N-02).
  const localesKey = ticket ? ticket.venue.locales.join(',') : undefined;
  useEffect(() => {
    if (localesKey === undefined) return;
    applyVenueLanguage(localesKey.split(',').filter(Boolean));
  }, [localesKey]);

  // Brand colour (TR-FE-07) and the last seq the page holds (TR-RT-04).
  useEffect(() => {
    if (!ticket) return;
    applyBrand(document.documentElement, ticket.venue.brandColor);
    knownSeq.current = ticket.seq;
  }, [ticket]);

  // An uploaded venue chime is downloaded ahead of the first alert (W11).
  const chimeUrl = ticket?.venue.chimeUrl;
  useEffect(() => prefetchChime(chimeUrl), [chimeUrl]);

  // The wait estimate ages between projections.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), WAIT_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ---- Follow registration (TR-FE-12) with retry; push subscription linked per ticket (TRD §11.2 step 4).
  const follow = useRef<{
    state: 'idle' | 'pending' | 'ok' | 'failed';
    attempts: number;
    timer?: ReturnType<typeof setTimeout>;
    inflight?: Promise<boolean>;
  }>({ state: 'idle', attempts: 0 });
  /** Registers this phone as a follower; resolves true once it is registered (shared by concurrent callers). */
  const register = useCallback((): Promise<boolean> => {
    const f = follow.current;
    const tk = ticketRef.current;
    if (f.state === 'ok') return Promise.resolve(true);
    if (f.state === 'pending' && f.inflight) return f.inflight;
    if (!tk || !OPEN.has(tk.status)) return Promise.resolve(false);
    clearTimeout(f.timer);
    f.state = 'pending';
    const run = async (): Promise<boolean> => {
      try {
        await publicApi.post(`/tickets/${token}/follow`, {
          clientId: clientId(),
          joinedVia: fromHomeScreen ? 'home_screen' : 'ticket_qr',
          uaFamily: uaFamily(),
          locale: i18next.language,
        });
      } catch (e) {
        f.state = 'failed';
        f.attempts += 1;
        if (!alive.current) return false;
        setFollowFailed(true);
        if (isRetriable(e)) {
          const delay = Math.min(FOLLOW_RETRY_MAX_MS, FOLLOW_RETRY_BASE_MS * 2 ** (f.attempts - 1));
          f.timer = setTimeout(() => void register(), delay);
        }
        return false;
      }
      f.state = 'ok';
      f.attempts = 0;
      if (!alive.current) return true;
      setFollowFailed(false);
      // A subscription from an earlier ticket must be linked to this ticket's follower before "Alerts are on".
      try {
        const r = await linkExistingSubscription(token);
        if (!alive.current) return true;
        if (r === 'linked') setDelivery('push');
      } catch {
        if (!alive.current) return true;
        // Do not undo a subscription the activation sheet saved meanwhile.
        setDelivery((d) => (d === 'push' ? d : 'failed'));
      }
      return true;
    };
    f.inflight = run().finally(() => {
      f.inflight = undefined;
    });
    return f.inflight;
  }, [token, fromHomeScreen]);

  useEffect(() => () => clearTimeout(follow.current.timer), []);

  // Every new projection (and coming back online) retries a failed registration.
  useEffect(() => {
    if (!ticket || !OPEN.has(ticket.status)) return;
    void register();
  }, [ticket, register]);
  useEffect(() => {
    const onOnline = () => void register();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [register]);

  // ---- Local list on this phone (TR-FE-09) and the reopen window after collection (BR-22).
  const isOpen = ticket ? OPEN.has(ticket.status) : undefined;
  useEffect(() => {
    if (!ticket) return;
    if (OPEN.has(ticket.status)) rememberTicket(token, ticket.venue.venueCode);
    else markClosed(token);
  }, [isOpen, token]); // eslint-disable-line react-hooks/exhaustive-deps
  // Since when this phone knows the ticket is closed; computed during render so the socket is not dropped and
  // re-opened between the "collected" render and an effect.
  // The server's `collectedAt` when present; an older API without it falls back to when this phone saw it close.
  const collectedAtMs = ticket?.collectedAt ? Date.parse(ticket.collectedAt) : NaN;
  const closedSince = useMemo(
    () => (isOpen === false ? (Number.isFinite(collectedAtMs) ? collectedAtMs : (closedAtOf(token) ?? Date.now())) : null),
    [isOpen, token, collectedAtMs],
  );
  useEffect(() => {
    setWindowOver(false);
    if (closedSince === null) return;
    const left = closedSince + REOPEN_WINDOW_MS - Date.now();
    if (left <= 0) return setWindowOver(true);
    const id = setTimeout(() => setWindowOver(true), left);
    return () => clearTimeout(id);
  }, [closedSince]);
  const reopenWindow = ticket?.status === 'collected' && closedSince !== null && !windowOver && Date.now() < closedSince + REOPEN_WINDOW_MS;

  const stopAlert = useCallback(() => {
    loopRef.current?.stop();
    loopRef.current = null;
    setAlerting(false);
    setNeedsTap(false);
  }, []);

  const playLoop = useCallback(() => {
    loopRef.current?.stop();
    if (!alive.current) return;
    const venue = ticketRef.current?.venue;
    loopRef.current = startAlertLoop(venue?.liveLoopSeconds ?? 60, () => alive.current && setAlerting(false), venue);
  }, []);

  const startAlert = useCallback(
    (round: number) => {
      if (round <= lastRound.current && loopRef.current) return;
      lastRound.current = round;
      setAlerting(true);
      void keepAwake();
      if (audioState() !== 'running') {
        // Page loaded without a tap: ask for one (TR-ALR-12); vibration still works on Android.
        setNeedsTap(true);
        navigator.vibrate?.([400, 200, 400, 200, 800]);
        return;
      }
      playLoop();
    },
    [playLoop],
  );

  // A Ready status seen on the snapshot also starts the alert (TR-ALR-11).
  useEffect(() => {
    if (!ticket) return;
    if (ticket.status === 'ready' && !ticket.acknowledged) startAlert(ticket.readyRound);
    if (ticket.status !== 'ready' || ticket.acknowledged) stopAlert();
  }, [ticket?.status, ticket?.acknowledged, ticket?.readyRound]); // eslint-disable-line react-hooks/exhaustive-deps

  const showUndo = useCallback(() => {
    setUndoNotice(true);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => alive.current && setUndoNotice(false), 10_000);
  }, []);

  // ---- Socket: snapshot on every (re)connect and on `resync.required`, then events in seq order (TR-RT-04/05).
  // It stays up while the ticket is open and, after collection, for the reopen window.
  const live = ticket === undefined ? undefined : isOpen || reopenWindow;
  useEffect(() => {
    if (!valid || !live) return;
    // socket.io loads after first render so it stays out of the initial chunk (TR-FE-05).
    let s: DopSocket | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let down = false;
    const resync = () => void qc.invalidateQueries({ queryKey: key });
    void import('../lib/socket').then(({ connectSocket }) => {
      if (cancelled) return;
      const sock = connectSocket(
        { clientId: clientId(), tickets: [token] },
        {
          onConnect: () => {
            down = false;
            clearTimeout(retry);
            setConnected(true);
            resync();
            void register();
          },
          onDisconnect: () => {
            if (cancelled) return;
            down = true;
            setConnected(false);
          },
          onError: () => {
            if (cancelled) return;
            setConnected(false);
            // First failure after being up: refresh the snapshot over REST now; polling covers the rest.
            if (!down) resync();
            down = true;
            // A refused handshake is not retried by socket.io itself; try again later.
            if (!sock.active) {
              clearTimeout(retry);
              retry = setTimeout(() => !cancelled && sock.connect(), SOCKET_RETRY_MS);
            }
          },
        },
      );
      s = sock;
      socketRef.current = sock;
      sock.on('resync.required', resync);
      sock.on('ticket.updated', (p) => {
        const next = p.ticket as PublicTicket;
        if (next.token !== token) return;
        const known = knownSeq.current;
        // The undo explanation shows even when the event itself is not applied (gap → snapshot) (A21).
        if (p.reason === 'undo' && next.seq > undoSeq.current && (known === null || next.seq >= known)) {
          undoSeq.current = next.seq;
          showUndo();
        }
        if (known !== null && next.seq <= known) return;
        if (known !== null && next.seq > known + 1) return resync();
        knownSeq.current = next.seq;
        qc.setQueryData(key, next);
      });
      sock.on('ticket.alert', (p) => {
        if (p.token !== token) return;
        socketRef.current?.emit('alert.delivered', { token, round: p.round, attempt: p.attempt }, () => undefined);
        startAlert(p.round);
      });
    });
    return () => {
      cancelled = true;
      clearTimeout(retry);
      s?.close();
      socketRef.current = null;
      setConnected(true);
    };
  }, [valid, token, live]); // eslint-disable-line react-hooks/exhaustive-deps

  // Service worker forwards pushes to open pages (TR-ALR-08).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; token?: string; round?: number };
      if (d?.type === 'ticket.alert' && d.token === token) {
        void qc.invalidateQueries({ queryKey: key });
        startAlert(d.round ?? lastRound.current + 1);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [token, startAlert]); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeats only while visible or while audio runs, so the level drops to "closed" honestly (TR-ALR-14).
  useEffect(() => {
    if (!ticket || !OPEN.has(ticket.status)) return;
    const beat = () => {
      const visible = document.visibilityState === 'visible';
      if (visible || audioState() === 'running') socketRef.current?.emit('presence.heartbeat', { tokens: [token], visible }, () => undefined);
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        beat();
        void keepAwake();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ticket?.status, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const acknowledge = async () => {
    stopAlert();
    try {
      await publicApi.post(`/tickets/${token}/acknowledge`);
    } catch {
      socketRef.current?.emit('ticket.acknowledge', { token }, () => undefined);
    }
    void qc.invalidateQueries({ queryKey: key });
  };

  if (!valid || (ticketQ.error instanceof ApiError && ticketQ.error.status === 404)) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <OrderRing token="" progress={0} idle className="w-28" />
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('notFoundTitle')}</h1>
        <p className="max-w-xs text-lg text-ink-2">{t('notFoundBody')}</p>
      </main>
    );
  }
  if (!ticket && ticketQ.isError) {
    // Server or network failure on the first load (A28): say so and offer a retry.
    return (
      <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('loadError.title')}</h1>
        <p className="max-w-xs text-lg text-ink-2">{t('loadError.body')}</p>
        <Button size="lg" className="w-full max-w-sm" busy={ticketQ.isFetching} onClick={() => void ticketQ.refetch()}>
          {t('common:retry')}
        </Button>
      </main>
    );
  }
  if (!ticket) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas text-muted">
        <Spinner label={t('common:loading')} />
      </main>
    );
  }

  const ready = ticket.status === 'ready';
  const open = OPEN.has(ticket.status);
  const wait = agedWait(ticket.waitRemainingMinutes, ticket.waitOverdue, ticketQ.dataUpdatedAt || now, Math.max(now, ticketQ.dataUpdatedAt));
  const notices = ticket.tenantStatus === 'suspended' || (followFailed && open) || undoNotice;
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-canvas">
      {!connected && open && (
        <div role="status" className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-center text-sm font-medium text-white">
          <Spinner />
          {t('reconnecting')}
        </div>
      )}
      <VenueHeader venue={ticket.venue} />
      {notices && (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 pt-3">
          {ticket.tenantStatus === 'suspended' && <Banner tone="warn">{t('suspended')}</Banner>}
          {followFailed && open && <Banner tone="warn">{t('followFailed')}</Banner>}
          {undoNotice && <Banner tone="info">{t('undoNotice')}</Banner>}
        </div>
      )}
      <LiveRegion text={t(`status.${ready && ticket.acknowledged ? 'readyAck' : ticket.status}`)} assertive={ready} />

      {ready ? (
        <ReadyScreen
          ticket={ticket}
          alerting={alerting}
          needsTap={needsTap}
          onTapToHear={() => {
            setNeedsTap(false);
            playLoop();
          }}
          onComing={acknowledge}
        />
      ) : (
        <TicketBody ticket={ticket} wait={wait} delivery={delivery} onTurnOn={() => setSheetOpen(true)} />
      )}

      <VenueFooter venue={ticket.venue} />
      {sheetMounted && open && (
        <ActivationSheet
          token={token}
          chime={ticket.venue}
          fromHomeScreen={fromHomeScreen}
          ensureFollowed={register}
          leaving={!sheetOpen}
          onClose={(d) => {
            setSheetOpen(false);
            // A background subscription already linked stays; otherwise show what the sheet actually reached.
            if (d !== 'none') setDelivery((cur) => (cur === 'push' && d !== 'push' ? cur : d));
          }}
        />
      )}
    </div>
  );
}

function TicketBody({
  ticket,
  wait,
  delivery,
  onTurnOn,
}: {
  ticket: PublicTicket;
  wait: WaitView | null;
  delivery: AlertDelivery;
  onTurnOn: () => void;
}) {
  const { t } = useTranslation();
  const open = OPEN.has(ticket.status);
  const idle = ticket.status === 'cancelled' || ticket.status === 'expired';
  const alertsOn = delivery === 'push' || delivery === 'live';
  const msgs = { ...(ticket.venue.messages[ticket.venue.locales[0] ?? 'ar'] ?? {}), ...(ticket.venue.messages[i18next.language] ?? {}) };
  const progress = ringProgress(ticket.token, ticket.status, open ? wait : null);
  const hint = delivery === 'push' ? t('alertsPushOn') : delivery === 'live' ? t('keepOpenLive') : t('keepOpen');
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pt-10 pb-4 text-center">
      {/* The call ring closes around the number as the order moves on; Ready closes it (ReadyScreen). */}
      <OrderRing token={ticket.token} progress={progress} idle={idle} className="w-[min(82vw,21rem)]">
        <p className="text-sm font-medium text-muted">{t('yourOrder')}</p>
        {/* At least one third of the screen width (FR-CUS-02, TR-FE-11). */}
        <div
          className={`num font-display leading-[0.95] font-bold tracking-tight tabular-nums ${idle ? 'text-muted' : ''}`}
          style={{ fontSize: numberSize(ticket.displayNumber) }}
          aria-label={`${t('order')} ${ticket.displayNumber}`}
        >
          {ticket.displayNumber}
        </div>
        {ticket.counterName && <p className="mt-1 max-w-[12rem] truncate text-sm font-medium text-ink-2">{ticket.counterName}</p>}
      </OrderRing>

      <h1 className="mt-8 font-display text-2xl leading-tight font-semibold tracking-tight text-balance">{t(`status.${ticket.status}`)}</h1>
      {open && wait && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-base text-muted">
          <ClockIcon className="size-4" />
          {wait.late ? t('wait.late') : t('wait.about', { count: wait.minutes })}
        </p>
      )}
      {open && msgs.welcome && <p className="mt-3 max-w-sm text-ink-2">{msgs.welcome}</p>}
      {ticket.status === 'cancelled' && msgs.cancelled && <p className="mt-3 max-w-sm text-lg text-ink-2">{msgs.cancelled}</p>}
      {ticket.status === 'collected' && msgs.afterCollection && <p className="mt-3 max-w-sm text-lg text-ink-2">{msgs.afterCollection}</p>}

      {/* Actions sit low, within reach of a thumb. */}
      <div className="min-h-8 flex-1" />
      {open && (
        <div className="flex w-full flex-col gap-3">
          {alertsOn ? (
            <div className="flex flex-col items-center gap-0.5">
              <p className="inline-flex items-center gap-1.5 font-semibold text-ok">
                <CheckIcon className="size-4" />
                {t('alertsOn')}
              </p>
              <p className="text-sm text-muted">{hint}</p>
            </div>
          ) : (
            <>
              {delivery === 'failed' && (
                <p role="alert" className="text-danger">
                  {t('alertsLinkFailed')}
                </p>
              )}
              {delivery === 'blocked' && <p className="text-ink-2">{t('alertsBlocked')}</p>}
              <Button size="lg" className="w-full" onClick={onTurnOn}>
                <BellIcon className="size-5" />
                {t('turnOnAlerts')}
              </Button>
              <p className="text-sm text-muted">{hint}</p>
            </>
          )}
        </div>
      )}
      {ticket.status === 'collected' && ticket.ratingAllowed && (
        <div className="w-full border-t border-line pt-5">
          <RatingForm token={ticket.token} />
        </div>
      )}
      {!open && (
        // A closed ticket links back to the venue page (FR-CUS-11).
        <Link
          to={`/v/${encodeURIComponent(ticket.venue.venueCode)}`}
          className="mt-4 inline-flex min-h-12 items-center gap-1 rounded-control px-4 font-medium text-ink-2 transition-colors hover:text-ink"
        >
          {t('backToVenue', { venue: ticket.venue.name })}
          <ChevronIcon className="size-4 text-muted" />
        </Link>
      )}
    </main>
  );
}
