import { brandTokens } from '@dop/client-sdk';
import type { DisplayTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { LiveRegion } from '@dop/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { readyView, type Board } from '../lib/board';
import { PROMO_STRIP_VH, promoLayout } from '../lib/promo';
import { useDisplay } from '../lib/store';

// Platform palette (ember.css): white base, ink for weight, ember only for the number that just became ready.
const SURFACE = '#ffffff';
const INK = '#1c1917';
const NUMBER_GRID: CSSProperties = { gridTemplateColumns: 'repeat(auto-fill, minmax(28vh, 1fr))' };

function NumberTile({ t, highlighted }: { t: DisplayTicket; highlighted: boolean }) {
  return (
    <li
      className={`num flex items-center justify-center rounded-[2.2vmin] py-[1.2vh] font-display text-[13vh] leading-none font-bold ${
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
  const missing = useDisplay((s) => s.missingVoices);
  const soundOn = useDisplay((s) => s.soundEnabled);
  const offline = connected === false || (connected === true && resyncing);
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
  const { shown, more } = useMemo(() => readyView(board.ready), [board.ready]);
  // Preparing keeps the server's order (oldest first); new tickets join at the end.
  const preparing = board.preparing;
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
    readyShown: shown.length,
    readyMore: more > 0,
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
              <span className="board-label text-muted">{preparing.length}</span>
            </h2>
            <ul className="grid min-h-0 flex-1 content-start gap-x-[2vmin] gap-y-[1vmin] overflow-hidden" style={NUMBER_GRID}>
              {preparing.map((x) => (
                <li key={x.id} className="num flex items-center justify-center py-[1vh] font-display text-[11vh] leading-none font-semibold text-muted">
                  {x.displayNumber}
                </li>
              ))}
            </ul>
            {promo.placement === 'preparing' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mt-[2vmin]" />}
          </section>
        )}
        <section aria-labelledby="col-ready" className="flex min-h-0 min-w-0 flex-[3] flex-col rounded-[3vmin] bg-ink p-[3vmin] text-white">
          <h2 id="col-ready" className="mb-[2.5vmin] flex items-baseline gap-[2vmin]">
            <span className="font-display text-[5vmin] leading-none font-bold">{t('common:status.ready')}</span>
            <span className="board-label text-white/55">{shown.length + more}</span>
          </h2>
          {shown.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-[3.6vmin] text-white/55">{t('emptyReady')}</p>
          ) : (
            <ul className="grid min-h-0 flex-1 content-start gap-[1.8vmin] overflow-hidden" style={NUMBER_GRID}>
              {shown.map((x) => (
                <NumberTile key={x.id} t={x} highlighted={x.id === highlightId} />
              ))}
            </ul>
          )}
          {more > 0 && <p className="mt-[1.5vmin] text-end font-display text-[3.4vmin] font-bold text-white/80">{t('more', { n: more })}</p>}
        </section>
      </main>
      {promo.placement === 'strip' && <PromoContent text={promo.text} imageUrl={promo.imageUrl} className="mx-[4vmin] mb-[3vmin]" />}
      <LiveRegion text={highlighted ? t('announce.one', { number: highlighted.displayNumber }) : ''} />
    </div>
  );
}
