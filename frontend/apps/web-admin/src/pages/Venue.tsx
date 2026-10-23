import { useTranslation } from '@dop/i18n';
import { Card } from '@dop/ui';
import { useSearchParams } from 'react-router';
import { Page, QueryView, Tabs } from '../components/common';
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
    <Page title={t('nav.venue')} description={t('venue.description')}>
      <Tabs label={t('venue.tabsLabel')} tabs={TABS} value={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} idPrefix="" labelOf={(k) => t(`venue.tabs.${k}`)} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <QueryView q={q} skeleton="form">
          {(venue) => {
            // Keyed by the venue data so forms reset when another venue is chosen.
            const key = `${venue.id}-${tab}`;
            if (tab === 'flow') return <FlowForm key={key} venue={venue} />;
            return (
              <Card flat className="p-5 sm:p-6">
                {tab === 'general' && <GeneralForm key={key} venue={venue} />}
                {tab === 'branding' && <BrandingForm key={key} venue={venue} />}
                {tab === 'messages' && <MessagesForm key={key} venue={venue} />}
              </Card>
            );
          }}
        </QueryView>
      </div>
    </Page>
  );
}
