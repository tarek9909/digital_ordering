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
    <Card className="mx-auto max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">{t('purpose.title')}</h1>
        <p className="text-muted">{t('purpose.body')}</p>
        <Select
          label={t('purpose.label')}
          value={choice}
          onChange={(e) => setChoice(e.target.value as AuditPurpose)}
          options={AUDIT_PURPOSES.map((p) => ({ value: p, label: t(`purpose.${p}`) }))}
        />
        <Button type="submit">{t('purpose.open')}</Button>
      </form>
    </Card>
  );
}
