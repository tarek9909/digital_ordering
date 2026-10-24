import type { ApiError } from '@dop/client-sdk';
import type { CreateTicketBody, StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, Modal, Select } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorText, isApiError, vq } from '../lib/api';
import { storedCounterId } from '../lib/counter';
import { putTicket } from './boardData';

interface Props {
  counters: Array<{ id: string; name: string }>;
  disabled: boolean;
  onClose: () => void;
  onCreated: (t: StaffTicket, qr: string) => void;
  /** Opens an existing ticket that already uses this receipt number (EX-20). */
  onOpenExisting: (t: StaffTicket) => void;
}

/** Optional quick form, then POST /tickets → full-screen QR (FR-QR-01). */
export function NewTicketDialog({ counters, disabled, onClose, onCreated, onOpenExisting }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [counterId, setCounterId] = useState(counters.find((c) => c.id === storedCounterId())?.id ?? counters[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<StaffTicket | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setExisting(null);
    const body: CreateTicketBody = {
      ...(ref.trim() && { externalRef: ref.trim() }),
      ...(note.trim() && { note: note.trim() }),
      ...(counterId && { counterId }),
    };
    try {
      const r = await api.post<{ ticket: StaffTicket; qr: string }>(vq('/tickets'), body);
      putTicket(qc, r.ticket);
      onCreated(r.ticket, r.qr);
    } catch (err) {
      if (isApiError(err, 'EXTERNAL_REF_IN_USE')) {
        const data = (err as ApiError).problem?.data as { ticket?: StaffTicket } | undefined;
        setExisting(data?.ticket ?? null);
      }
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('newTicket.title')} description={t('newTicket.description')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('receipt')} value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} />
        <Field label={t('note')} value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
        {counters.length > 1 && (
          <Select label={t('counter')} value={counterId} onChange={(e) => setCounterId(e.target.value)} options={counters.map((c) => ({ value: c.id, label: c.name }))} />
        )}
        {error && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg bg-danger-bg p-3 text-danger">
            <span>{error}</span>
            {existing && (
              <Button type="button" variant="secondary" onClick={() => onOpenExisting(existing)}>
                {t('newTicket.openExisting')} <span className="num">{existing.displayNumber}</span>
              </Button>
            )}
          </div>
        )}
        <Button type="submit" size="lg" busy={busy} disabled={disabled}>
          {t('newTicket.create')}
        </Button>
      </form>
    </Modal>
  );
}
