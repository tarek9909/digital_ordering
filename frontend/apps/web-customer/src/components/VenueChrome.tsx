import type { VenueBranding } from '@dop/contracts';
import { i18next, useTranslation } from '@dop/i18n';
import { chooseLanguage } from '../lib/lang';
import { Link } from '../lib/router';

// Venue header and footer: logo, name, language switch, website link as a plain domain (NFR-SEC-06),
// "Powered by" line (FR-BIL-08), privacy notice link (FR-QR-09).

const plainDomain = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

export function VenueHeader({ venue }: { venue: VenueBranding }) {
  const { t } = useTranslation();
  const other = venue.locales.find((l) => l !== i18next.language);
  return (
    <header className="relative flex items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
      {/* A hairline of the venue's colour: the venue frames the page, its colour leads. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: 'var(--brand-band)' }} />
      <div className="flex min-w-0 items-center gap-3 pt-1">
        {venue.logoUrl ? (
          <img src={venue.logoUrl} alt="" className="size-11 shrink-0 rounded-[0.875rem] bg-white object-contain p-1 ring-1 ring-line" />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-[0.875rem] font-display text-lg font-extrabold"
            style={{ background: 'var(--brand-band)', color: 'var(--on-band)' }}
          >
            {Array.from(venue.name.trim())[0] ?? ''}
          </span>
        )}
        <span dir="auto" className="truncate font-display text-[1.0625rem] font-bold tracking-tight">
          {venue.name}
        </span>
      </div>
      {other && (
        <button
          className="mt-1 min-h-12 shrink-0 rounded-control px-4 text-sm font-semibold text-ink-2 ring-1 ring-line transition-colors hover:bg-canvas active:scale-[.98]"
          onClick={() => chooseLanguage(other)}
          lang={other}
        >
          {t('language')}
        </button>
      )}
    </header>
  );
}

export function VenueFooter({ venue }: { venue: VenueBranding }) {
  const { t } = useTranslation();
  const website = venue.messages[i18next.language]?.websiteUrl ?? venue.messages[venue.locales[0] ?? 'ar']?.websiteUrl;
  const domain = website ? plainDomain(website) : null;
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-muted">
      {domain && (
        <a href={website} rel="noopener noreferrer nofollow" target="_blank" className="inline-flex min-h-12 items-center underline decoration-line underline-offset-4 hover:text-ink">
          {domain}
        </a>
      )}
      <Link to="/privacy" className="inline-flex min-h-12 items-center underline decoration-line underline-offset-4 hover:text-ink">
        {t('privacy.title')}
      </Link>
      {venue.showPoweredBy && <span className="inline-flex min-h-12 items-center">{t('common:poweredBy')}</span>}
    </footer>
  );
}
