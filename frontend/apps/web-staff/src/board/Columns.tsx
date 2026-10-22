import type { StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { useState } from 'react';
import { useMediaQuery } from '../lib/hooks';
import type { Columns as Cols } from '../lib/ticketState';
import { TicketCard } from './TicketCard';
import type { TransitionTo } from './useTicketActions';

type Key = keyof Cols;

interface Props {
  columns: Cols;
  showReceived: boolean;
  now: number;
  disabled: boolean;
  showCheckCode: boolean;
  onAction: (t: StaffTicket, to: TransitionTo) => void;
  onMenu: (t: StaffTicket) => void;
}

function CardList({ tickets, emptyText, ...rest }: Omit<Props, 'columns' | 'showReceived'> & { tickets: StaffTicket[]; emptyText: string }) {
  if (tickets.length === 0) return <p className="p-4 text-center text-muted">{emptyText}</p>;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} {...rest} />
      ))}
    </div>
  );
}

/** Columns on tablets and PCs; tabs with counts on phones under 768 px (FR-STF-10). */
export function BoardColumns({ columns, showReceived, ...rest }: Props) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 768px)');
  const keys: Key[] = showReceived ? ['received', 'preparing', 'ready'] : ['preparing', 'ready'];
  const [tab, setTab] = useState<Key>('preparing');
  const active = keys.includes(tab) ? tab : 'preparing';

  if (!wide) {
    return (
      <div className="flex flex-1 flex-col">
        <div role="tablist" aria-label={t('columns')} className="sticky top-0 z-10 flex border-b border-line bg-surface">
          {keys.map((k) => (
            <button
              key={k}
              role="tab"
              id={`tab-${k}`}
              aria-selected={active === k}
              aria-controls={`panel-${k}`}
              onClick={() => setTab(k)}
              className={`min-h-14 flex-1 border-b-4 px-2 text-lg font-bold ${active === k ? 'border-primary text-ink' : 'border-transparent text-muted'}`}
            >
              {t(`common:status.${k}`)} (<span className="num">{columns[k].length}</span>)
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="p-3">
          <CardList tickets={columns[active]} emptyText={t('emptyColumn')} {...rest} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid flex-1 gap-3 p-3" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
      {keys.map((k) => (
        <section key={k} aria-labelledby={`col-${k}`} className={`flex flex-col gap-3 rounded-xl p-2 ${k === 'ready' ? 'bg-[#e6f4ea]' : 'bg-canvas'}`}>
          <h2 id={`col-${k}`} className="flex items-center justify-between px-1 text-xl font-bold">
            <span>{t(`common:status.${k}`)}</span>
            <span className="num rounded-full bg-surface px-3 py-0.5">{columns[k].length}</span>
          </h2>
          <CardList tickets={columns[k]} emptyText={t('emptyColumn')} {...rest} />
        </section>
      ))}
    </div>
  );
}
