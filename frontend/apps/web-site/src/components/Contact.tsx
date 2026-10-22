import { useTranslation } from '@dop/i18n';
import { Card } from '@dop/ui';
import { useSiteInfo } from '../landing/lib';

/** Contact details set by super admins in the console; the translated address is the fallback. */
export function Contact() {
  const { t } = useTranslation();
  const site = useSiteInfo();
  const email = site.data?.contact.email ?? t('contact.email');
  const whatsapp = site.data?.contact.whatsappUrl;
  return (
    <Card className="flex flex-col gap-3 p-6">
      <p>{t('contact.body')}</p>
      <p className="flex flex-wrap gap-3">
        <a href={`mailto:${email}`} className="inline-flex min-h-12 items-center font-semibold text-ink underline decoration-line decoration-2 underline-offset-8 hover:decoration-ink" dir="ltr">
          {email}
        </a>
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center rounded-full bg-ink px-5 font-semibold text-white hover:bg-ink-2">
            {t('landing.whatsapp')}
          </a>
        )}
      </p>
      <p className="text-sm text-muted">{t('contact.hours')}</p>
    </Card>
  );
}
