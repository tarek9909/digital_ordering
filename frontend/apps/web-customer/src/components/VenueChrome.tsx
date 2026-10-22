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
    <header className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: 'var(--brand-band)', color: 'var(--on-band)' }}>
      <div className="flex items-center gap-3">
        {venue.logoUrl && <img src={venue.logoUrl} alt="" className="size-10 rounded-xl bg-white object-contain p-0.5" />}
        <span className="font-display text-lg font-bold">{venue.name}</span>
      </div>
      {other && (
        <button className="min-h-12 rounded-full border border-current/30 px-4 text-sm font-semibold" onClick={() => chooseLanguage(other)} lang={other}>
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
    <footer className="flex flex-col items-center gap-1 px-4 py-4 text-sm text-muted">
      {domain && (
        <a href={website} rel="noopener noreferrer nofollow" target="_blank" className="underline">
          {domain}
        </a>
      )}
      <Link to="/privacy" className="underline">
        {t('privacy.title')}
      </Link>
      {venue.showPoweredBy && <span>{t('common:poweredBy')}</span>}
    </footer>
  );
}
