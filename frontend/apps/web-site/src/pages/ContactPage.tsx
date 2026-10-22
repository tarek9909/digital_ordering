import { useTranslation } from '@dop/i18n';
import { useSearchParams } from 'react-router';
import { Contact } from '../components/Contact';
import { prefillName } from '../lib/forms';

/** Contact, and the way to get started: the platform team sets up each venue (no self-signup). */
export function ContactPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const name = prefillName(`?${params.toString()}`);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-10">
      <h1 className="text-3xl font-bold">{t('contact.title')}</h1>
      <p className="text-lg">{name ? t('contact.setupFor', { name }) : t('contact.setup')}</p>
      <Contact />
    </div>
  );
}
