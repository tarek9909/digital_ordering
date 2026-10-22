import { connectSocket, SeqTracker, setCsrfToken, type DopSocket } from '@dop/client-sdk';
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
    let reloading = false;
    let queued: Array<() => void> = [];

    const reload = async (showBadge = false) => {
      if (reloading) return;
      reloading = true;
      if (showBadge) st().setResyncing(true);
      try {
        await qc.fetchQuery({ queryKey: BOARD_KEY, queryFn: fetchBoard, staleTime: 0, retry: 1 });
        const run = queued;
        queued = [];
        run.forEach((f) => f());
        st().setResyncing(false);
      } catch {
        /* keep the last list; the next reconnect retries (EX-10) */
      } finally {
        reloading = false;
      }
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

    const socket: DopSocket = connectSocket(
      { app: 'display' },
      {
        onConnect: () => {
          const wasDown = st().connected === false;
          st().setConnected(true);
          void reload(wasDown);
          sendHeartbeat(socket);
        },
        onDisconnect: () => st().setConnected(false),
        onError: () => st().setConnected(false),
      },
    );

    socket.on('ticket.created', (p) => whenFresh(() => p.display && apply(p.display)));
    socket.on('ticket.updated', (p) => whenFresh(() => apply(p.ticket as DisplayTicket)));
    socket.on('ticket.alert', (p) => {
      if (!p.displayNumber) return;
      const b = qc.getQueryData<Board>(BOARD_KEY);
      // With a counter filter, announce only numbers this display shows.
      if (b?.counterIds?.length && p.id && !b.ready.some((t) => t.id === p.id)) return;
      if (p.id) highlight(p.id);
      announcer.current?.add(p.displayNumber, p.id);
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
    return () => {
      clearInterval(beat);
      unsub();
      socket.disconnect();
    };
  }, [enabled, qc]);
}
