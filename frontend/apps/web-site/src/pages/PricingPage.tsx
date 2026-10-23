import { useTranslation } from '@dop/i18n';
import { InnerPage, PageHeader } from '../components/PageHeader';
import { Pricing } from '../components/Pricing';

export function PricingPage() {
  const { t } = useTranslation();
  return (
    <InnerPage width="max-w-6xl">
      <PageHeader title={t('pricing.title')} lead={t('pricing.intro')} />
      <Pricing stagger />
    </InnerPage>
  );
}
