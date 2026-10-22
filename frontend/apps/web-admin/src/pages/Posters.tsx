import { useTranslation } from '@dop/i18n';
import { Select } from '@dop/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { Section } from '../components/common';
import { useCurrentVenueId, useVenue } from '../lib/venue';

const KINDS = ['a4', 'tent', 'door'] as const;

/** PDF posters from the API plus a browser-printable Arabic poster (FR-ADM, Plan §8.1). */
export function PostersPage() {
  const { t } = useTranslation();
  const venueId = useCurrentVenueId();
  const venue = useVenue(venueId).data;
  const [locale, setLocale] = useState<string>('ar');
  const locales = venue?.locales ?? ['ar', 'en'];
  if (!venueId) return null;
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t('nav.posters')}</h1>
      <Section title={t('posters.pdfTitle')} description={t('posters.pdfHint')}>
        <Select
          className="mb-4 max-w-xs"
          label={t('posters.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          options={locales.map((l) => ({ value: l, label: t(`languages.${l}`, { defaultValue: l }) }))}
        />
        <ul className="grid gap-3 sm:grid-cols-3">
          {KINDS.map((k) => (
            <li key={k}>
              <a
                className="flex min-h-16 flex-col justify-center rounded-[var(--radius-card)] border border-line bg-surface p-4 font-semibold hover:bg-canvas"
                href={`/api/admin/v1/venues/${venueId}/posters/${k}.pdf?locale=${encodeURIComponent(locale)}`}
                download={`qr-${k}.pdf`}
              >
                {t(`posters.kinds.${k}`)}
                <span className="text-sm font-normal text-muted">{t(`posters.kindHints.${k}`)}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t('posters.printTitle')} description={t('posters.printHint')}>
        <Link to="/posters/print" className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 font-semibold text-on-primary">
          {t('posters.openPrint')}
        </Link>
      </Section>
    </>
  );
}
