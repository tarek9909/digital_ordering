import { brandTokens } from '@dop/client-sdk';
import type { DisplayTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { LiveRegion } from '@dop/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { gridCapacity, READY_PAGE_MS, readyPage, tileMinVmin, type Board, type ReadyKey } from '../lib/board';
import { PROMO_STRIP_VH, promoLayout } from '../lib/promo';
import { useDisplay } from '../lib/store';

// Platform palette (ember.css): white base, ink for weight, ember only for the number that just became ready.
const SURFACE = '#ffffff';
const INK = '#1c1917';
// Tiles are sized in vmin (the same as vh on a landscape TV, and not oversized on a portrait one). Columns are at
// least wide enough for the longest number; rows are as tall as their tile (max-content), so an `overflow: hidden`
// tile (the highlighted one) is never squashed (CSD03).
const numberGrid = (minVmin: number): CSSProperties => ({ gridTemplateColumns: `repeat(auto-fill, minmax(${minVmin}vmin, 1fr))`, gridAutoRows: 'max-content' });

function NumberTile({ t, highlighted }: { t: DisplayTicket; highlighted: boolean }) {
  return (
    <li
      className={`num flex items-center justify-center rounded-[2.2vmin] py-[1.2vmin] font-display text-[13vmin] leading-none font-bold ${
        highlighted ? 'ember-glow ready-pop bg-primary text-on-primary' : 'bg-white/[0.07] text-white'
      }`}
    >
      {t.displayNumber}
    </li>
  );
}

function Badges() {
  const { t } = useTranslation();
  const connected = useDisplay((s) => s.connected);
  const resyncing = useDisplay((s) => s.resyncing);
  const stale = useDisplay((s) => s.stale);
  const missing = useDisplay((s) => s.missingVoices);
  const soundOn = useDisplay((s) => s.soundEnabled);
  // Disconnected, reconnecting, or showing a list whose refresh failed (CSD04): never look current.
  const offline = connected === false || (connected === true && resyncing) || stale;
  return (
    <div className="flex flex-col items-end gap-[1vmin] text-[1.9vmin] font-semibold">
      {offline && (
        <span role="status" className="rounded-full bg-danger px-[2vmin] py-[0.6vmin] text-white">
          {t('common:reconnecting')}
        </span>
      )}
      {missing.map((l) => (
        <span key={l} className="rounded-full bg-warn-bg px-[2vmin] py-[0.6vmin] text-warn">
          {t('sound.noVoice', { language: t(`languages.${l}`, { defaultValue: l }) })}
        </span>
      ))}
      {!soundOn && <span className="rounded-full bg-canvas px-[2vmin] py-[0.6vmin] text-muted">{t('sound.off')}</span>}
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
      // Layout height (transform-free) of the tallest of the first tiles; all tiles share one size.
      const tileHeight = Math.max(0, ...[...ul.children].slice(0, 4).map((c) => (c as HTMLElement).offsetHeight));
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

/** Promo content (FR-DSP-07): image and text side by side, clipped to its own box. */
const PROMO_HEIGHT: CSSProperties = { height: `${PROMO_STRIP_VH}vh` };

function PromoContent({ text, imageUrl, className }: { text: string; imageUrl: string | null; className: string }) {
  const { t } = useTranslation();
  return (
    <aside aria-label={t('promo.label')} className={`flex min-w-0 shrink-0 items-center gap-[2vmin] overflow-hidden rounded-[2.2vmin] bg-canvas p-[1.5vmin] ${className}`} style={PROMO_HEIGHT}>
      {imageUrl && <img src={imageUrl} alt="" className="h-full max-h-full w-auto max-w-[40%] rounded-[1.4vmin] object-contain" />}
      {text && <p className="line-clamp-3 min-w-0 flex-1 text-[3vmin] leading-snug font-semibold text-ink">{text}</p>}
    </aside>
  );
}

/** The TV board (FR-DSP-02, FR-DSP-06): Ready at the inline end, Preparing optional, venue header and QR. */
export function BoardView({ board }: { board: Board }) {
  const { t, i18n } = useTranslation();
  const highlightId = useDisplay((s) => s.highlightId);
  const readyList = useRef<HTMLUListElement>(null);
  const preparingList = useRef<HTMLUListElement>(null);
  const readyGrid = useMemo(() => numberGrid(tileMinVmin(board.ready.map((x) => x.displayNumber))), [board.ready]);
  const preparingGrid = useMemo(() => numberGrid(tileMinVmin(board.preparing.map((x) => x.displayNumber), 11)), [board.preparing]);
  // Re-measured when the column template changes (a longer number widens the tiles without resizing the list).
  const readyCapacity = useGridCapacity(readyList, board.ready.length > 0, String(readyGrid.gridTemplateColumns));
  const { shown, page, pages, hidden } = useReadyPages(board, readyCapacity, highlightId);
  // Preparing keeps the server's order (oldest first); new tickets join at the end. Only whole numbers are shown;
  // the rest are counted (Preparing is informational, so it is capped rather than rotated).
  const preparingCapacity = useGridCapacity(preparingList, board.settings.showPreparing && board.preparing.length > 0, String(preparingGrid.gridTemplateColumns));
  const preparingCap = preparingCapacity > 0 && board.preparing.length > preparingCapacity ? preparingCapacity : board.preparing.length;
  const preparing = board.preparing.slice(0, preparingCap);
  const preparingMore = board.preparing.length - preparing.length;
  // The venue's own colour marks the top edge; the platform palette (ink, ember) does the rest.
  const brand = brandTokens(board.venue.brandColor, SURFACE) as CSSProperties;
  const lang = i18n.language;
  const message = board.settings.message[lang] ?? Object.values(board.settings.message)[0] ?? '';
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
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-surface text-ink" style={brand}>
      <div aria-hidden="true" className="h-[0.9vmin] shrink-0 bg-[var(--brand-band)]" />
      <header className="flex items-center gap-[3vmin] px-[4vmin] pt-[2.5vmin] pb-[2vmin]">
        {board.venue.logoUrl && <img src={board.venue.logoUrl} alt="" className="h-[10vmin] w-auto rounded-[1.4vmin] object-contain" />}
        <div className="flex min-w-0 flex-1 flex-col gap-[0.5vmin]">
          <h1 className="truncate font-display text-[5.2vmin] leading-tight font-bold">{board.venue.name}</h1>
          {message && <p className="truncate text-[2.8vmin] text-muted">{message}</p>}
        </div>
        <Badges />
        {board.settings.qr.show && (
          <figure className="flex items-center gap-[2vmin] rounded-[2.2vmin] bg-canvas p-[1.4vmin] pe-[2.4vmin]">
            <QRCodeSVG value={board.venueUrl} size={256} level="M" bgColor="#ffffff" fgColor={INK} style={{ width: '13vmin', height: '13vmin', display: 'block', borderRadius: '1vmin' }} />
            <figcaption className="max-w-[22vmin] text-[2.2vmin] leading-snug font-semibold text-ink-2">{t('scanToFollow')}</figcaption>
          </figure>
        )}
      </header>

      <main className="flex min-h-0 flex-1 gap-[2.5vmin] px-[4vmin] pb-[4vmin] portrait:flex-col">
        {board.settings.showPreparing && (
          <section aria-labelledby="col-preparing" className="flex min-h-0 min-w-0 flex-[2] flex-col rounded-[3vmin] border-[0.3vmin] border-line p-[3vmin]">
            <h2 id="col-preparing" className="mb-[2.5vmin] flex items-baseline gap-[2vmin]">
              <span className="font-display text-[5vmin] leading-none font-bold text-ink-2">{t('common:status.preparing')}</span>
              <span className="board-label text-muted">{board.preparing.length}</span>
            </h2>
            <ul ref={preparingList} className="grid min-h-0 flex-1 content-start gap-x-[2vmin] gap-y-[1vmin] overflow-hidden" style={preparingGrid}>
              {preparing.map((x) => (
                <li key={x.id} className="num flex items-center justify-center py-[1vmin] font-display text-[11vmin] leading-none font-semibold text-muted">
                  {x.displayNumber}
                </li>
              ))}
            </ul>
            {preparingMore > 0 && <p className="mt-[1vmin] text-end font-display text-[3vmin] font-bold text-muted">{t('more', { n: preparingMore })}</p>}
            {promo.placement === 'preparing' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mt-[2vmin]" />}
          </section>
        )}
        <section aria-labelledby="col-ready" className="flex min-h-0 min-w-0 flex-[3] flex-col rounded-[3vmin] bg-ink p-[3vmin] text-white">
          <h2 id="col-ready" className="mb-[2.5vmin] flex items-baseline gap-[2vmin]">
            <span className="font-display text-[5vmin] leading-none font-bold">{t('common:status.ready')}</span>
            <span className="board-label text-white/55">{board.ready.length}</span>
          </h2>
          {shown.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-[3.6vmin] text-white/55">{t('emptyReady')}</p>
          ) : (
            <ul ref={readyList} className="grid min-h-0 flex-1 content-start gap-[1.8vmin] overflow-hidden" style={readyGrid}>
              {shown.map((x) => (
                <NumberTile key={x.id} t={x} highlighted={x.id === highlightId} />
              ))}
            </ul>
          )}
          {(pages > 1 || hidden > 0) && (
            <p data-testid="ready-overflow" className="mt-[1.5vmin] flex items-baseline justify-end gap-[2vmin] font-display text-[3.4vmin] font-bold text-white/80">
              {pages > 1 && (
                <span className="flex items-center gap-[1vmin]">
                  {/* Page dots: which page of the rotation is on screen. */}
                  <span aria-hidden="true" className="flex gap-[0.8vmin]">
                    {Array.from({ length: Math.min(pages, 8) }, (_, i) => (
                      <span key={i} className={`inline-block size-[1.4vmin] rounded-full ${i === Math.min(page, 8) - 1 ? 'bg-white' : 'bg-white/30'}`} />
                    ))}
                  </span>
                  <span>{t('page', { x: page, y: pages })}</span>
                </span>
              )}
              {hidden > 0 && <span>{t('more', { n: hidden })}</span>}
            </p>
          )}
        </section>
      </main>
      {promo.placement === 'strip' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mx-[4vmin] mb-[3vmin]" />}
      <LiveRegion text={highlighted ? t('announce.one', { number: highlighted.displayNumber }) : ''} />
    </div>
  );
}
