import type { PublicTicket } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { unlockAudio } from '../lib/audio';

// Full-screen Ready view (FR-CUS-04/05, TR-ALR-11/12): flashing brand colour at 1 Hz (static for reduced motion),
// "I'm coming", and the check code once acknowledged.
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
  const { t } = useTranslation();
  const collection = ticket.venue.messages[ticket.venue.locales[0] ?? 'ar']?.collection;
  if (needsTap && !ticket.acknowledged) {
    return (
      <button
        className="flash fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 p-6 text-center"
        onClick={async () => {
          await unlockAudio();
          onTapToHear();
        }}
      >
        <span className="num font-display text-[30vw] font-extrabold leading-none tracking-tight">{ticket.displayNumber}</span>
        <span className="font-display text-3xl font-bold">🔊 {t('tapToHear')}</span>
      </button>
    );
  }
  return (
    <main
      className={`flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8 text-center ${alerting && !ticket.acknowledged ? 'flash' : ''}`}
      style={alerting && !ticket.acknowledged ? undefined : { background: 'var(--brand-band)', color: 'var(--on-band)' }}
    >
      <p className="font-display text-3xl font-extrabold">{ticket.acknowledged ? t('status.readyAck') : t('status.ready')}</p>
      <div className="num font-display font-extrabold leading-none tracking-tight" style={{ fontSize: 'clamp(33vw, 40vw, 14rem)' }}>
        {ticket.displayNumber}
      </div>
      {collection && <p className="text-xl font-semibold">{collection}</p>}
      {ticket.checkCode && ticket.acknowledged && (
        <div className="rounded-[1.75rem] bg-white px-8 py-5 text-ink shadow-card">
          <p className="eyebrow">{t('checkCode')}</p>
          <p className="num font-display text-5xl font-extrabold tracking-[0.3em]">{ticket.checkCode}</p>
        </div>
      )}
      {!ticket.acknowledged && (
        <Button size="xl" variant="secondary" className="w-full max-w-md" onClick={onComing}>
          {t('comingButton')}
        </Button>
      )}
    </main>
  );
}
