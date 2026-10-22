import type { AlertLevel, StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { Icon, type IconName } from '../components/Icon';
import { useStaff } from '../lib/store';
import { cardFlags } from '../lib/ticketState';
import type { TransitionTo } from './useTicketActions';

export const ALERT_ICON: Record<AlertLevel, IconName> = { push: 'phone', live: 'pageOpen', closed: 'pageClosed', none: 'none' };

/** The one-tap main action per status (FR-STF-03, FR-STF-05). */
export function mainAction(t: StaffTicket): { to: TransitionTo; label: string } | null {
  if (t.status === 'received') return { to: 'preparing', label: 'actions.startPreparing' };
  if (t.status === 'preparing') return { to: 'ready', label: 'actions.ready' };
  if (t.status === 'ready') return { to: 'collected', label: 'actions.collected' };
  return null;
}

export function AlertLevelLabel({ ticket }: { ticket: StaffTicket }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1">
      <Icon name={ALERT_ICON[ticket.alertLevel]} className="size-4 shrink-0" />
      {t(`common:alertLevel.${ticket.alertLevel}`)}
    </span>
  );
}

interface Props {
  ticket: StaffTicket;
  now: number;
  disabled: boolean;
  /** Venue uses check codes (FR-TKT-06): shown on Ready cards. */
  showCheckCode: boolean;
  onAction: (t: StaffTicket, to: TransitionTo) => void;
  onMenu: (t: StaffTicket) => void;
}

export function TicketCard({ ticket, now, disabled, showCheckCode, onAction, onMenu }: Props) {
  const { t } = useTranslation();
  const busy = useStaff((s) => Boolean(s.busy[ticket.id]));
  const overdueRound = useStaff((s) => s.overdue[ticket.id]);
  const pos = useStaff((s) => Boolean(s.posNew[ticket.id]));
  const f = cardFlags(ticket, now, overdueRound);
  const action = mainAction(ticket);

  const tone = f.callOut ? 'border-danger bg-danger text-white' : f.late ? 'border-[#d97706] bg-surface' : 'border-line bg-surface';
  const sub = f.callOut ? 'text-white' : 'text-muted';

  return (
    <article
      aria-label={`${ticket.displayNumber} ${t(`common:status.${ticket.status}`)}`}
      aria-busy={busy || undefined}
      className={`flex flex-col gap-2 rounded-[var(--radius-card)] border-4 p-3 shadow-sm ${tone} ${pos ? 'ring-4 ring-primary ring-offset-2' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="num text-4xl leading-tight font-black sm:text-5xl">{ticket.displayNumber}</span>
          <span className={`text-sm ${sub}`}>{t(`common:status.${ticket.status}`)}</span>
        </div>
        <button
          type="button"
          onClick={() => onMenu(ticket)}
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg hover:bg-black/10"
          aria-label={t('menu.open', { number: ticket.displayNumber })}
        >
          <Icon name="menu" className="size-6" />
        </button>
      </div>

      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${sub}`}>
        <span className="inline-flex items-center gap-1">
          <Icon name="clock" className="size-4" />
          {t('ageMinutes', { count: f.ageMinutes })}
        </span>
        <AlertLevelLabel ticket={ticket} />
      </div>

      {(ticket.note || ticket.externalRef) && (
        <div className="text-base break-words">
          {ticket.externalRef && (
            <span className="me-2 font-semibold">
              {t('receipt')}: <span className="num">{ticket.externalRef}</span>
            </span>
          )}
          {ticket.note}
        </div>
      )}

      {showCheckCode && ticket.status === 'ready' && (
        <div className={`text-base ${sub}`}>
          {t('checkCode.label')}:{' '}
          <span className={`num font-bold tracking-widest ${f.callOut ? 'text-white' : 'text-ink'}`} dir="ltr">
            {ticket.checkCode}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {pos && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-sm font-bold text-on-primary">
            <Icon name="plus" className="size-4" />
            {t('pos.new')}
          </span>
        )}
        {f.acknowledged && (
          <span className="inline-flex items-center gap-1 rounded-full bg-ok px-3 py-1 text-sm font-bold text-white">
            <Icon name="check" className="size-4" />
            {t('coming')}
          </span>
        )}
        {f.late && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-3 py-1 text-sm font-bold text-warn">
            <Icon name="warning" className="size-4" />
            {t('takingLonger')}
          </span>
        )}
        {f.callOut && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-bold text-danger">
            <Icon name="megaphone" className="size-4" />
            {t('callOut')}
          </span>
        )}
      </div>

      {action && (
        <Button
          size="lg"
          variant={ticket.status === 'preparing' ? 'primary' : 'secondary'}
          className="w-full"
          busy={busy}
          disabled={disabled}
          onClick={() => onAction(ticket, action.to)}
        >
          {ticket.status === 'preparing' && <Icon name="check" className="size-6" />}
          {t(action.label)}
        </Button>
      )}
    </article>
  );
}
