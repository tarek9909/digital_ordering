import type { StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { LangSwitch } from '../components/LangSwitch';
import { useStaff } from '../lib/store';
import { cardFlags } from '../lib/ticketState';
import { ConnectionDot, MemberChip, SoundButton } from './TopBar';

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
      aria-label={`${ticket.displayNumber} ${t(`common:status.${ticket.status}`)}`}
      aria-busy={busy || undefined}
      className={`flex flex-col gap-3 rounded-2xl border-4 bg-[#1b1f2a] p-4 ${pos ? 'border-[#60a5fa]' : f.late ? 'border-[#f59e0b]' : 'border-white/30'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="num text-7xl leading-none font-black">{ticket.displayNumber}</span>
        <span className="flex flex-col items-end gap-1 text-lg">
          <span className="inline-flex items-center gap-1">
            <Icon name="clock" />
            {t('ageMinutes', { count: f.ageMinutes })}
          </span>
          {f.late && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f59e0b] px-3 py-0.5 font-bold text-black">
              <Icon name="warning" className="size-4" />
              {t('takingLonger')}
            </span>
          )}
          {pos && <span className="rounded-full bg-[#60a5fa] px-3 py-0.5 font-bold text-black">{t('pos.new')}</span>}
        </span>
      </div>
      {ticket.note && <p className="text-xl break-words">{ticket.note}</p>}
      <button
        type="button"
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => onReady(ticket)}
        className="mt-auto inline-flex min-h-28 w-full items-center justify-center gap-3 rounded-xl bg-[#16a34a] text-4xl font-black text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon name="check" className="size-10" />
        {t('actions.ready')}
      </button>
    </article>
  );
}

/** Kitchen mode (FR-STF-11): only Preparing cards, each with one large Ready button; dark and high-contrast. */
export function KitchenBoard({ venueName, tickets, now, disabled, showSound, onReady }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[#0b0d12] text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/20 px-3 py-2">
        <div className="me-auto flex min-w-0 flex-col">
          <h1 className="truncate text-xl font-bold">
            {venueName} · {t('kitchen.title')}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 text-sm text-white/80">
            <ConnectionDot />
            <span>
              {t('common:status.preparing')}: <span className="num">{tickets.length}</span>
            </span>
          </div>
        </div>
        <MemberChip dark />
        {showSound && <SoundButton />}
        <div className="rounded-lg bg-white text-ink">
          <LangSwitch />
        </div>
        <Link to="/device" className="inline-flex size-12 items-center justify-center rounded-lg hover:bg-white/10" aria-label={t('device.title')}>
          <Icon name="device" />
        </Link>
      </header>
      {tickets.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-6 text-2xl text-white/70">{t('kitchen.empty')}</p>
      ) : (
        <main className="grid flex-1 content-start gap-4 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))' }}>
          {tickets.map((tk) => (
            <KitchenCard key={tk.id} ticket={tk} now={now} disabled={disabled} onReady={onReady} />
          ))}
        </main>
      )}
    </div>
  );
}
