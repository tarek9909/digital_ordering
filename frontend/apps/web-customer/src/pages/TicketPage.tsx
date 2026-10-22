import type { PublicTicket } from '@dop/contracts';
import { ApiError, applyBrand, prefetchChime, type DopSocket } from '@dop/client-sdk';
import { i18next, useTranslation } from '@dop/i18n';
import { Banner, Button, LiveRegion, Spinner } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from '../lib/router';
import { ActivationSheet } from '../components/ActivationSheet';
import { RatingForm } from '../components/RatingForm';
import { ReadyScreen } from '../components/ReadyScreen';
import { VenueHeader, VenueFooter } from '../components/VenueChrome';
import { publicApi } from '../lib/api';
import { audioState, keepAwake, startAlertLoop, type AlertLoop } from '../lib/audio';
import { applyVenueLanguage } from '../lib/lang';
import { uaFamily } from '../lib/platform';
import { linkExistingSubscription } from '../lib/push';
import { clientId, closedAtOf, markClosed, rememberTicket } from '../lib/storage';
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
  const [alertsOn, setAlertsOn] = useState(false);
  const [pushLinkFailed, setPushLinkFailed] = useState(false);
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
  const follow = useRef<{ state: 'idle' | 'pending' | 'ok' | 'failed'; attempts: number; timer?: ReturnType<typeof setTimeout> }>({ state: 'idle', attempts: 0 });
  const register = useCallback(async () => {
    const f = follow.current;
    const tk = ticketRef.current;
    if (!tk || !OPEN.has(tk.status) || f.state === 'pending' || f.state === 'ok') return;
    clearTimeout(f.timer);
    f.state = 'pending';
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
      if (!alive.current) return;
      setFollowFailed(true);
      if (isRetriable(e)) {
        const delay = Math.min(FOLLOW_RETRY_MAX_MS, FOLLOW_RETRY_BASE_MS * 2 ** (f.attempts - 1));
        f.timer = setTimeout(() => void register(), delay);
      }
      return;
    }
    f.state = 'ok';
    f.attempts = 0;
    if (!alive.current) return;
    setFollowFailed(false);
    // A subscription from an earlier ticket must be linked to this ticket's follower before "Alerts are on".
    try {
      const r = await linkExistingSubscription(token);
      if (!alive.current) return;
      setPushLinkFailed(false);
      if (r === 'linked') setAlertsOn(true);
    } catch {
      if (!alive.current) return;
      setAlertsOn(false);
      setPushLinkFailed(true);
    }
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
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
        <h1 className="text-2xl font-bold">{t('notFoundTitle')}</h1>
        <p className="text-muted">{t('notFoundBody')}</p>
      </main>
    );
  }
  if (!ticket && ticketQ.isError) {
    // Server or network failure on the first load (A28): say so and offer a retry.
    return (
      <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <h1 className="text-2xl font-bold">{t('loadError.title')}</h1>
        <p className="text-muted">{t('loadError.body')}</p>
        <Button size="lg" busy={ticketQ.isFetching} onClick={() => void ticketQ.refetch()}>
          {t('common:retry')}
        </Button>
      </main>
    );
  }
  if (!ticket) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner label={t('common:loading')} />
      </main>
    );
  }

  const ready = ticket.status === 'ready';
  const open = OPEN.has(ticket.status);
  const wait = agedWait(ticket.waitRemainingMinutes, ticket.waitOverdue, ticketQ.dataUpdatedAt || now, Math.max(now, ticketQ.dataUpdatedAt));
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {!connected && open && (
        <div role="status" className="bg-ink px-4 py-2 text-center text-white">
          {t('reconnecting')}
        </div>
      )}
      {ticket.tenantStatus === 'suspended' && <Banner tone="warn">{t('suspended')}</Banner>}
      {followFailed && open && <Banner tone="warn">{t('followFailed')}</Banner>}
      {undoNotice && <Banner tone="info">{t('undoNotice')}</Banner>}
      <VenueHeader venue={ticket.venue} />
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
        <TicketBody ticket={ticket} wait={wait} alertsOn={alertsOn} pushLinkFailed={pushLinkFailed} onTurnOn={() => setSheetOpen(true)} />
      )}

      <VenueFooter venue={ticket.venue} />
      {sheetOpen && open && (
        <ActivationSheet
          token={token}
          chime={ticket.venue}
          fromHomeScreen={fromHomeScreen}
          onClose={(on) => {
            setSheetOpen(false);
            if (on) {
              setAlertsOn(true);
              setPushLinkFailed(false);
            }
          }}
        />
      )}
    </div>
  );
}

function TicketBody({
  ticket,
  wait,
  alertsOn,
  pushLinkFailed,
  onTurnOn,
}: {
  ticket: PublicTicket;
  wait: WaitView | null;
  alertsOn: boolean;
  pushLinkFailed: boolean;
  onTurnOn: () => void;
}) {
  const { t } = useTranslation();
  const open = OPEN.has(ticket.status);
  const msgs = { ...(ticket.venue.messages[ticket.venue.locales[0] ?? 'ar'] ?? {}), ...(ticket.venue.messages[i18next.language] ?? {}) };
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center gap-5 px-4 py-6 text-center">
      {/* The order as a paper ticket: number on top, a torn-off line, then the live status. */}
      <section className="w-full rounded-[1.75rem] border border-line bg-surface shadow-card">
        <div className="flex flex-col items-center gap-2 px-5 pt-6 pb-5">
          <p className="eyebrow">{t('yourOrder')}</p>
          {/* At least one third of the screen width (FR-CUS-02, TR-FE-11). */}
          <div
            className="num font-display font-extrabold leading-none tracking-tight"
            style={{ fontSize: 'clamp(33vw, 40vw, 14rem)' }}
            aria-label={`${t('order')} ${ticket.displayNumber}`}
          >
            {ticket.displayNumber}
          </div>
          {ticket.counterName && <p className="text-lg font-semibold text-ink-2">{ticket.counterName}</p>}
        </div>
        <div aria-hidden="true" className="relative mx-4 border-t-2 border-dashed border-line">
          <span className="absolute -start-7 -top-3 size-6 rounded-full bg-canvas" />
          <span className="absolute -end-7 -top-3 size-6 rounded-full bg-canvas" />
        </div>
        <div className="p-4">
          <div
            className={`flex items-center justify-center gap-3 rounded-2xl px-4 py-4 font-display text-xl font-bold ${open ? '' : 'bg-line text-ink'}`}
            style={open ? { background: 'var(--brand-band)', color: 'var(--on-band)' } : undefined}
          >
            {open && <span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />}
            {t(`status.${ticket.status}`)}
          </div>
        </div>
      </section>
      {open && wait && <p className="text-lg">{wait.late ? t('wait.late') : t('wait.about', { count: wait.minutes })}</p>}
      {ticket.status === 'cancelled' && msgs.cancelled && <p className="text-lg">{msgs.cancelled}</p>}
      {ticket.status === 'collected' && msgs.afterCollection && <p className="text-lg">{msgs.afterCollection}</p>}
      {ticket.status === 'collected' && ticket.ratingAllowed && <RatingForm token={ticket.token} />}
      {!open && (
        // A closed ticket links back to the venue page (FR-CUS-11).
        <Link to={`/v/${encodeURIComponent(ticket.venue.venueCode)}`} className="text-lg font-semibold underline underline-offset-4">
          {t('backToVenue', { venue: ticket.venue.name })}
        </Link>
      )}
      {open && (
        <>
          {alertsOn ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-ok-bg px-4 py-2 font-semibold text-ok">✓ {t('alertsOn')}</p>
          ) : (
            <>
              {pushLinkFailed && (
                <p role="alert" className="text-danger">
                  {t('alertsLinkFailed')}
                </p>
              )}
              <Button size="lg" variant="brand" className="w-full" onClick={onTurnOn}>
                🔔 {t('turnOnAlerts')}
              </Button>
            </>
          )}
          <p className="text-muted">{alertsOn ? t('keepOpenLive') : t('keepOpen')}</p>
          {msgs.welcome && <p>{msgs.welcome}</p>}
        </>
      )}
    </main>
  );
}
