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
    <section aria-labelledby="sc-h" className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-canvas text-primary ring-1 ring-line">
          <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </span>
        <div>
          <h2 id="sc-h" className="text-lg font-bold text-ink">
            {t('siteContact.title')}
          </h2>
          <p className="text-xs text-muted">{t('siteContact.intro')}</p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border border-line/80 bg-surface shadow-xs lg:col-span-2">
          <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-line/70 pt-4">
              <Button type="submit" busy={save.isPending}>
                {t('siteContact.save')}
              </Button>
              {save.isSuccess && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
                  <span className="size-1.5 rounded-full bg-ok" />
                  {t('siteContact.saved')}
                </span>
              )}
            </div>
            {failed && <div>{failed instanceof ApiError ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3.5 py-2 text-xs font-medium text-danger">{errorText(t, failed)}</p> : <ErrorNote error={failed} />}</div>}
          </form>
        </Card>
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-canvas/40 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Live Channels Preview</h3>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas text-ink ring-1 ring-line">
                <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted">Support Email</p>
                <p className="truncate font-mono text-sm font-semibold text-ink">{email || 'Not configured'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ok/10 text-ok ring-1 ring-ok/30">
                <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0012.04 2z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted">WhatsApp Floating Button</p>
                <p className="truncate font-mono text-sm font-semibold text-ink">{whatsapp || 'Hidden (empty)'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
