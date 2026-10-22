import { useTranslation } from '@dop/i18n';
import { Pricing } from '../components/Pricing';

export function PricingPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-10">
      <h1 className="text-3xl font-bold">{t('pricing.title')}</h1>
      <p className="text-muted">{t('pricing.intro')}</p>
      <Pricing />
    </div>
  );
}
