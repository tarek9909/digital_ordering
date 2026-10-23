import { useTranslation } from '@dop/i18n';
import { Card } from '@dop/ui';
import { useSiteInfo } from '../landing/lib';
import { pillLink } from './PageHeader';

/** Contact details set by super admins in the console; the translated address is the fallback. */
export function Contact() {
  const { t } = useTranslation();
  const site = useSiteInfo();
  const email = site.data?.contact.email ?? t('contact.email');
  const whatsapp = site.data?.contact.whatsappUrl;
  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8 lg:mt-3">
      <p className="text-ink-2">{t('contact.body')}</p>
      <a
        href={`mailto:${email}`}
        dir="ltr"
        className="w-fit font-display text-2xl font-bold break-all text-ink underline decoration-primary/40 decoration-2 underline-offset-8 transition-colors hover:decoration-primary sm:text-[1.75rem]"
      >
        {email}
      </a>
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${pillLink.ink} w-fit`}>
          {t('landing.whatsapp')}
        </a>
      )}
      <p className="border-t border-line pt-5 text-sm text-muted">{t('contact.hours')}</p>
    </Card>
  );
}
