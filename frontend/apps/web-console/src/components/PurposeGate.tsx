import { AUDIT_PURPOSES, type AuditPurpose } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Select } from '@dop/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { getPurpose, rememberPurpose } from '../lib/purpose';

/** Asks for a purpose before tenant data is opened (TR-FE-25); remembered 1 hour per tenant. */
export function PurposeGate({ tenantId, children }: { tenantId: string; children: (purpose: AuditPurpose) => ReactNode }) {
  const { t } = useTranslation();
  const [purpose, setPurpose] = useState<AuditPurpose | null>(() => getPurpose(tenantId));
  const [choice, setChoice] = useState<AuditPurpose>('support');

  if (purpose) return <>{children(purpose)}</>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    rememberPurpose(tenantId, choice);
    setPurpose(choice);
  };
  return (
    <div className="px-4 py-10 sm:px-6 sm:py-16">
      <Card className="mx-auto max-w-md p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div data-motion="page" className="flex flex-col gap-1.5">
            <span className="eyebrow">{t('tenant.eyebrow')}</span>
            <h1 className="font-display text-2xl font-extrabold tracking-tight">{t('purpose.title')}</h1>
            <p className="text-ink-2">{t('purpose.body')}</p>
          </div>
          <Select
            label={t('purpose.label')}
            value={choice}
            onChange={(e) => setChoice(e.target.value as AuditPurpose)}
            options={AUDIT_PURPOSES.map((p) => ({ value: p, label: t(`purpose.${p}`) }))}
          />
          <Button type="submit">{t('purpose.open')}</Button>
        </form>
      </Card>
    </div>
  );
}
