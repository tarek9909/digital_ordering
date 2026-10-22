import { CANCEL_REASONS, type CancelReason, type StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, Modal, Select } from '@dop/ui';
import { useState, type FormEvent } from 'react';
import { useStaff } from '../lib/store';

interface Base {
  ticket: StaffTicket;
  disabled: boolean;
  onClose: () => void;
}

/** Cancel with confirmation and a reason (FR-STF-07, EX-07). */
export function CancelDialog({ ticket, disabled, onClose, onConfirm }: Base & { onConfirm: (reason: CancelReason, note?: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<CancelReason>('customer_left');
  const [note, setNote] = useState('');
  const busy = useStaff((s) => Boolean(s.busy[ticket.id]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await onConfirm(reason, note.trim() || undefined);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('cancelDialog.title', { number: ticket.displayNumber })} description={t('cancelDialog.description')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select
          label={t('cancelDialog.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value as CancelReason)}
          options={CANCEL_REASONS.map((r) => ({ value: r, label: t(`cancelReasons.${r}`) }))}
        />
        <Field label={t('cancelDialog.note')} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" size="lg" className="flex-1" busy={busy} disabled={disabled}>
            {t('cancelDialog.confirm')}
          </Button>
          <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={onClose}>
            {t('cancelDialog.keep')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Check-code prompt when the venue requires it on collection (CHECK_CODE_REQUIRED). */
export function CheckCodeDialog({ ticket, disabled, invalid, onClose, onSubmit }: Base & { invalid: boolean; onSubmit: (code: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const busy = useStaff((s) => Boolean(s.busy[ticket.id]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length === 4) await onSubmit(code.trim().toUpperCase());
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('checkCode.title', { number: ticket.displayNumber })} description={t('checkCode.description')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label={t('checkCode.label')}
          value={code}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={4}
          minLength={4}
          className="num"
          error={invalid ? t('checkCode.invalid') : undefined}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" size="lg" busy={busy} disabled={disabled || code.trim().length !== 4}>
          {t('actions.collected')}
        </Button>
      </form>
    </Modal>
  );
}

/** Edit note and receipt number. Empty fields clear the value. */
export function EditDialog({ ticket, disabled, onClose, onSave }: Base & { onSave: (b: { note: string | null; externalRef: string | null }) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(ticket.note ?? '');
  const [ref, setRef] = useState(ticket.externalRef ?? '');
  const busy = useStaff((s) => Boolean(s.busy[ticket.id]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await onSave({ note: note.trim() || null, externalRef: ref.trim() || null });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('editDialog.title', { number: ticket.displayNumber })}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('receipt')} value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} />
        <Field label={t('note')} value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" size="lg" busy={busy} disabled={disabled}>
          {t('common:save')}
        </Button>
      </form>
    </Modal>
  );
}
