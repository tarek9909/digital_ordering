import type { SiteContact as ContactValue, SiteLanding as LandingValue, SitePricing as PricingValue } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { LiveRegion, PageShell, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote } from '../components/common';
import { SiteContact } from '../components/SiteContact';
import { SiteLanding } from '../components/SiteLanding';
import { SitePricing } from '../components/SitePricing';
import { api } from '../lib/api';
import type { SettingRow } from '../lib/types';

// The public website on www: the landing page's sections and text, the packages section and the contact. Each is a
// platform setting (`site.landing`, `site.pricing`, `site.contact`); the site picks changes up within a minute.

export function WebsitePage() {
  const { t } = useTranslation();
  const [announce, setAnnounce] = useState('');
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ items: SettingRow[] }>('/settings') });
  const row = (key: string) => q.data?.items.find((s) => s.key === key);
  const contact = row('site.contact');
  const pricing = row('site.pricing');
  const landing = row('site.landing');
  const saved = (key: string) => setAnnounce(t('settings.savedKey', { key }));
  return (
    <PageShell title={t('website.title')}>
      <LiveRegion text={announce} />
      <p className="mb-6 max-w-[70ch] text-muted">{t('website.intro')}</p>
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <div className="flex flex-col gap-8">
          {landing && <SiteLanding key={JSON.stringify(landing.value)} value={landing.value as LandingValue} onSaved={() => saved(landing.key)} />}
          {pricing && <SitePricing key={JSON.stringify(pricing.value)} value={pricing.value as PricingValue} onSaved={() => saved(pricing.key)} />}
          {contact && <SiteContact key={JSON.stringify(contact.value)} value={contact.value as ContactValue} onSaved={() => saved(contact.key)} />}
        </div>
      )}
    </PageShell>
  );
}
