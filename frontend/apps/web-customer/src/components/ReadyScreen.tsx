import type { PublicTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { useState } from 'react';
import { unlockAudio } from '../lib/audio';
import { SoundIcon } from './icons';
import { lastRingProgress, numberSize, OrderRing } from './OrderRing';

// Full-screen Ready view (FR-CUS-04/05, TR-ALR-11/12): the venue's colour, the call ring snapping shut around the
// number, flashing at 1 Hz while alerting (static for reduced motion), "I'm coming", and the check code once
// acknowledged.
export function ReadyScreen({
  ticket,
  alerting,
  needsTap,
  onTapToHear,
  onComing,
}: {
  ticket: PublicTicket;
  alerting: boolean;
  needsTap: boolean;
  onTapToHear: () => void;
  onComing: () => void;
}) {
  const { t, i18n } = useTranslation();
  // The colour floods out from the ring only when this page watched the order turn ready.
  const [flood] = useState(() => {
    const p = lastRingProgress(ticket.token);
    return p !== undefined && p < 1;
  });
  // The customer's selected language first, then the venue default (CSD09, TR-L10N-02).
  const messages = ticket.venue.messages;
  const collection = messages[i18n.language]?.collection || messages[ticket.venue.locales[0] ?? 'ar']?.collection;
  if (needsTap && !ticket.acknowledged) {
    return (
      <button
        className="flash fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 p-6 text-center"
        onClick={async () => {
          await unlockAudio();
          onTapToHear();
        }}
      >
        <span className="num font-display leading-none font-bold tracking-tight" style={{ fontSize: 'min(40vw, 14rem)' }}>
          {ticket.displayNumber}
        </span>
        <span className="inline-flex min-h-16 w-full max-w-sm items-center justify-center gap-3 rounded-control px-6 py-3 font-display text-xl font-bold ring-2 ring-current">
          <SoundIcon className="size-7 shrink-0" />
          {t('tapToHear')}
        </span>
      </button>
    );
  }
  const flashing = alerting && !ticket.acknowledged;
  return (
    <main className={`flex flex-1 flex-col ${flood ? 'ready-flood' : ''}`} style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}>
      <div className={`flex flex-1 flex-col items-center justify-center gap-6 px-4 pt-8 pb-6 text-center ${flashing ? 'flash' : ''}`}>
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-balance">
          {ticket.acknowledged ? t('status.readyAck') : t('status.ready')}
        </h1>
        <OrderRing token={ticket.token} progress={1} ready tone="current" className="w-[min(78vw,20rem)]">
          <div className="num font-display leading-[0.95] font-bold tracking-tight tabular-nums" style={{ fontSize: numberSize(ticket.displayNumber) }}>
            {ticket.displayNumber}
          </div>
        </OrderRing>
        {collection && <p className="max-w-sm text-lg font-medium text-balance opacity-90">{collection}</p>}
        {ticket.checkCode && ticket.acknowledged && (
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm font-medium opacity-80">{t('checkCode')}</p>
            <p className="num font-display text-5xl font-bold tracking-[0.3em] tabular-nums">{ticket.checkCode}</p>
          </div>
        )}
        {!ticket.acknowledged && (
          <Button size="xl" variant="secondary" className="mt-2 w-full max-w-md border-0" onClick={onComing}>
            {t('comingButton')}
          </Button>
        )}
      </div>
    </main>
  );
}
