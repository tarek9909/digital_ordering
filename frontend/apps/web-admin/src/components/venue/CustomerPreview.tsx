import { brandTokens, dirOf } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { BrandMark } from '@dop/ui';
import { useState, type CSSProperties } from 'react';

/**
 * Live customer page preview (TRD §16.5): the ticket number and the status band in the venue colour, with the
 * same contrast rules as the customer app (TR-FE-07). Uses the venue's primary language for the sample texts.
 */
export function CustomerPreview({ name, brandColor, logoUrl, welcome, locale }: { name: string; brandColor: string; logoUrl: string | null; welcome?: string; locale: string }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<'preparing' | 'ready'>('ready');
  const valid = /^#[0-9A-Fa-f]{6}$/.test(brandColor) ? brandColor : '#1F6FEB';
  const tokens = brandTokens(valid) as unknown as CSSProperties;
  const pt = i18n.getFixedT(locale);
  return (
    <figure className="flex flex-col items-center gap-3">
      <div role="group" aria-label={t('venue.preview.statusLabel')} className="inline-flex gap-1 rounded-control border border-line bg-surface p-1">
        {(['preparing', 'ready'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-12 rounded-control px-4 font-semibold transition-colors ${status === s ? 'bg-panel text-white shadow-button' : 'text-ink-2 hover:bg-canvas'}`}
          >
            {t(`common:status.${s}`)}
          </button>
        ))}
      </div>
      <div
        style={tokens}
        dir={dirOf(locale)}
        lang={locale}
        aria-label={t('venue.preview.title')}
        className="flex w-64 max-w-full flex-col overflow-hidden rounded-[2rem] border-8 border-ink bg-surface text-ink shadow-dialog"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-3">
          {logoUrl ? <img src={logoUrl} alt="" className="size-10 rounded object-contain" /> : <BrandMark className="size-10" />}
          <span className="truncate font-bold">{name || '—'}</span>
        </div>
        <div className="flex flex-col items-center gap-1 px-3 py-6">
          <span className="text-sm text-muted">{pt('venue.preview.yourNumber')}</span>
          <span className="num text-7xl font-black">42</span>
        </div>
        <div className={`px-3 py-4 text-center text-2xl font-bold ${status === 'ready' ? 'bg-[var(--brand-band)] text-[var(--on-band)]' : 'bg-line text-ink'}`}>
          <span aria-hidden="true">{status === 'ready' ? '✓ ' : '… '}</span>
          {pt(`common:status.${status}`)}
        </div>
        <p className="min-h-16 px-3 py-3 text-center text-sm">{status === 'ready' ? pt('venue.preview.readyText') : welcome || pt('venue.preview.welcomeDefault')}</p>
      </div>
      <figcaption className="text-sm text-muted">{t('venue.preview.caption')}</figcaption>
    </figure>
  );
}
