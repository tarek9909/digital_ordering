import { useTranslation } from '@dop/i18n';
import { PageShell, Select } from '@dop/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { Section, linkClass, usePageEyebrow } from '../components/common';
import { useCurrentVenueId, useVenue } from '../lib/venue';

const KINDS = ['a4', 'tent', 'door'] as const;

/** PDF posters from the API plus a browser-printable Arabic poster (FR-ADM, Plan §8.1). */
export function PostersPage() {
  const { t } = useTranslation();
  const venueId = useCurrentVenueId();
  const venue = useVenue(venueId).data;
  const [locale, setLocale] = useState<string>('ar');
  const locales = venue?.locales ?? ['ar', 'en'];
  const eyebrow = usePageEyebrow('venue');
  if (!venueId) return null;
  return (
    <PageShell eyebrow={eyebrow} title={t('nav.posters')} description={t('posters.description')}>
      <Section title={t('posters.pdfTitle')} description={t('posters.pdfHint')}>
        <Select
          className="mb-4 max-w-xs"
          label={t('posters.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          options={locales.map((l) => ({
            value: l,
            label: t(`languages.${l}`, { defaultValue: l }),
          }))}
        />
        <ul data-motion="stagger" className="grid gap-3 sm:grid-cols-3">
          {KINDS.map((k) => (
            <li key={k}>
              <a
                className="group flex h-full min-h-16 flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-ink-2/30 hover:bg-primary-wash"
                href={`/api/admin/v1/venues/${venueId}/posters/${k}.pdf?locale=${encodeURIComponent(locale)}`}
                download={`qr-${k}.pdf`}
              >
                <PaperShape kind={k} />
                <span className="flex flex-col gap-1">
                  <span className="font-display font-bold">{t(`posters.kinds.${k}`)}</span>
                  <span className="text-sm text-muted">{t(`posters.kindHints.${k}`)}</span>
                </span>
                <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 group-hover:text-ink">
                  <span aria-hidden="true">↓</span>
                  {t('posters.downloadPdf')}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t('posters.printTitle')} description={t('posters.printHint')}>
        <Link to="/posters/print" className={linkClass('primary')}>
          {t('posters.openPrint')}
        </Link>
      </Section>
    </PageShell>
  );
}

/** A small outline of the paper format (portrait sheet, folded tent card, door sticker). */
function PaperShape({ kind }: { kind: (typeof KINDS)[number] }) {
  const box = kind === 'a4' ? 'h-14 w-10' : kind === 'tent' ? 'h-9 w-14' : 'h-12 w-12 rounded-full';
  return (
    <span aria-hidden="true" className="grid h-16 place-items-center rounded-input bg-canvas">
      <span className={`grid place-items-center rounded-[4px] border-2 border-ink-2/70 bg-surface ${box}`}>
        <span className="size-4 rounded-[2px] border-2 border-ink" />
      </span>
    </span>
  );
}
