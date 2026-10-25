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
      <LiveRegion toast text={announce} />
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <Tabs
              id="website"
              label={t('website.title')}
              value={tab}
              onChange={setTab}
              tabs={[
                {
                  value: 'landing',
                  label: t('siteLanding.title'),
                  icon: (
                    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                    </svg>
                  ),
                },
                {
                  value: 'pricing',
                  label: t('sitePricing.title'),
                  icon: (
                    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  ),
                },
                {
                  value: 'contact',
                  label: t('siteContact.title'),
                  icon: (
                    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  ),
                },
              ]}
            />
          </div>
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
