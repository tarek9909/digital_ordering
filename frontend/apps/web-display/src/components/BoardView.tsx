import { brandTokens, contrast, textOn } from '@dop/client-sdk';
import type { DisplayTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { BrandMark, LiveRegion, useFlip, useMoment, useVenueFavicon } from '@dop/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { gridCapacity, READY_PAGE_MS, readyPage, tileMinVmin, type Board, type ReadyKey } from '../lib/board';
import { PROMO_STRIP_VH, promoLayout } from '../lib/promo';
import { useDisplay } from '../lib/store';

// Platform frame (ember.css): white base, an ink Ready column for weight. The venue's colour marks the top edge and
// the number that just became ready (ember when the venue colour would not read on ink).
const SURFACE = '#ffffff';
const INK = '#1c1917';
/** Preparing uses the Ready tile, a size smaller so Ready keeps the weight. */
const PREPARING_FONT_VMIN = 10;
const PREPARING_MIN_VMIN = 22;
/** Preparing scroll speed when the list is longer than its column, in viewport heights per second. */
const PREPARING_SCROLL_VH_PER_S = 3.5;
/** The landing pulse is removed once it has radiated, so it never adds to the tile's box. */
const PULSE_MS = 2_200;
// Tiles are sized in vmin (the same as vh on a landscape TV, and not oversized on a portrait one). Columns are at
// least wide enough for the longest number; rows are as tall as their tile (max-content), so a tile is never
// squashed (CSD03). A column narrower than one tile (a very long number on a small screen) still gets one full-width
// track rather than overflowing the board.
const numberGrid = (minVmin: number): CSSProperties => ({ gridTemplateColumns: `repeat(auto-fill, minmax(min(${minVmin}vmin, 100%), 1fr))`, gridAutoRows: 'max-content' });

/** The highlight colour: the venue's own when it stands out on the ink column, else ember. */
function highlightTokens(brand: string): CSSProperties {
  const usable = /^#[0-9a-f]{6}$/i.test(brand) && contrast(brand, INK) >= 2.4;
  return (usable ? { '--hl': brand, '--on-hl': textOn(brand) } : { '--hl': 'var(--color-primary)', '--on-hl': 'var(--color-on-primary)' }) as CSSProperties;
}

/** The number that just became ready: lands with weight and radiates one pulse (brand moment `land`). */
function LandingNumber({ number }: { number: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pulse, setPulse] = useState(true);
  useMoment(ref, 'land', []);
  useEffect(() => {
    const id = setTimeout(() => setPulse(false), PULSE_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <span ref={ref} className="tile-ready tile-hl">
      {number}
      {pulse && <span data-land-pulse aria-hidden="true" className="land-pulse" />}
    </span>
  );
}

function NumberTile({ t, highlighted }: { t: DisplayTicket; highlighted: boolean }) {
  return (
    <li data-flip-id={t.id} className="relative flex">
      {highlighted ? <LandingNumber number={t.displayNumber} /> : <span className="tile-ready">{t.displayNumber}</span>}
    </li>
  );
}

/**
 * The Preparing list in a clipped viewport. When it is longer than the column, it scrolls upwards continuously as a
 * seamless loop (two copies, the second hidden from assistive tech); while it scrolls, its tiles leave the FLIP glide
 * out, since the moving track would be replayed as movement.
 */
function PreparingList({ tickets, grid }: { tickets: DisplayTicket[]; grid: CSSProperties }) {
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [loop, setLoop] = useState(0);
  useLayoutEffect(() => {
    const vp = viewport.current;
    const ul = list.current;
    if (!vp || !ul) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(ul).rowGap) || 0;
      const next = ul.offsetHeight > vp.clientHeight + 1 ? ul.offsetHeight + gap : 0;
      setLoop((l) => (Math.abs(l - next) < 1 ? l : next));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(vp);
    ro?.observe(ul);
    void document.fonts?.ready.then(measure);
    return () => ro?.disconnect();
  }, []);
  const scrolling = loop > 0;
  const speed = (window.innerHeight * PREPARING_SCROLL_VH_PER_S) / 100;
  const track = scrolling ? ({ '--loop': `${loop}px`, animationDuration: `${Math.max(6, loop / speed)}s` } as CSSProperties) : undefined;
  const tiles = (copy: boolean) =>
    tickets.map((x) => (
      <li key={x.id} data-flip-id={copy || scrolling ? undefined : x.id} className="relative flex">
        <span className="tile-ready tile-preparing">{x.displayNumber}</span>
      </li>
    ));
  return (
    <div ref={viewport} className={`prep-viewport relative min-h-0 flex-1 overflow-hidden ${scrolling ? 'is-scrolling' : ''}`}>
      <div className={scrolling ? 'prep-track' : undefined} style={track}>
        <ul ref={list} className="grid content-start gap-[1.6vmin]" style={grid}>
          {tiles(false)}
        </ul>
        {scrolling && (
          <ul aria-hidden="true" className="mt-[1.6vmin] grid content-start gap-[1.6vmin]" style={grid}>
            {tiles(true)}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A label in the board language with the same words in the other one beneath (the board is always bilingual). */
function Bilingual({ main, alt, altLang, className = '', altClassName = '' }: { main: string; alt: string | null; altLang: string; className?: string; altClassName?: string }) {
  return (
    <span className={`flex flex-col gap-[0.6vmin] ${className}`}>
      <span>{main}</span>
      {alt && alt !== main && (
        <span lang={altLang} className={altClassName}>
          {alt}
        </span>
      )}
    </span>
  );
}

/** Column heading: the status word, the same word in the other board language, and the count. */
function ColumnHeading({ id, label, alt, altLang, count, live, tone }: { id: string; label: string; alt: string | null; altLang?: string | null; count: number; live?: boolean; tone: 'ink' | 'light' }) {
  const dark = tone === 'ink';
  return (
    <h2 id={id} className={`mb-[2.4vmin] flex flex-wrap items-baseline gap-x-[1.6vmin] gap-y-[1vmin] border-b pb-[1.8vmin] ${dark ? 'border-white/10' : 'border-line'}`}>
      {live !== undefined && <span aria-hidden="true" className={`live-dot self-center ${live ? 'is-live' : ''}`} />}
      <span className={`font-display text-[3.8vmin] leading-none font-bold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>{label}</span>
      {alt && (
        <span lang={altLang ?? undefined} className={`font-display text-[2.8vmin] leading-none font-semibold ${dark ? 'text-white/55' : 'text-muted'}`}>
          {alt}
        </span>
      )}
      <span className={`board-count ms-auto ${dark ? 'text-white/55' : 'text-muted'}`}>{count}</span>
    </h2>
  );
}

/** Live state for the Ready heading: connected and showing a fresh list. */
function useLive() {
  const connected = useDisplay((s) => s.connected);
  const resyncing = useDisplay((s) => s.resyncing);
  const stale = useDisplay((s) => s.stale);
  // Disconnected, reconnecting, or showing a list whose refresh failed (CSD04): never look current.
  const offline = connected === false || (connected === true && resyncing) || stale;
  return { offline, live: connected === true && !offline };
}

function Badges({ offline }: { offline: boolean }) {
  const { t } = useTranslation();
  const missing = useDisplay((s) => s.missingVoices);
  const soundOn = useDisplay((s) => s.soundEnabled);
  if (!offline && !missing.length && soundOn) return null;
  return (
    <div className="flex max-w-[30vmin] min-w-0 shrink flex-col items-end gap-[0.8vmin] text-[max(0.75rem,1.8vmin)] leading-tight font-semibold">
      {offline && (
        <span role="status" className="badge bg-danger-bg text-danger">
          <span aria-hidden="true" className="badge-mark bg-danger" />
          {t('common:reconnecting')}
        </span>
      )}
      {missing.map((l) => (
        <span key={l} className="badge bg-warn-bg text-warn">
          <span aria-hidden="true" className="badge-mark bg-warn" />
          {t('sound.noVoice', { language: t(`languages.${l}`, { defaultValue: l }) })}
        </span>
      ))}
      {!soundOn && (
        <span className="badge bg-canvas text-muted">
          <span aria-hidden="true" className="badge-mark border-[0.25vmin] border-muted" />
          {t('sound.off')}
        </span>
      )}
    </div>
  );
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/** Local time at the venue, refreshed every 10 seconds (latin digits, like the order numbers). */
function Clock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  const fmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
    } catch {
      return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
  }, [timeZone]);
  return <time className="board-clock">{fmt.format(now)}</time>;
}

/**
 * How many tiles fit completely in a grid list, measured from the browser's own layout (CSD03): resolved columns,
 * row gap, the list's height and one tile's layout height. Re-measured whenever the list is resized (viewport,
 * promo, the page indicator appearing). 0 until there is a layout to measure.
 */
function useGridCapacity(ref: RefObject<HTMLUListElement | null>, active: boolean, layoutKey: string) {
  const [capacity, setCapacity] = useState(0);
  useLayoutEffect(() => {
    const ul = ref.current;
    if (!active || !ul) return;
    const measure = () => {
      const cs = getComputedStyle(ul);
      const columns = cs.gridTemplateColumns.split(' ').filter((x) => /px$/.test(x)).length;
      // Layout height (transform-free) of the tallest of the first tiles; all tiles share one size. offsetHeight is
      // rounded to whole pixels, so allow one more: a vmin-sized tile can be up to a pixel taller than it reports.
      const tallest = Math.max(0, ...[...ul.children].slice(0, 4).map((c) => (c as HTMLElement).offsetHeight));
      const tileHeight = tallest > 0 ? tallest + 1 : 0;
      const next = gridCapacity({ height: ul.clientHeight, columns, rowGap: parseFloat(cs.rowGap) || 0, tileHeight });
      setCapacity((c) => (c === next ? c : next));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(ul);
    window.addEventListener('resize', measure);
    // Web fonts change the tile height once loaded.
    void document.fonts?.ready.then(measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, active, layoutKey]);
  return capacity;
}

/** Rotates Ready pages on a fixed interval while the list is longer than the grid (CSD03). */
function useReadyPages(board: Board, capacity: number, pinnedId: string | null) {
  const [start, setStart] = useState<ReadyKey | null>(null);
  const page = useMemo(() => readyPage(board.ready, capacity, start, pinnedId), [board.ready, capacity, start, pinnedId]);
  const next = useRef(page.next);
  next.current = page.next;
  const paged = page.pages > 1;
  useEffect(() => {
    if (!paged) {
      setStart(null);
      return;
    }
    // A steady interval, not reset by board updates, so a busy venue never stalls the rotation.
    const id = setInterval(() => setStart(next.current), READY_PAGE_MS);
    return () => clearInterval(id);
  }, [paged]);
  return page;
}

/** Promo content (FR-DSP-07): image and text side by side, clipped to its own box; it never outshines the numbers. */
const PROMO_HEIGHT: CSSProperties = { height: `${PROMO_STRIP_VH}vh` };

function PromoContent({ text, imageUrl, className }: { text: string; imageUrl: string | null; className: string }) {
  const { t } = useTranslation();
  return (
    <aside aria-label={t('promo.label')} className={`flex min-w-0 shrink-0 items-center gap-[2.2vmin] overflow-hidden rounded-[2.4vmin] bg-canvas p-[1.2vmin] pe-[2.6vmin] ${imageUrl ? '' : 'ps-[2.6vmin]'} ${className}`} style={PROMO_HEIGHT}>
      {imageUrl && <img src={imageUrl} alt="" className="h-full max-h-full w-auto max-w-[38%] shrink-0 rounded-[1.6vmin] object-cover" />}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.8vmin]">
        <span className="promo-tag">{t('promo.label')}</span>
        {text && <p className="line-clamp-3 min-w-0 text-[max(0.875rem,2.5vmin)] leading-snug font-semibold text-ink">{text}</p>}
      </div>
    </aside>
  );
}

/** The TV board (FR-DSP-02, FR-DSP-06): Ready at the inline end, Preparing optional, venue header and QR. */
export function BoardView({ board }: { board: Board }) {
  const { t, i18n } = useTranslation();
  const highlightId = useDisplay((s) => s.highlightId);
  const { offline, live } = useLive();
  const boardRef = useRef<HTMLElement>(null);
  const readyList = useRef<HTMLUListElement>(null);
  const readyGrid = useMemo(() => numberGrid(tileMinVmin(board.ready.map((x) => x.displayNumber))), [board.ready]);
  const preparingGrid = useMemo(() => numberGrid(tileMinVmin(board.preparing.map((x) => x.displayNumber), PREPARING_FONT_VMIN, PREPARING_MIN_VMIN)), [board.preparing]);
  // Re-measured when the column template changes (a longer number widens the tiles without resizing the list).
  const readyCapacity = useGridCapacity(readyList, board.ready.length > 0, String(readyGrid.gridTemplateColumns));
  const { shown, page, pages, hidden } = useReadyPages(board, readyCapacity, highlightId);
  // Preparing keeps the server's order (oldest first); new tickets join at the end. A list longer than the column
  // scrolls (PreparingList), so every number is on screen in turn.
  const preparing = board.preparing;
  // Numbers glide between Preparing and Ready, and close the gap when one leaves (one FLIP over both columns).
  useFlip(boardRef, [shown.map((x) => x.id).join(), preparing.map((x) => x.id).join()]);
  const style = useMemo(() => ({ ...(brandTokens(board.venue.brandColor, SURFACE) as CSSProperties), ...highlightTokens(board.venue.brandColor) }), [board.venue.brandColor]);
  useVenueFavicon(board.venue.logoUrl);
  const lang = i18n.language;
  const base = lang.split('-')[0] ?? lang;
  // The board is always bilingual: labels also appear in the other of Arabic and English.
  const altLang = base === 'ar' ? 'en' : 'ar';
  const altT = i18n.getFixedT(altLang);
  const message = board.settings.message[lang] ?? board.settings.message[base] ?? Object.values(board.settings.message)[0] ?? '';
  const highlighted = shown.find((x) => x.id === highlightId);
  const vp = useViewport();
  const promo = promoLayout({
    promo: board.settings.promo,
    lang,
    showPreparing: board.settings.showPreparing,
    // The strip is planned for the whole Ready list (not the measured page), so it never toggles with paging.
    readyShown: board.ready.length,
    readyMore: false,
    viewportW: vp.w,
    viewportH: vp.h,
  });

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-surface text-ink" style={style}>
      <div aria-hidden="true" className="h-[0.5vmin] shrink-0 bg-[var(--brand-band)]" />
      <header className="flex items-center gap-[2.4vmin] px-[4vmin] py-[2.4vmin] portrait:px-[3vmin]">
        {board.venue.logoUrl ? (
          <img src={board.venue.logoUrl} alt="" className="size-[7vmin] shrink-0 rounded-[1.6vmin] object-contain" />
        ) : (
          <BrandMark className="size-[7vmin]" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[0.6vmin]">
          <h1 className="truncate font-display text-[4.2vmin] leading-[1.15] font-extrabold tracking-tight">{board.venue.name}</h1>
          {message && <p className="truncate text-[max(0.875rem,2.3vmin)] leading-snug font-medium text-muted">{message}</p>}
        </div>
        <Badges offline={offline} />
        <Clock timeZone={board.venue.timeZone} />
        {board.settings.qr.show && (
          <figure className="flex shrink-0 items-center gap-[1.6vmin] border-s border-line ps-[2.4vmin]">
            <figcaption className="max-w-[18vmin] text-end text-[max(0.75rem,1.9vmin)] leading-snug font-semibold text-ink-2">
              <Bilingual altLang={altLang} main={t('scanToFollow')} alt={altT('scanToFollow')} altClassName="text-[max(0.6875rem,1.7vmin)] font-medium text-muted" />
            </figcaption>
            <QRCodeSVG value={board.venueUrl} size={256} level="M" bgColor={SURFACE} fgColor={INK} style={{ width: '10vmin', height: '10vmin', display: 'block' }} />
          </figure>
        )}
      </header>

      {/* Portrait: Ready on top, Preparing beneath, and slimmer gutters so the Ready grid fits three tiles across. */}
      <main ref={boardRef} className="flex min-h-0 flex-1 gap-[3vmin] px-[4vmin] pb-[3.4vmin] portrait:flex-col-reverse portrait:gap-[2.4vmin] portrait:px-[3vmin]">
        {board.settings.showPreparing && (
          <section aria-labelledby="col-preparing" className="flex min-h-0 min-w-0 flex-[2] flex-col rounded-[3.2vmin] bg-ink p-[3vmin] text-white portrait:p-[2.4vmin]">
            <ColumnHeading id="col-preparing" label={t('common:status.preparing')} alt={altT('common:status.preparing')} altLang={altLang} count={board.preparing.length} tone="ink" />
            {preparing.length > 0 && <PreparingList tickets={preparing} grid={preparingGrid} />}
            {preparing.length === 0 && <div className="flex-1" />}
            {promo.placement === 'preparing' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mt-[2vmin]" />}
          </section>
        )}
        <section aria-labelledby="col-ready" className="flex min-h-0 min-w-0 flex-[3] flex-col rounded-[3.2vmin] bg-ink p-[3vmin] text-white portrait:p-[2.4vmin]">
          <ColumnHeading id="col-ready" label={t('common:status.ready')} alt={altT('common:status.ready')} altLang={altLang} count={board.ready.length} live={live} tone="ink" />
          {shown.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-center text-[3.2vmin] font-medium text-white/40">
              <Bilingual altLang={altLang} main={t('emptyReady')} alt={altT('emptyReady')} className="items-center" altClassName="text-[2.6vmin] text-white/30" />
            </p>
          ) : (
            <ul ref={readyList} className="grid min-h-0 flex-1 content-start gap-[1.8vmin]" style={readyGrid}>
              {shown.map((x) => (
                <NumberTile key={x.id} t={x} highlighted={x.id === highlightId} />
              ))}
            </ul>
          )}
          {(pages > 1 || hidden > 0) && (
            <p data-testid="ready-overflow" className="mt-[1.4vmin] flex flex-wrap items-center justify-end gap-x-[2.4vmin] gap-y-[1vmin] text-[max(0.875rem,2.2vmin)] leading-none font-semibold text-white/60">
              {pages > 1 && (
                <span className="flex items-center gap-[1.4vmin]">
                  {/* Page marks: which page of the rotation is on screen. */}
                  <span aria-hidden="true" className="flex gap-[0.7vmin]">
                    {Array.from({ length: Math.min(pages, 8) }, (_, i) => (
                      <span key={i} className={`page-mark ${i === Math.min(page, 8) - 1 ? 'is-current' : ''}`} />
                    ))}
                  </span>
                  <span>{t('page', { x: page, y: pages })}</span>
                </span>
              )}
              {hidden > 0 && <span className="text-white">{t('more', { n: hidden })}</span>}
            </p>
          )}
        </section>
      </main>
      {promo.placement === 'strip' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mx-[4vmin] mb-[3vmin] portrait:mx-[3vmin]" />}
      <LiveRegion text={highlighted ? t('announce.one', { number: highlighted.displayNumber }) : ''} />
    </div>
  );
}
