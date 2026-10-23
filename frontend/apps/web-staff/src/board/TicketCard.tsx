import type { AlertLevel, StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { StatusGlyph } from '../components/StatusGlyph';
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
    <span className="inline-flex items-center gap-1.5">
      <Icon name={ALERT_ICON[ticket.alertLevel]} className="size-4 shrink-0" />
      {t(`common:alertLevel.${ticket.alertLevel}`)}
    </span>
  );
}

/** Status text with its shape. */
export function StatusLabel({ status, className = '' }: { status: StaffTicket['status']; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <StatusGlyph status={status} className="size-4" />
      {t(`common:status.${status}`)}
    </span>
  );
}

/** A flag on a card: text plus a marker shape, never colour alone. */
function Flag({ tone, icon, children }: { tone: 'ok' | 'warn' | 'danger' | 'info'; icon: IconName; children: ReactNode }) {
  const tones = { ok: 'bg-ok-bg text-ok', warn: 'bg-warn-bg text-warn', danger: 'bg-danger text-white', info: 'bg-info-bg text-info' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>
      <Icon name={icon} className="size-4 shrink-0" />
      {children}
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

  // Calm white cards; a ring says what needs attention (call-out, taking longer, new from the POS).
  const tone = f.callOut ? 'bg-danger-bg ring-2 ring-danger' : f.late ? 'bg-surface ring-2 ring-warn/60' : pos ? 'bg-surface ring-2 ring-info' : 'bg-surface ring-1 ring-line/80';

  return (
    <article
      data-flip-id={ticket.id}
      aria-label={`${ticket.displayNumber} ${t(`common:status.${ticket.status}`)}`}
      aria-busy={busy || undefined}
      className={`@container relative flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] p-4 shadow-card ${tone}`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Scales down in a narrow card (container width) rather than pushing the menu out; a long number wraps. */}
        <span className={`num min-w-0 font-display text-[min(3.25rem,24cqi)] leading-[0.95] font-extrabold tracking-tight break-words ${f.callOut ? 'text-danger' : 'text-ink'}`}>
          {ticket.displayNumber}
        </span>
        <button
          type="button"
          onClick={() => onMenu(ticket)}
          className="-me-2 -mt-1 inline-flex size-12 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-ink/5"
          aria-label={t('menu.open', { number: ticket.displayNumber })}
        >
          <Icon name="menu" className="size-6" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span className="num inline-flex items-center gap-1.5 font-semibold text-ink">
          <Icon name="clock" className="size-4 text-muted" />
          {t('ageMinutes', { count: f.ageMinutes })}
        </span>
        <AlertLevelLabel ticket={ticket} />
      </div>

      {(ticket.note || ticket.externalRef) && (
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-base break-words">
          {ticket.externalRef && (
            <span className="text-sm text-muted">
              {t('receipt')} <span className="num font-semibold text-ink">{ticket.externalRef}</span>
            </span>
          )}
          {ticket.note && <span className="font-medium text-ink">{ticket.note}</span>}
        </div>
      )}

      {showCheckCode && ticket.status === 'ready' && (
        <div className="flex items-center justify-between gap-2 rounded-input bg-canvas px-3 py-2 text-sm text-ink-2">
          {t('checkCode.label')}
          <span className="num shrink-0 font-mono text-lg font-medium tracking-[0.12em] text-ink" dir="ltr">
            {ticket.checkCode}
          </span>
        </div>
      )}

      {(pos || f.acknowledged || f.late || f.callOut) && (
        <div className="flex flex-wrap gap-2">
          {pos && (
            <Flag tone="info" icon="plus">
              {t('pos.new')}
            </Flag>
          )}
          {f.acknowledged && (
            <Flag tone="ok" icon="check">
              {t('coming')}
            </Flag>
          )}
          {f.late && (
            <Flag tone="warn" icon="warning">
              {t('takingLonger')}
            </Flag>
          )}
          {f.callOut && (
            <Flag tone="danger" icon="megaphone">
              {t('callOut')}
            </Flag>
          )}
        </div>
      )}

      {action && (
        <Button
          size="lg"
          variant={ticket.status === 'preparing' ? 'ink' : 'secondary'}
          className="mt-auto w-full"
          busy={busy}
          disabled={disabled}
          onClick={() => onAction(ticket, action.to)}
        >
          {ticket.status === 'preparing' && !busy && <Icon name="check" className="size-6" />}
          {ticket.status === 'ready' && !busy && <StatusGlyph status="collected" className="size-6" />}
          {t(action.label)}
        </Button>
      )}
    </article>
  );
}

/** A collected ticket in the Collected column: number and how long ago; opens the menu (Reopen lives there). */
export function CollectedTile({ ticket, now, onMenu }: { ticket: StaffTicket; now: number; onMenu: (t: StaffTicket) => void }) {
  const { t } = useTranslation();
  const at = Date.parse(ticket.collectedAt ?? ticket.closedAt ?? '') || now;
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  return (
    <button
      type="button"
      data-flip-id={ticket.id}
      onClick={() => onMenu(ticket)}
      aria-label={`${ticket.displayNumber} ${t('common:status.collected')}. ${t('menu.open', { number: ticket.displayNumber })}`}
      className="flex min-h-14 w-full items-center gap-3 rounded-input bg-surface/70 px-3 text-start ring-1 ring-line ring-inset transition-colors hover:bg-surface"
    >
      <StatusGlyph status="collected" className="size-5 text-ok" />
      <span className="num min-w-0 truncate font-display text-2xl font-bold tracking-tight text-ink-2">{ticket.displayNumber}</span>
      <span className="num ms-auto shrink-0 text-sm whitespace-nowrap text-muted">{t('agoMinutes', { count: mins })}</span>
    </button>
  );
}
