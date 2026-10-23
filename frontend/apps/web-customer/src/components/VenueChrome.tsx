import type { VenueBranding } from '@dop/contracts';
import { i18next, useTranslation } from '@dop/i18n';
import { BrandMark, useVenueFavicon } from '@dop/ui';
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
  // Arabic and English are always offered, whichever the venue set as its default.
  const other = i18next.language.startsWith('ar') ? 'en' : 'ar';
  useVenueFavicon(venue.logoUrl);
  return (
    <header className="safe-x mx-auto flex w-full max-w-xl items-center justify-between gap-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {venue.logoUrl ? (
          <img src={venue.logoUrl} alt="" className="size-9 shrink-0 rounded-full bg-white object-contain" />
        ) : (
          // No logo uploaded: the venue goes out under the Tanbeeh mark.
          <BrandMark className="size-9 shrink-0" />
        )}
        <span dir="auto" className="truncate text-base font-semibold">
          {venue.name}
        </span>
      </div>
      <button
        className="-me-2 min-h-12 shrink-0 rounded-control px-3 text-sm font-medium text-muted transition-colors hover:text-ink"
        onClick={() => chooseLanguage(other)}
        lang={other}
      >
        {t('language')}
      </button>
    </header>
  );
}

export function VenueFooter({ venue }: { venue: VenueBranding }) {
  const { t } = useTranslation();
  const website = venue.messages[i18next.language]?.websiteUrl ?? venue.messages[venue.locales[0] ?? 'ar']?.websiteUrl;
  const domain = website ? plainDomain(website) : null;
  return (
    <footer className="safe-x flex flex-wrap items-center justify-center gap-x-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs text-muted">
      {domain && (
        <a href={website} rel="noopener noreferrer nofollow" target="_blank" className="inline-flex min-h-12 max-w-full items-center break-all hover:text-ink">
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
