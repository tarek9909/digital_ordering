import { useTranslation } from '@dop/i18n';
import { Button, Modal } from '@dop/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PIN_MAX, PinPad } from '../components/PinPad';
import { errorText, isApiError, signInApi } from '../lib/api';
import { finishPin, signInMember, useMember } from '../lib/member';
import { usePinLock } from '../lib/pinLock';

/** Personal PIN pad for named staff (FR-ACC-07, TR-AUTH-12). Opens when a write needs a person. */
export function MemberPinDialog() {
  const asking = useMember((s) => s.asking);
  return asking ? <MemberPinPad /> : null;
}

function MemberPinPad() {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; locked: boolean } | null>(null);
  // Personal PIN lock (FR-ACC-06): timed, with a countdown, like the device sign-in.
  const lock = usePinLock(() => setError(null));
  const locked = lock.locked;

  const press = (d: string) => setPin((p) => (p.length < PIN_MAX ? p + d : p));
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
      <form onSubmit={submit} className="flex flex-col gap-5">
        <PinPad pin={pin} disabled={locked} busy={busy} onPress={press} onBack={back} />
        {error && (
          <p role="alert" className={`rounded-input px-4 py-3 text-center font-semibold ${error.locked ? 'bg-danger text-white' : 'bg-danger-bg text-danger'}`}>
            {error.text}
            {locked && <span className="num mt-1 block font-medium">{t('signIn.lockedFor', { time: lock.timeLeft })}</span>}
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
