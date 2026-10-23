import type { StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { useFlip } from '@dop/ui';
import { useRef, useState } from 'react';
import { StatusGlyph } from '../components/StatusGlyph';
import { useMediaQuery } from '../lib/hooks';
import type { Columns as Cols } from '../lib/ticketState';
import { CollectedTile, TicketCard } from './TicketCard';
import type { TransitionTo } from './useTicketActions';

type Key = keyof Cols | 'collected';

interface Props {
  columns: Cols;
  /** Collected tickets of the last 30 minutes, newest first. */
  collected: StaffTicket[];
  /** Collected today (server business date), shown on the Collected header. */
  collectedCount: number;
  showReceived: boolean;
  now: number;
  disabled: boolean;
  showCheckCode: boolean;
  onAction: (t: StaffTicket, to: TransitionTo) => void;
  onMenu: (t: StaffTicket) => void;
}

type CardProps = Omit<Props, 'columns' | 'collected' | 'collectedCount' | 'showReceived'>;

/** How each column reads at a glance: a shape and label first, a tint only as a second cue. */
const LOOK: Record<Key, { col: string; head: string }> = {
  received: { col: 'border-2 border-dashed border-line', head: 'text-ink-2' },
  preparing: { col: 'bg-line/45', head: 'text-ink' },
  ready: { col: 'bg-ok-bg/70', head: 'text-ok' },
  collected: { col: 'border border-line', head: 'text-ink-2' },
};

function Empty({ text }: { text: string }) {
  return <p className="rounded-input px-4 py-8 text-center text-muted">{text}</p>;
}

/** Cards fill as many tracks as their column holds (one on phones and narrow columns, more on wide monitors). */
const CARD_GRID = { gridTemplateColumns: 'repeat(auto-fill, minmax(min(15rem, 100%), 1fr))' };

/** Below this the board shows tabs: phones in either orientation (a landscape phone is wide but too short for columns). */
const COLUMNS_QUERY = '(min-width: 768px) and (min-height: 520px)';

function ColumnBody({ k, tickets, collected, ...rest }: CardProps & { k: Key; tickets: StaffTicket[]; collected: StaffTicket[] }) {
  const { t } = useTranslation();
  if (k === 'collected') {
    if (collected.length === 0) return <Empty text={t('collectedEmpty')} />;
    return (
      <div className="flex flex-col gap-2">
        {collected.map((tk) => (
          <CollectedTile key={tk.id} ticket={tk} now={rest.now} onMenu={rest.onMenu} />
        ))}
      </div>
    );
  }
  if (tickets.length === 0) return <Empty text={t('emptyColumn')} />;
  return (
    <div className="grid gap-3" style={CARD_GRID}>
      {tickets.map((tk) => (
        <TicketCard key={tk.id} ticket={tk} {...rest} />
      ))}
    </div>
  );
}

/**
 * Columns on tablets and PCs; tabs with counts on phones (under 768 px, or a landscape phone) (FR-STF-10). Columns
 * keep a readable minimum width: where they do not all fit (a portrait tablet), the row scrolls sideways and snaps to
 * a column. One FLIP container wraps every column, so a ticket whose status changes glides to its new column (and back on Undo); new tickets settle in.
 */
export function BoardColumns({ columns, collected, collectedCount, showReceived, ...rest }: Props) {
  const { t } = useTranslation();
  const wide = useMediaQuery(COLUMNS_QUERY);
  const keys: Key[] = showReceived ? ['received', 'preparing', 'ready', 'collected'] : ['preparing', 'ready', 'collected'];
  const [tab, setTab] = useState<Key>('preparing');
  const active = keys.includes(tab) ? tab : 'preparing';
  const count = (k: Key) => (k === 'collected' ? collectedCount : columns[k].length);
  const flipRef = useRef<HTMLDivElement>(null);
  useFlip(flipRef, [columns, collected], `${active}:${wide}`);

  if (!wide) {
    return (
      <div className="flex flex-1 flex-col">
        <div role="tablist" aria-label={t('columns')} className="sticky top-0 z-10 flex gap-1 border-b border-line bg-surface/95 px-2 pt-1 backdrop-blur">
          {keys.map((k) => {
            const on = active === k;
            return (
              <button
                key={k}
                role="tab"
                id={`tab-${k}`}
                aria-selected={on}
                aria-controls={`panel-${k}`}
                onClick={() => setTab(k)}
                className={`relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors ${on ? 'text-ink' : 'text-muted'}`}
              >
                <span className="flex items-center gap-1.5">
                  <StatusGlyph status={k} className={`size-4 ${on ? LOOK[k].head : ''}`} />
                  <span className="num font-display text-xl leading-none font-bold">{count(k)}</span>
                </span>
                <span className="max-w-full truncate text-xs font-semibold">{t(`common:status.${k}`)}</span>
                <span aria-hidden="true" className={`absolute inset-x-3 bottom-0 h-1 rounded-t-full transition-colors ${on ? 'bg-ink' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>
        <div ref={flipRef} role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <ColumnBody k={active} tickets={active === 'collected' ? [] : columns[active]} collected={collected} {...rest} />
        </div>
      </div>
    );
  }

  // Ticket columns never narrower than one card; on a portrait tablet that is wider than the screen, so it scrolls.
  const template = keys.map((k) => (k === 'collected' ? 'minmax(11rem, 0.62fr)' : 'minmax(17rem, 1fr)')).join(' ');
  return (
    <div
      ref={flipRef}
      className="grid flex-1 snap-x snap-mandatory scroll-px-3 items-start gap-3 overflow-x-auto overscroll-x-contain p-3 sm:scroll-px-4 sm:p-4"
      style={{ gridTemplateColumns: template }}
    >
      {keys.map((k) => (
        <section key={k} aria-labelledby={`col-${k}`} className={`flex min-h-full min-w-0 snap-start flex-col gap-3 rounded-[1.75rem] p-2.5 ${LOOK[k].col}`}>
          <h2 id={`col-${k}`} className="flex items-center gap-2 px-2 pt-1.5 pb-0.5">
            <StatusGlyph status={k} className={`size-5 ${LOOK[k].head}`} />
            {/* The Collected column is narrow: a smaller label and count keep "Collected" whole beside its total. */}
            <span className={`min-w-0 font-display leading-tight font-bold tracking-tight ${k === 'collected' ? 'text-base' : 'text-lg'}`}>{t(`common:status.${k}`)}</span>
            <span className={`num ms-auto font-display leading-none font-extrabold tracking-tight ${k === 'collected' ? 'text-xl' : 'text-2xl'}`}>{count(k)}</span>
          </h2>
          {k === 'collected' && <p className="eyebrow -mt-2.5 px-2 text-end">{t('today')}</p>}
          <ColumnBody k={k} tickets={k === 'collected' ? [] : columns[k]} collected={collected} {...rest} />
        </section>
      ))}
    </div>
  );
}
