import { useTranslation } from '@dop/i18n';
import { Button, Modal } from '@dop/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { errorText, isApiError, signInApi } from '../lib/api';
import { finishPin, signInMember, useMember } from '../lib/member';
import { usePinLock } from '../lib/pinLock';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Personal PIN pad for named staff (FR-ACC-07, TR-AUTH-12). Opens when a write needs a person. */
export function MemberPinDialog() {
  const asking = useMember((s) => s.asking);
  return asking ? <PinPad /> : null;
}

function PinPad() {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; locked: boolean } | null>(null);
  // Personal PIN lock (FR-ACC-06): timed, with a countdown, like the device sign-in.
  const lock = usePinLock(() => setError(null));
  const locked = lock.locked;

  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));
  const back = () => setPin((p) => p.slice(0, -1));
  const ready = /^\d{4,6}$/.test(pin) && !busy && !locked;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await signInApi.post<{ memberToken: string; name: string }>('/members/unlock', { pin });
      signInMember(r.memberToken, r.name);
      finishPin(true);
    } catch (err) {
      setPin('');
      if (isApiError(err, 'PIN_LOCKED')) {
        lock.lockFrom(err);
        setError({ text: t('signIn.locked'), locked: true });
      }
      else if (isApiError(err, 'UNAUTHENTICATED')) setError({ text: t('signIn.wrongPin'), locked: false });
      else setError({ text: errorText(t, err), locked: false });
      setBusy(false);
    }
  };

  // Physical keyboards: digits, Backspace and Enter work while the pad is open.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') {
        e.preventDefault();
        void submitRef.current();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Modal open onOpenChange={(o) => !o && finishPin(false)} title={t('member.title')} description={t('member.description')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <output aria-label={t('signIn.pin')} aria-live="polite" className="num flex h-14 items-center gap-3 text-4xl tracking-widest">
            {pin.length === 0 ? <span className="text-lg text-muted">{t('signIn.pinHint')}</span> : '•'.repeat(pin.length)}
          </output>
          <span className="sr-only">{t('signIn.digitsEntered', { n: pin.length })}</span>
        </div>
        <div className="num grid grid-cols-3 gap-3" dir="ltr">
          {KEYS.map((d) => (
            <Button key={d} type="button" variant="secondary" size="lg" disabled={busy || locked} onClick={() => press(d)}>
              {d}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="lg" onClick={back} aria-label={t('signIn.delete')} disabled={busy}>
            <Icon name="close" className="size-7" />
          </Button>
          <Button type="button" variant="secondary" size="lg" disabled={busy || locked} onClick={() => press('0')}>
            0
          </Button>
          <span />
        </div>
        {error && (
          <p role="alert" className={`rounded-lg p-3 text-center font-semibold ${error.locked ? 'bg-danger text-white' : 'bg-danger-bg text-danger'}`}>
            {error.text}
            {locked && <span className="num mt-1 block">{t('signIn.lockedFor', { time: lock.timeLeft })}</span>}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="lg" className="flex-1" busy={busy} disabled={!ready}>
            {t('member.continue')}
          </Button>
          <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={() => finishPin(false)}>
            {t('common:close')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
