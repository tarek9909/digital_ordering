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
    <header className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {venue.logoUrl ? (
          <img src={venue.logoUrl} alt="" className="size-9 shrink-0 rounded-full bg-white object-contain" />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full font-display text-base font-bold"
            style={{ background: 'var(--brand-band)', color: 'var(--on-band)' }}
          >
            {Array.from(venue.name.trim())[0] ?? ''}
          </span>
        )}
        <span dir="auto" className="truncate text-base font-semibold">
          {venue.name}
        </span>
      </div>
      {other && (
        <button
          className="-me-2 min-h-12 shrink-0 rounded-control px-3 text-sm font-medium text-muted transition-colors hover:text-ink"
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
    <footer className="flex flex-wrap items-center justify-center gap-x-4 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs text-muted">
      {domain && (
        <a href={website} rel="noopener noreferrer nofollow" target="_blank" className="inline-flex min-h-12 items-center hover:text-ink">
          {domain}
        </a>
      )}
      <Link to="/privacy" className="inline-flex min-h-12 items-center hover:text-ink">
        {t('privacy.title')}
      </Link>
      {venue.showPoweredBy && <span className="inline-flex min-h-12 items-center">{t('common:poweredBy')}</span>}
    </footer>
  );
}
