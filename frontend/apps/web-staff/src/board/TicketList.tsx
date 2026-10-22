import { formatTime } from '@dop/client-sdk';
import type { StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, Modal, Spinner } from '@dop/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText, vq } from '../lib/api';
import { canReopen } from '../lib/ticketState';

interface RowProps {
  ticket: StaffTicket;
  now: number;
  disabled: boolean;
  timeZone: string;
  onReopen?: (t: StaffTicket) => void;
  onOpen: (t: StaffTicket) => void;
}

function TicketRow({ ticket, now, disabled, timeZone, onReopen, onOpen }: RowProps) {
  const { t, i18n } = useTranslation();
  const when = ticket.collectedAt ?? ticket.readyAt ?? ticket.createdAt;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
      <button type="button" className="flex min-h-12 flex-1 items-center gap-3 text-start" onClick={() => onOpen(ticket)}>
        <span className="num text-3xl font-black">{ticket.displayNumber}</span>
        <span className="flex flex-col text-sm">
          <span className="font-semibold">{t(`common:status.${ticket.status}`)}</span>
          <span className="text-muted">
            {formatTime(when, i18n.language, timeZone)}
            {ticket.externalRef && (
              <>
                {' · '}
                {t('receipt')}: <span className="num">{ticket.externalRef}</span>
              </>
            )}
          </span>
        </span>
      </button>
      {onReopen && canReopen(ticket, now) && (
        <Button variant="secondary" disabled={disabled} onClick={() => onReopen(ticket)}>
          {t('menu.reopen')}
        </Button>
      )}
    </li>
  );
}

/** Collected, cancelled and expired tickets of the last 30 minutes, with Reopen (FR-STF-05, FR-STF-06). */
export function RecentDrawer(props: Omit<RowProps, 'ticket'> & { tickets: StaffTicket[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { tickets, onClose, ...row } = props;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('recent.title')} description={t('recent.description')}>
      {tickets.length === 0 ? (
        <p className="text-muted">{t('recent.empty')}</p>
      ) : (
        <ul>
          {tickets.map((tk) => (
            <TicketRow key={tk.id} ticket={tk} {...row} />
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Search by number or receipt (FR-STF-09). */
export function SearchDialog(props: Omit<RowProps, 'ticket' | 'onReopen'> & { initial: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { initial, onClose, ...row } = props;
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<StaffTicket[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<{ items: StaffTicket[] }>(vq('/tickets/search'), { q: term });
      setItems(r.items);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initial.trim()) void search();
    // Run once with the term typed in the top bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('search.title')}>
      <form onSubmit={search} className="mb-4 flex items-end gap-2">
        <Field className="flex-1" label={t('search.label')} type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" busy={busy}>
          {t('search.go')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {busy && <Spinner label={t('common:loading')} />}
      {items && items.length === 0 && <p className="text-muted">{t('search.none')}</p>}
      {items && items.length > 0 && (
        <ul>
          {items.map((tk) => (
            <TicketRow key={tk.id} ticket={tk} {...row} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
