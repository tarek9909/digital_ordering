import { formatTime } from '@dop/client-sdk';
import type { StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, Modal, Spinner } from '@dop/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText, vq } from '../lib/api';
import { canReopen } from '../lib/ticketState';
import { StatusLabel } from './TicketCard';

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
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 last:border-b-0">
      <button type="button" className="-mx-2 flex min-h-14 flex-1 items-center gap-4 rounded-input px-2 text-start transition-colors hover:bg-primary-wash" onClick={() => onOpen(ticket)}>
        <span className="num min-w-16 font-display text-3xl leading-none font-extrabold tracking-tight">{ticket.displayNumber}</span>
        <span className="flex min-w-0 flex-col gap-0.5 text-sm">
          <StatusLabel status={ticket.status} className="font-semibold text-ink" />
          <span className="text-muted">
            <span className="num">{formatTime(when, i18n.language, timeZone)}</span>
            {ticket.externalRef && (
              <>
                <span aria-hidden="true" className="mx-1.5">
                  /
                </span>
                {t('receipt')} <span className="num">{ticket.externalRef}</span>
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
        <p className="rounded-input bg-canvas px-4 py-8 text-center text-muted">{t('recent.empty')}</p>
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
        <Button type="submit" variant="ink" busy={busy}>
          {t('search.go')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mb-3 rounded-input bg-danger-bg px-4 py-3 font-medium text-danger">
          {error}
        </p>
      )}
      {busy && (
        <div className="flex justify-center py-6 text-muted">
          <Spinner label={t('common:loading')} />
        </div>
      )}
      {items && items.length === 0 && <p className="rounded-input bg-canvas px-4 py-8 text-center text-muted">{t('search.none')}</p>}
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
