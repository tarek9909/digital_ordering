import { ApiError } from '@dop/client-sdk';
import { siteContactSchema, type SiteContact as Contact } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Field } from '@dop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { ErrorNote } from './common';
import { MfaCancelled, useFreshMfa } from './FreshMfa';

/**
 * Public contact on the sign-up site: the email link and the floating WhatsApp button. Stored as the platform
 * setting `site.contact`; an empty WhatsApp number hides the button.
 */
export function SiteContact({ value, onSaved }: { value: Contact; onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = useFreshMfa();
  const [email, setEmail] = useState(value.email);
  const [whatsapp, setWhatsapp] = useState(value.whatsapp);
  const [errors, setErrors] = useState<Partial<Record<'email' | 'whatsapp', string>>>({});
  const save = useMutation({
    mutationFn: (v: Contact) => run(() => api.put('/settings/site.contact', { value: v })),
    onSuccess: () => {
      onSaved();
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = siteContactSchema.safeParse({ email, whatsapp: whatsapp.replace(/[\s-]/g, '') });
    if (!r.success) {
      const next: typeof errors = {};
      for (const i of r.error.issues) next[i.path[0] as 'email' | 'whatsapp'] = t(`siteContact.invalid.${String(i.path[0])}`);
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(r.data);
  };
  const failed = save.error && !(save.error instanceof MfaCancelled) ? save.error : null;
  return (
    <section aria-labelledby="sc-h">
      <h2 id="sc-h" className="mb-1 text-xl font-bold">
        {t('siteContact.title')}
      </h2>
      <p className="mb-3 text-muted">{t('siteContact.intro')}</p>
      <Card>
        <form onSubmit={submit} className="grid gap-4 p-5 md:grid-cols-2" noValidate>
          <Field label={t('siteContact.email')} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} hint={t('siteContact.emailHint')} />
          <Field
            label={t('siteContact.whatsapp')}
            type="tel"
            dir="ltr"
            inputMode="tel"
            placeholder="+966500000000"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            error={errors.whatsapp}
            hint={t('siteContact.whatsappHint')}
          />
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button type="submit" busy={save.isPending}>
              {t('siteContact.save')}
            </Button>
            {save.isSuccess && <span className="text-ok">{t('siteContact.saved')}</span>}
          </div>
          {failed && <div className="md:col-span-2">{failed instanceof ApiError ? <p role="alert" className="text-danger">{errorText(t, failed)}</p> : <ErrorNote error={failed} />}</div>}
        </form>
      </Card>
    </section>
  );
}
