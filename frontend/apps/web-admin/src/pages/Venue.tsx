import { useTranslation } from '@dop/i18n';
import { Card } from '@dop/ui';
import { useSearchParams } from 'react-router';
import { QueryView } from '../components/common';
import { BrandingForm } from '../components/venue/BrandingForm';
import { FlowForm } from '../components/venue/FlowForm';
import { GeneralForm } from '../components/venue/GeneralForm';
import { MessagesForm } from '../components/venue/MessagesForm';
import { useCurrentVenueId, useVenue } from '../lib/venue';

const TABS = ['general', 'branding', 'messages', 'flow'] as const;
type Tab = (typeof TABS)[number];

export function VenuePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'general';
  const venueId = useCurrentVenueId();
  const q = useVenue(venueId);

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t('nav.venue')}</h1>
      <div role="tablist" aria-label={t('venue.tabsLabel')} className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            onClick={() => setParams({ tab: k }, { replace: true })}
            className={`min-h-12 border-b-4 px-4 font-medium ${tab === k ? 'border-primary text-primary' : 'border-transparent'}`}
          >
            {t(`venue.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <QueryView q={q}>
          {(venue) => {
            // Keyed by the venue data so forms reset when another venue is chosen.
            const key = `${venue.id}-${tab}`;
            if (tab === 'flow') return <FlowForm key={key} venue={venue} />;
            return (
              <Card>
                {tab === 'general' && <GeneralForm key={key} venue={venue} />}
                {tab === 'branding' && <BrandingForm key={key} venue={venue} />}
                {tab === 'messages' && <MessagesForm key={key} venue={venue} />}
              </Card>
            );
          }}
        </QueryView>
      </div>
    </>
  );
}
