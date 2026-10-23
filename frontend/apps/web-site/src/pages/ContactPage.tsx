import { useTranslation } from '@dop/i18n';
import { useSearchParams } from 'react-router';
import { Contact } from '../components/Contact';
import { InnerPage, PageHeader } from '../components/PageHeader';
import { prefillName } from '../lib/forms';

/** Contact, and the way to get started: the platform team sets up each venue (no self-signup). */
export function ContactPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const name = prefillName(`?${params.toString()}`);
  return (
    <InnerPage width="max-w-6xl">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <PageHeader title={t('contact.title')} lead={<p>{name ? t('contact.setupFor', { name }) : t('contact.setup')}</p>} />
        <Contact />
      </div>
    </InnerPage>
  );
}
