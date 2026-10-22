import type { StaffTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Modal } from '@dop/ui';
import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useStaff } from '../lib/store';
import { canReopen, isOpenStatus } from '../lib/ticketState';
import { AlertLevelLabel } from './TicketCard';
import type { TransitionTo } from './useTicketActions';

function Item({ children, onClick, danger, off }: { children: ReactNode; onClick: () => void; danger?: boolean; off: boolean }) {
  return (
    <Button variant={danger ? 'danger' : 'secondary'} className="w-full justify-start" disabled={off} onClick={onClick}>
      {children}
    </Button>
  );
}

interface Props {
  ticket: StaffTicket;
  now: number;
  disabled: boolean;
  onClose: () => void;
  onQr: () => void;
  onTransition: (to: TransitionTo) => void;
  onWait: (delta: number) => void;
  onEdit: () => void;
  onCancel: () => void;
  onAlert: () => void;
}

/** Card menu (TRD §16.3): QR again, back to preparing, adjust wait, edit, cancel, alert again, reopen. */
export function CardMenu({ ticket, now, disabled, onClose, onQr, onTransition, onWait, onEdit, onCancel, onAlert }: Props) {
  const { t } = useTranslation();
  const busy = useStaff((s) => Boolean(s.busy[ticket.id]));
  const off = disabled || busy;
  const open = isOpenStatus(ticket.status);
  const waiting = ticket.status === 'received' || ticket.status === 'preparing';

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('menu.title', { number: ticket.displayNumber })}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
        <span className="font-semibold text-ink">{t(`common:status.${ticket.status}`)}</span>
        <AlertLevelLabel ticket={ticket} />
        {ticket.waitMinutes !== null && waiting && <span>{t('waitMinutes', { count: ticket.waitMinutes })}</span>}
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" className="w-full justify-start" onClick={onQr}>
          <Icon name="qr" />
          {t('menu.showQr')}
        </Button>
        {ticket.status === 'received' && <Item off={off} onClick={() => onTransition('ready')}>{t('actions.ready')}</Item>}
        {ticket.status === 'ready' && <Item off={off} onClick={() => onTransition('preparing')}>{t('menu.backToPreparing')}</Item>}
        {ticket.status === 'ready' && (
          <Item off={off} onClick={onAlert}>
            <Icon name="megaphone" />
            {t('menu.alertAgain')}
          </Item>
        )}
        {waiting && (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={off} onClick={() => onWait(-5)}>
              {t('menu.waitMinus')}
            </Button>
            <Button variant="secondary" className="flex-1" disabled={off} onClick={() => onWait(5)}>
              {t('menu.waitPlus')}
            </Button>
          </div>
        )}
        {open && <Item off={off} onClick={onEdit}>{t('menu.edit')}</Item>}
        {canReopen(ticket, now) && <Item off={off} onClick={() => onTransition('ready')}>{t('menu.reopen')}</Item>}
        {open && (
          <Item off={off} danger onClick={onCancel}>
            {t('menu.cancel')}
          </Item>
        )}
        <Button variant="ghost" className="w-full" onClick={onClose}>
          {t('common:close')}
        </Button>
      </div>
    </Modal>
  );
}
