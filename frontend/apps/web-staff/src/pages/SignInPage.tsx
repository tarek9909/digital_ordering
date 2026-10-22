import { useTranslation } from '@dop/i18n';
import { Button, Field } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BOARD_KEY } from '../board/boardData';
import { Icon } from '../components/Icon';
import { LangSwitch } from '../components/LangSwitch';
import { Notice } from '../components/Notice';
import { errorText, isApiError, signInApi } from '../lib/api';
import { usePinLock } from '../lib/pinLock';
import { storeDeviceName, storedDeviceName } from '../lib/lang';
import { useStaff } from '../lib/store';

const STAFF_KEY = /^[0-9A-Za-z]{32}$/;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Staff link + PIN sign-in (FR-ACC-01, FR-ACC-05, FR-ACC-06). */
export function SignInPage() {
  const { staffKey = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const known = storedDeviceName();
  const [deviceName, setDeviceName] = useState(known);
  const [editName, setEditName] = useState(!known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; locked: boolean } | null>(null);
  // PIN lock (FR-ACC-06): input stays disabled only until the lock ends, with a visible countdown.
  const lock = usePinLock(() => setError(null));
  const locked = lock.locked;

  if (!STAFF_KEY.test(staffKey)) return <Notice title={t('signIn.badLink')}>{t('signIn.badLinkBody')}</Notice>;

  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));
  const back = () => setPin((p) => p.slice(0, -1));
  const name = deviceName.trim();
  const ready = /^\d{4,6}$/.test(pin) && name.length > 0 && !busy;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await signInApi.post('/sessions', { staffKey, pin, deviceName: name });
      storeDeviceName(name);
      useStaff.getState().setSignedOut(false);
      qc.removeQueries({ queryKey: BOARD_KEY });
      navigate('/', { replace: true });
    } catch (err) {
      setPin('');
      if (isApiError(err, 'PIN_LOCKED')) {
        lock.lockFrom(err);
        setError({ text: t('signIn.locked'), locked: true });
      }
      else if (isApiError(err, 'UNAUTHENTICATED')) setError({ text: t('signIn.wrongPin'), locked: false });
      else if (isApiError(err, 'NOT_FOUND')) setError({ text: t('signIn.badLinkBody'), locked: false });
      else setError({ text: errorText(t, err), locked: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas p-4">
      <div className="absolute end-3 top-3">
        <LangSwitch />
      </div>
      <h1 className="text-3xl font-bold">{t('signIn.title')}</h1>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        {editName ? (
          <Field label={t('signIn.deviceName')} hint={t('signIn.deviceNameHint')} value={deviceName} maxLength={60} required onChange={(e) => setDeviceName(e.target.value)} />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span>
              {t('signIn.device')}: <strong>{deviceName}</strong>
            </span>
            <Button type="button" variant="ghost" onClick={() => setEditName(true)}>
              {t('signIn.changeName')}
            </Button>
          </div>
        )}

        <div className="flex flex-col items-center gap-2">
          <span id="pin-label" className="font-medium">
            {t('signIn.pin')}
          </span>
          <output aria-labelledby="pin-label" aria-live="polite" className="num flex h-14 items-center gap-3 text-4xl tracking-widest">
            {pin.length === 0 ? <span className="text-lg text-muted">{t('signIn.pinHint')}</span> : '•'.repeat(pin.length)}
          </output>
          <span className="sr-only">{t('signIn.digitsEntered', { n: pin.length })}</span>
        </div>

        <div className="num grid grid-cols-3 gap-3" dir="ltr">
          {KEYS.map((d) => (
            <Button key={d} type="button" variant="secondary" size="xl" disabled={busy || locked} onClick={() => press(d)}>
              {d}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="xl" onClick={back} aria-label={t('signIn.delete')} disabled={busy}>
            <Icon name="close" className="size-7" />
          </Button>
          <Button type="button" variant="secondary" size="xl" disabled={busy || locked} onClick={() => press('0')}>
            0
          </Button>
          <span />
        </div>

        {error && (
          <p role="alert" className={`rounded-lg p-3 text-center font-semibold ${error.locked ? 'bg-danger text-white' : 'bg-danger-bg text-danger'}`}>
            {error.text}
            {locked && (
              <span className="num mt-1 block">
                {t('signIn.lockedFor', { time: lock.timeLeft })}
              </span>
            )}
          </p>
        )}

        <Button type="submit" size="lg" busy={busy} disabled={!ready || locked}>
          {t('signIn.open')}
        </Button>
      </form>
    </main>
  );
}
