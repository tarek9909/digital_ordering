import { connectSocket, createReconnector, SeqTracker, setCsrfToken, type DopSocket, type Revalidation } from '@dop/client-sdk';
import type { DisplayTicket } from '@dop/contracts';
import { i18next } from '@dop/i18n';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, isUnauthenticated } from './lib/api';
import { Announcer, isQuietAt, minuteOfDayIn } from './lib/announce';
import { applyDisplayTicket, displayLanguage, newestRecent, type Board } from './lib/board';
import { findVoice, playChime, speak, voicesReady } from './lib/sound';
import { useDisplay } from './lib/store';

// Snapshot + socket for the display (TRD §10, §16.4). The last list stays on screen while disconnected (EX-10).

export const BOARD_KEY = ['display-board'] as const;
const seq = new SeqTracker();
const HIGHLIGHT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
/** Failed snapshot retries while online: 2 s, 4 s … up to 60 s (CSD04, TR-RT-05). */
const SNAPSHOT_RETRY_BASE_MS = 2_000;
const SNAPSHOT_RETRY_MAX_MS = 60_000;
/** Snapshot polling once the realtime server keeps refusing this display (CSD06). */
const POLL_WHEN_REFUSED_MS = 30_000;
/** An alert queued behind a snapshot that took longer than this is not announced late (the next round will be). */
const QUEUED_ALERT_MAX_AGE_MS = 60_000;

let highlightTimer: ReturnType<typeof setTimeout> | undefined;
function highlight(id: string) {
  useDisplay.getState().highlight(id);
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => useDisplay.getState().highlight(null), HIGHLIGHT_MS);
}

async function fetchBoard(): Promise<Board> {
  const b = await api.get<Board>('/board');
  setCsrfToken(b.csrfToken);
  seq.reset();
  for (const t of [...b.ready, ...b.preparing]) seq.set(t.id, t.seq);
  const lng = displayLanguage(b.settings.announce.languages);
  if (i18next.language !== lng) void i18next.changeLanguage(lng);
  const recent = newestRecent(b.ready, Date.parse(b.serverTime), HIGHLIGHT_MS);
  if (recent) highlight(recent.id);
  return b;
}

export function useBoardQuery() {
  return useQuery({
    queryKey: BOARD_KEY,
    queryFn: fetchBoard,
    retry: (n, e) => !isUnauthenticated(e) && n < 2,
    refetchOnWindowFocus: false,
  });
}

const LANGS_WITH_TEXT = ['ar', 'en'];
const base = (l: string) => l.split('-')[0]!;

function announcementText(numbers: string[], lang: string): string {
  const t = i18next.getFixedT(base(lang), 'display');
  return numbers.length === 1 ? t('announce.one', { number: numbers[0] }) : t('announce.many', { list: numbers.join(t('announce.separator')) });
}

function createAnnouncer(qc: QueryClient) {
  const board = () => qc.getQueryData<Board>(BOARD_KEY);
  return new Announcer({
    // The venue's chime (W11) and the platform's voice per language (`voices`), read at play time.
    chime: () => playChime(2, board()?.venue),
    speak: (text, lang) => speak(text, lang, board()?.voices),
    hasVoice: (lang) => LANGS_WITH_TEXT.includes(base(lang)) && findVoice(lang, board()?.voices) !== null,
    text: announcementText,
    settings: () => {
      const b = qc.getQueryData<Board>(BOARD_KEY);
      const a = b?.settings.announce;
      return {
        enabled: a?.enabled ?? true,
        // An empty list is deliberate (no display_speech feature, or speech switched off): chime, no speech.
        languages: a ? a.languages : ['ar'],
        quiet: a ? isQuietAt(minuteOfDayIn(new Date(), b.venue.timeZone), a.quietHours) : false,
        soundOn: useDisplay.getState().soundEnabled,
      };
    },
    onMissingVoice: (lang) => useDisplay.getState().addMissingVoice(lang),
    // Speak only tickets still Ready when their turn comes (A27).
    isCurrent: (id) => {
      const b = qc.getQueryData<Board>(BOARD_KEY);
      return !b || b.ready.some((t) => t.id === id);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  });
}

/** Warns about languages without a voice on this device (TR-ALR-17). */
export function useVoiceCheck(languages: readonly string[] | undefined, voices?: Record<string, string>) {
  const key = languages?.join(',') ?? '';
  const voicesKey = JSON.stringify(voices ?? {});
  useEffect(() => {
    let alive = true;
    void voicesReady().then(() => {
      if (!alive) return;
      const missing = key
        .split(',')
        .filter(Boolean)
        .filter((l) => !(LANGS_WITH_TEXT.includes(base(l)) && findVoice(l, JSON.parse(voicesKey) as Record<string, string>)));
      useDisplay.getState().setMissingVoices(missing);
    });
    return () => {
      alive = false;
    };
  }, [key, voicesKey]);
}

/** Opens the display socket while paired. */
export function useDisplaySocket(enabled: boolean) {
  const qc = useQueryClient();
  const announcer = useRef<Announcer | null>(null);
  announcer.current ??= createAnnouncer(qc);

  useEffect(() => {
    if (!enabled) return;
    const st = useDisplay.getState;
    let reloading: Promise<Revalidation> | null = null;
    let queued: Array<() => void> = [];
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

    // The board stays "stale" (badge visible, last list kept, EX-10) from a failed snapshot until one succeeds;
    // a failure is retried with bounded back-off while online, and immediately when the browser comes back (CSD04).
    const scheduleRetry = () => {
      clearTimeout(retryTimer);
      if (disposed || !online()) return;
      const delay = Math.min(SNAPSHOT_RETRY_MAX_MS, SNAPSHOT_RETRY_BASE_MS * 2 ** Math.min(failures - 1, 16));
      retryTimer = setTimeout(() => void reload(), delay);
    };
    const reload = (showBadge = false): Promise<Revalidation> => {
      if (reloading) return reloading;
      if (showBadge) st().setResyncing(true);
      reloading = (async (): Promise<Revalidation> => {
        try {
          await qc.fetchQuery({ queryKey: BOARD_KEY, queryFn: fetchBoard, staleTime: 0, retry: (n, e) => !isUnauthenticated(e) && n < 1 });
          failures = 0;
          clearTimeout(retryTimer);
          const run = queued;
          queued = [];
          run.forEach((f) => f());
          st().setStale(false);
          st().setResyncing(false);
          return 'ok';
        } catch (e) {
          // 401: the display was unpaired; DisplayRoot shows pairing and closes this socket.
          if (isUnauthenticated(e)) return 'signed-out';
          failures += 1;
          st().setStale(true);
          scheduleRetry();
          return 'unavailable';
        } finally {
          reloading = null;
        }
      })();
      return reloading;
    };
    const whenFresh = (f: () => void) => (reloading ? queued.push(f) : f());

    const apply = (t: DisplayTicket) => {
      const v = seq.check(t.id, t.seq);
      if (v === 'stale') return;
      if (v === 'gap') return void reload();
      seq.set(t.id, t.seq);
      const before = qc.getQueryData<Board>(BOARD_KEY);
      const wasReady = before?.ready.some((x) => x.id === t.id) ?? false;
      qc.setQueryData<Board>(BOARD_KEY, (b) => (b ? applyDisplayTicket(b, t) : b));
      if (t.status === 'ready' && !wasReady) highlight(t.id);
      // Left Ready (Undo, Collected, Cancelled): a pending announcement for it must not play.
      if (t.status !== 'ready') announcer.current?.cancel(t.id);
    };

    const sendHeartbeat = (s: DopSocket) => {
      if (s.connected) s.emit('display.heartbeat', { soundEnabled: st().soundEnabled }, () => undefined);
    };

    // A handshake the server refused leaves the socket inactive: revalidate over HTTP and retry with back-off; after
    // repeated refusals keep the board fresh by polling instead of retrying forever (CSD06).
    const rc = createReconnector({
      connect: () => socket.connect(),
      revalidate: () => reload(),
      onGiveUp: (why) => {
        if (why !== 'refused' || disposed) return;
        clearInterval(poll);
        poll = setInterval(() => void reload(), POLL_WHEN_REFUSED_MS);
      },
    });
    const socket: DopSocket = connectSocket(
      { app: 'display' },
      {
        onConnect: () => {
          rc.connected();
          clearInterval(poll);
          const wasDown = st().connected === false;
          st().setConnected(true);
          void reload(wasDown);
          sendHeartbeat(socket);
        },
        onDisconnect: () => st().setConnected(false),
        onError: (e) => {
          st().setConnected(false);
          rc.refused(e, socket.active);
        },
      },
    );

    socket.on('ticket.created', (p) => whenFresh(() => p.display && apply(p.display)));
    socket.on('ticket.updated', (p) => whenFresh(() => apply(p.ticket as DisplayTicket)));
    // Alerts wait with ticket events while a snapshot reloads, so the counter filter is checked against fresh
    // state and a ticket entering Ready during a resync is still announced (CSD05).
    socket.on('ticket.alert', (p) => {
      const number = p.displayNumber;
      if (!number) return;
      const at = Date.now();
      whenFresh(() => {
        if (Date.now() - at > QUEUED_ALERT_MAX_AGE_MS) return;
        const b = qc.getQueryData<Board>(BOARD_KEY);
        // With a counter filter, announce only numbers this display shows.
        if (b?.counterIds?.length && p.id && !b.ready.some((t) => t.id === p.id)) return;
        if (p.id) highlight(p.id);
        announcer.current?.add(number, p.id);
      });
    });
    socket.on('tenant.status_changed', () => void reload());
    socket.on('venue.settings_changed', () => void reload());
    socket.on('resync.required', () => void reload());
    socket.on('device.revoked', () => {
      socket.disconnect();
      void qc.resetQueries({ queryKey: BOARD_KEY });
    });
    socket.on('app.version', (p) => {
      if (p.mandatory && p.app === 'display') window.location.reload();
    });

    const beat = setInterval(() => sendHeartbeat(socket), HEARTBEAT_MS);
    const unsub = useDisplay.subscribe((s, prev) => s.soundEnabled !== prev.soundEnabled && sendHeartbeat(socket));
    const goOnline = () => {
      if (st().stale) void reload();
      rc.kick();
    };
    window.addEventListener('online', goOnline);
    return () => {
      disposed = true;
      rc.stop();
      clearTimeout(retryTimer);
      clearInterval(poll);
      clearInterval(beat);
      unsub();
      window.removeEventListener('online', goOnline);
      socket.disconnect();
    };
  }, [enabled, qc]);
}
