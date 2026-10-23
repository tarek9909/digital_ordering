import { brandTokens } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { QRCodeSVG } from 'qrcode.react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { QueryView, linkClass } from '../components/common';
import { useCurrentVenueId, useVenue } from '../lib/venue';

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  html, body { background: #ffffff !important; }
  .poster-sheet { box-shadow: none !important; border: none !important; width: 100% !important; min-height: auto !important; }
}
`;

/** Browser-printable Arabic poster with the venue QR (customers scan it to follow their order). */
export function PosterPrintPage() {
  const { t, i18n } = useTranslation();
  const ar = i18n.getFixedT('ar');
  const venueId = useCurrentVenueId();
  const q = useVenue(venueId);
  return (
    <div className="min-h-dvh bg-canvas p-4 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/posters" className={linkClass('secondary')}>
          {t('common:back')}
        </Link>
        <Button onClick={() => window.print()}>{t('posters.print')}</Button>
      </div>
      <QueryView q={q}>
        {(v) => (
          <article
            lang="ar"
            dir="rtl"
            style={brandTokens(/^#[0-9A-Fa-f]{6}$/.test(v.brandColor) ? v.brandColor : '#1F6FEB') as unknown as CSSProperties}
            className="poster-sheet mx-auto flex min-h-[297mm] w-[210mm] max-w-full flex-col items-center justify-between gap-6 border border-line bg-white p-[12mm] text-center text-[#111827] shadow-lg"
          >
            <header className="flex flex-col items-center gap-3">
              {v.logoUrl && <img src={v.logoUrl} alt="" className="h-24 object-contain" />}
              <h1 className="text-5xl font-black">{v.name}</h1>
            </header>
            <div className="w-full rounded-2xl bg-[var(--brand-band)] px-6 py-5 text-[var(--on-band)]">
              <p className="text-4xl font-bold">{ar('posters.sheet.headline')}</p>
            </div>
            <div className="rounded-2xl border-8 border-[var(--brand-band)] bg-white p-4">
              <QRCodeSVG value={v.venueUrl} size={320} level="M" role="img" aria-label={t('posters.qrLabel')} />
            </div>
            <ol className="flex flex-col gap-3 text-2xl">
              <li>١. {ar('posters.sheet.step1')}</li>
              <li>٢. {ar('posters.sheet.step2')}</li>
              <li>٣. {ar('posters.sheet.step3')}</li>
            </ol>
            <footer className="flex flex-col items-center gap-1 text-lg text-[#4b5563]">
              <span>{ar('posters.sheet.noApp')}</span>
              <span dir="ltr" className="font-mono text-base">
                {v.venueUrl}
              </span>
            </footer>
          </article>
        )}
      </QueryView>
    </div>
  );
}
