import type { StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { BrandMark, useFlip } from '@dop/ui';
import { useRef } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { LangSwitch } from '../components/LangSwitch';
import { StatusGlyph } from '../components/StatusGlyph';
import { useStaff } from '../lib/store';
import { cardFlags } from '../lib/ticketState';
import { ConnectionDot, iconButton, MemberChip, SoundButton } from './TopBar';

interface Props {
  venueName: string;
  tickets: StaffTicket[];
  now: number;
  disabled: boolean;
  showSound: boolean;
  onReady: (t: StaffTicket) => void;
}

function KitchenCard({ ticket, now, disabled, onReady }: { ticket: StaffTicket; now: number; disabled: boolean; onReady: (t: StaffTicket) => void }) {
  const { t } = useTranslation();
  const busy = useStaff((s) => Boolean(s.busy[ticket.id]));
  const pos = useStaff((s) => Boolean(s.posNew[ticket.id]));
  const f = cardFlags(ticket, now);
  return (
    <article
      data-flip-id={ticket.id}
      aria-label={`${ticket.displayNumber} ${t(`common:status.${ticket.status}`)}`}
      aria-busy={busy || undefined}
      className={`flex flex-col gap-4 rounded-[var(--radius-card)] bg-white/[0.06] p-5 ring-inset ${f.late ? 'ring-2 ring-warn-bg/80' : pos ? 'ring-2 ring-info-bg/80' : 'ring-1 ring-white/10'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="num font-display text-7xl leading-[0.9] font-extrabold tracking-tight">{ticket.displayNumber}</span>
        <span className="num inline-flex items-center gap-1.5 pt-1 text-xl font-semibold text-white/80">
          <Icon name="clock" className="size-5" />
          {t('ageMinutes', { count: f.ageMinutes })}
        </span>
      </div>
      {(f.late || pos) && (
        <div className="flex flex-wrap gap-2">
          {f.late && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-bg px-3 py-1 font-semibold text-warn">
              <Icon name="warning" className="size-4" />
              {t('takingLonger')}
            </span>
          )}
          {pos && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info-bg px-3 py-1 font-semibold text-info">
              <Icon name="plus" className="size-4" />
              {t('pos.new')}
            </span>
          )}
        </div>
      )}
      {ticket.note && <p className="text-xl leading-snug font-medium break-words text-white/90">{ticket.note}</p>}
      <button
        type="button"
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => onReady(ticket)}
        className="mt-auto inline-flex min-h-24 w-full items-center justify-center gap-3 rounded-control bg-white font-display text-3xl font-extrabold tracking-tight text-ink shadow-button transition-[transform,background-color] duration-150 enabled:hover:bg-primary-wash enabled:active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <span className="inline-block size-8 animate-spin rounded-full border-4 border-current border-e-transparent" /> : <Icon name="check" className="size-9" />}
        {t('actions.ready')}
      </button>
    </article>
  );
}

/** Kitchen mode (FR-STF-11): only Preparing cards, each with one large Ready button; dark and high-contrast. */
export function KitchenBoard({ venueName, tickets, now, disabled, showSound, onReady }: Props) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLElement>(null);
  useFlip(gridRef, [tickets]);
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-ink text-white">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-white/10 px-3 py-2.5 sm:px-4">
        <div className="me-auto flex min-w-0 items-center gap-3">
          <BrandMark tone="light" className="size-10" />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate font-display text-lg leading-tight font-bold tracking-tight sm:text-xl">
              {venueName} <span className="font-semibold text-white/55">· {t('kitchen.title')}</span>
            </h1>
            <ConnectionDot dark />
          </div>
        </div>
        <span className="flex items-center gap-2 px-2 text-white/80">
          <StatusGlyph status="preparing" className="size-5" />
          <span className="text-sm font-semibold">{t('common:status.preparing')}</span>
          <span className="num font-display text-3xl leading-none font-extrabold text-white">{tickets.length}</span>
        </span>
        <MemberChip dark />
        {showSound && <SoundButton dark />}
        <LangSwitch dark />
        <Link to="/device" className={iconButton(true)} aria-label={t('device.title')}>
          <Icon name="device" />
        </Link>
      </header>
      {tickets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <StatusGlyph status="ready" className="size-14 text-white/25" />
          <p className="font-display text-2xl font-bold text-white/70">{t('kitchen.empty')}</p>
        </div>
      ) : (
        <main ref={gridRef} className="grid flex-1 content-start gap-4 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))' }}>
          {tickets.map((tk) => (
            <KitchenCard key={tk.id} ticket={tk} now={now} disabled={disabled} onReady={onReady} />
          ))}
        </main>
      )}
    </div>
  );
}
