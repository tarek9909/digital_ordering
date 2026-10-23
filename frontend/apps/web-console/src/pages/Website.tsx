import type { SiteContact as ContactValue, SiteLanding as LandingValue, SitePricing as PricingValue } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { LiveRegion, PageShell, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, tabPanelProps, Tabs } from '../components/common';
import { SiteContact } from '../components/SiteContact';
import { SiteLanding } from '../components/SiteLanding';
import { SitePricing } from '../components/SitePricing';
import { api } from '../lib/api';
import type { SettingRow } from '../lib/types';

// The public website on www: the landing page's sections and text, the packages section and the contact. Each is a
// platform setting (`site.landing`, `site.pricing`, `site.contact`); the site picks changes up within a minute.

type Tab = 'landing' | 'pricing' | 'contact';

export function WebsitePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('landing');
  const [announce, setAnnounce] = useState('');
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ items: SettingRow[] }>('/settings'),
  });
  const row = (key: string) => q.data?.items.find((s) => s.key === key);
  const contact = row('site.contact');
  const pricing = row('site.pricing');
  const landing = row('site.landing');
  const saved = (key: string) => setAnnounce(t('settings.savedKey', { key }));
  return (
    <PageShell wide eyebrow={t('layout.groups.platform')} title={t('website.title')} description={t('website.intro')}>
      <LiveRegion text={announce} />
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <>
          <Tabs
            id="website"
            label={t('website.title')}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'landing', label: t('siteLanding.title') },
              { value: 'pricing', label: t('sitePricing.title') },
              { value: 'contact', label: t('siteContact.title') },
            ]}
          />
          {/* All three stay mounted so unsaved edits survive switching tabs. */}
          <div {...tabPanelProps('website', 'landing')} hidden={tab !== 'landing'}>
            {landing && <SiteLanding key={JSON.stringify(landing.value)} value={landing.value as LandingValue} onSaved={() => saved(landing.key)} />}
          </div>
          <div {...tabPanelProps('website', 'pricing')} hidden={tab !== 'pricing'}>
            {pricing && <SitePricing key={JSON.stringify(pricing.value)} value={pricing.value as PricingValue} onSaved={() => saved(pricing.key)} />}
          </div>
          <div {...tabPanelProps('website', 'contact')} hidden={tab !== 'contact'}>
            {contact && <SiteContact key={JSON.stringify(contact.value)} value={contact.value as ContactValue} onSaved={() => saved(contact.key)} />}
          </div>
        </>
      )}
    </PageShell>
  );
}
