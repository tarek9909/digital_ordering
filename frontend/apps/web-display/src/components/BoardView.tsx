import { brandTokens, contrast, textOn } from '@dop/client-sdk';
import type { DisplayTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { LiveRegion, useFlip, useMoment } from '@dop/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { gridCapacity, READY_PAGE_MS, readyPage, tileMinVmin, type Board, type ReadyKey } from '../lib/board';
import { PROMO_STRIP_VH, promoLayout } from '../lib/promo';
import { useDisplay } from '../lib/store';

// Platform frame (ember.css): white base, an ink Ready column for weight. The venue's colour marks the top edge and
// the number that just became ready (ember when the venue colour would not read on ink).
const SURFACE = '#ffffff';
const INK = '#1c1917';
/** Preparing is informational: smaller, quieter numbers in narrower tiles. */
const PREPARING_FONT_VMIN = 8;
const PREPARING_MIN_VMIN = 17;
/** The landing pulse is removed once it has radiated, so it never adds to the tile's box. */
const PULSE_MS = 2_200;
// Tiles are sized in vmin (the same as vh on a landscape TV, and not oversized on a portrait one). Columns are at
// least wide enough for the longest number; rows are as tall as their tile (max-content), so a tile is never
// squashed (CSD03).
const numberGrid = (minVmin: number): CSSProperties => ({ gridTemplateColumns: `repeat(auto-fill, minmax(${minVmin}vmin, 1fr))`, gridAutoRows: 'max-content' });

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

/** Column heading: the status word, the same word in the second announcement language, and the count. */
function ColumnHeading({ id, label, alt, count, live, tone }: { id: string; label: string; alt: string | null; count: number; live?: boolean; tone: 'ink' | 'light' }) {
  const dark = tone === 'ink';
  return (
    <h2 id={id} className="mb-[2.4vmin] flex items-center gap-[1.6vmin]">
      {live !== undefined && <span aria-hidden="true" className={`live-dot ${live ? 'is-live' : ''}`} />}
      <span className={`font-display leading-none font-bold tracking-tight ${dark ? 'text-[4.6vmin] text-white' : 'text-[3.6vmin] text-ink-2'}`}>{label}</span>
      {alt && <span className={`font-display text-[2.6vmin] leading-none font-semibold ${dark ? 'text-white/45' : 'text-muted/80'}`}>{alt}</span>}
      <span className={`board-count ms-auto ${dark ? 'bg-white/10 text-white/80' : 'bg-ink/[0.06] text-ink-2'}`}>{count}</span>
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
    <div className="flex flex-col items-end gap-[0.8vmin] text-[1.8vmin] leading-tight font-semibold">
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
    <aside aria-label={t('promo.label')} className={`flex min-w-0 shrink-0 items-center gap-[2.2vmin] overflow-hidden rounded-[2.4vmin] bg-surface p-[1.4vmin] pe-[2.6vmin] shadow-card ${className}`} style={PROMO_HEIGHT}>
      {imageUrl && <img src={imageUrl} alt="" className="h-full max-h-full w-auto max-w-[38%] shrink-0 rounded-[1.6vmin] object-cover" />}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.8vmin]">
        <span className="promo-tag">{t('promo.label')}</span>
        {text && <p className="line-clamp-3 min-w-0 text-[2.5vmin] leading-snug font-semibold text-ink">{text}</p>}
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
  const preparingList = useRef<HTMLUListElement>(null);
  const readyGrid = useMemo(() => numberGrid(tileMinVmin(board.ready.map((x) => x.displayNumber))), [board.ready]);
  const preparingGrid = useMemo(() => numberGrid(tileMinVmin(board.preparing.map((x) => x.displayNumber), PREPARING_FONT_VMIN, PREPARING_MIN_VMIN)), [board.preparing]);
  // Re-measured when the column template changes (a longer number widens the tiles without resizing the list).
  const readyCapacity = useGridCapacity(readyList, board.ready.length > 0, String(readyGrid.gridTemplateColumns));
  const { shown, page, pages, hidden } = useReadyPages(board, readyCapacity, highlightId);
  // Preparing keeps the server's order (oldest first); new tickets join at the end. Only whole numbers are shown;
  // the rest are counted (Preparing is informational, so it is capped rather than rotated).
  const preparingCapacity = useGridCapacity(preparingList, board.settings.showPreparing && board.preparing.length > 0, String(preparingGrid.gridTemplateColumns));
  const preparingCap = preparingCapacity > 0 && board.preparing.length > preparingCapacity ? preparingCapacity : board.preparing.length;
  const preparing = board.preparing.slice(0, preparingCap);
  const preparingMore = board.preparing.length - preparing.length;
  // Numbers glide between Preparing and Ready, and close the gap when one leaves (one FLIP over both columns).
  useFlip(boardRef, [shown.map((x) => x.id).join(), preparing.map((x) => x.id).join()]);
  const style = useMemo(() => ({ ...(brandTokens(board.venue.brandColor, SURFACE) as CSSProperties), ...highlightTokens(board.venue.brandColor) }), [board.venue.brandColor]);
  const lang = i18n.language;
  const base = lang.split('-')[0] ?? lang;
  // Bilingual venues: the column names also appear in the second announcement language.
  const altLang = board.settings.announce.languages.map((l) => l.split('-')[0]).find((l) => (l === 'ar' || l === 'en') && l !== base) ?? null;
  const altT = altLang ? i18n.getFixedT(altLang, 'common') : null;
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
      <div aria-hidden="true" className="h-[0.7vmin] shrink-0 bg-[var(--brand-band)]" />
      <header className="flex items-center gap-[2.6vmin] px-[4vmin] pt-[2.4vmin] pb-[2.2vmin]">
        {board.venue.logoUrl && <img src={board.venue.logoUrl} alt="" className="size-[9.5vmin] shrink-0 rounded-[2vmin] object-contain" />}
        <div className="flex min-w-0 flex-1 flex-col gap-[0.8vmin]">
          <h1 className="line-clamp-2 font-display text-[4.8vmin] leading-[1.1] break-words font-extrabold tracking-tight">{board.venue.name}</h1>
          {message && <p className="truncate text-[2.6vmin] leading-snug font-medium text-ink-2">{message}</p>}
        </div>
        <Badges offline={offline} />
        {board.settings.qr.show && (
          <figure className="flex shrink-0 items-center gap-[1.8vmin] rounded-[2.2vmin] bg-canvas p-[1.2vmin] pe-[2.2vmin]">
            <span className="rounded-[1.2vmin] bg-surface p-[0.8vmin]">
              <QRCodeSVG value={board.venueUrl} size={256} level="M" bgColor={SURFACE} fgColor={INK} style={{ width: '11vmin', height: '11vmin', display: 'block' }} />
            </span>
            <figcaption className="max-w-[19vmin] text-[2.1vmin] leading-snug font-semibold text-ink-2">{t('scanToFollow')}</figcaption>
          </figure>
        )}
      </header>

      <main ref={boardRef} className="flex min-h-0 flex-1 gap-[2.4vmin] px-[4vmin] pb-[3.4vmin] portrait:flex-col">
        {board.settings.showPreparing && (
          <section aria-labelledby="col-preparing" className="flex min-h-0 min-w-0 flex-[2] flex-col rounded-[3.2vmin] bg-canvas p-[3vmin]">
            <ColumnHeading id="col-preparing" label={t('common:status.preparing')} alt={altT ? altT('status.preparing') : null} count={board.preparing.length} tone="light" />
            <ul ref={preparingList} className="grid min-h-0 flex-1 content-start gap-x-[1.6vmin] gap-y-[0.6vmin]" style={preparingGrid}>
              {preparing.map((x) => (
                <li key={x.id} data-flip-id={x.id} className="num flex items-center justify-center py-[1vmin] font-display text-[8vmin] leading-none font-semibold tracking-[-0.01em] text-muted">
                  {x.displayNumber}
                </li>
              ))}
            </ul>
            {preparingMore > 0 && <p className="mt-[1vmin] text-end font-display text-[2.6vmin] font-semibold text-muted">{t('more', { n: preparingMore })}</p>}
            {promo.placement === 'preparing' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mt-[2vmin]" />}
          </section>
        )}
        <section aria-labelledby="col-ready" className="flex min-h-0 min-w-0 flex-[3] flex-col rounded-[3.2vmin] bg-ink p-[3vmin] text-white">
          <ColumnHeading id="col-ready" label={t('common:status.ready')} alt={altT ? altT('status.ready') : null} count={board.ready.length} live={live} tone="ink" />
          {shown.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-center text-[3.4vmin] font-medium text-white/50">{t('emptyReady')}</p>
          ) : (
            <ul ref={readyList} className="grid min-h-0 flex-1 content-start gap-[1.8vmin]" style={readyGrid}>
              {shown.map((x) => (
                <NumberTile key={x.id} t={x} highlighted={x.id === highlightId} />
              ))}
            </ul>
          )}
          {(pages > 1 || hidden > 0) && (
            <p data-testid="ready-overflow" className="mt-[1.4vmin] flex items-center justify-end gap-[2.4vmin] text-[2.4vmin] leading-none font-semibold text-white/70">
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
              {hidden > 0 && <span className="rounded-full bg-white/10 px-[1.6vmin] py-[0.8vmin] text-white">{t('more', { n: hidden })}</span>}
            </p>
          )}
        </section>
      </main>
      {promo.placement === 'strip' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mx-[4vmin] mb-[3vmin]" />}
      <LiveRegion text={highlighted ? t('announce.one', { number: highlighted.displayNumber }) : ''} />
    </div>
  );
}
