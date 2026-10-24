import { useTranslation } from '@dop/i18n';
import { AuthShell, Button, Field, Select } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BOARD_KEY } from '../board/boardData';
import { Icon } from '../components/Icon';
import { LangSwitch } from '../components/LangSwitch';
import { PIN_MAX, PinPad } from '../components/PinPad';
import { Notice } from '../components/Notice';
import { errorText, isApiError, signInApi } from '../lib/api';
import { storedCounterId, storeCounterId } from '../lib/counter';
import { usePinLock } from '../lib/pinLock';
import { storeDeviceName, storedDeviceName, storeStaffKey } from '../lib/lang';
import { useStaff } from '../lib/store';

const STAFF_KEY = /^[0-9A-Za-z]{32}$/;

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
  const [counters, setCounters] = useState<Array<{ id: string; name: string }>>([]);
  const [counterId, setCounterId] = useState('');
  const [error, setError] = useState<{ text: string; locked: boolean } | null>(null);
  // PIN lock (FR-ACC-06): input stays disabled only until the lock ends, with a visible countdown.
  const lock = usePinLock(() => setError(null));
  const locked = lock.locked;

  // The venue's counters come with the staff link, so the device can pick one before the PIN.
  useEffect(() => {
    if (!STAFF_KEY.test(staffKey)) return;
    signInApi
      .get<{ counters: Array<{ id: string; name: string }> }>(`/sessions/counters?staffKey=${staffKey}`)
      .then((r) => {
        setCounters(r.counters);
        const saved = storedCounterId();
        setCounterId(r.counters.find((c) => c.id === saved)?.id ?? r.counters[0]?.id ?? '');
      })
      .catch(() => undefined);
  }, [staffKey]);

  // Physical keyboard: digits and Backspace drive the pad unless a text field has focus.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (locked || busy || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < PIN_MAX ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, busy]);

  if (!STAFF_KEY.test(staffKey)) return <Notice title={t('signIn.badLink')}>{t('signIn.badLinkBody')}</Notice>;

  const press = (d: string) => setPin((p) => (p.length < PIN_MAX ? p + d : p));
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
      storeStaffKey(staffKey);
      useStaff.getState().setSignedOut(false);
      qc.removeQueries({ queryKey: BOARD_KEY });
      storeCounterId(counters.length > 1 ? counterId : '');
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
    <AuthShell
      appTitle={t('signIn.appTitle')}
      panelEyebrow={t('signIn.panelEyebrow')}
      headline={t('signIn.headline')}
      points={[t('signIn.points.tap'), t('signIn.points.undo'), t('signIn.points.devices')]}
      eyebrow={t('signIn.eyebrow')}
      title={t('signIn.title')}
      corner={<LangSwitch />}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        {editName ? (
          <Field label={t('signIn.deviceName')} hint={t('signIn.deviceNameHint')} value={deviceName} maxLength={60} required onChange={(e) => setDeviceName(e.target.value)} />
        ) : (
          <div className="flex items-center gap-3 rounded-input bg-canvas py-1.5 ps-3 pe-1.5 ring-1 ring-line ring-inset">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-ink-2 ring-1 ring-line">
              <Icon name="device" className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="eyebrow">{t('signIn.device')}</span>
              <strong className="truncate font-semibold">{deviceName}</strong>
            </span>
            <Button type="button" variant="ghost" onClick={() => setEditName(true)}>
              {t('signIn.changeName')}
            </Button>
          </div>
        )}

        {counters.length > 1 && (
          <Select label={t('counter')} value={counterId} onChange={(e) => setCounterId(e.target.value)} options={counters.map((c) => ({ value: c.id, label: c.name }))} />
        )}

        <div className="flex flex-col gap-3">
          <span id="pin-label" className="text-sm font-semibold text-ink-2">
            {t('signIn.pin')}
          </span>
          <PinPad pin={pin} labelId="pin-label" disabled={locked} busy={busy} onPress={press} onBack={back} large />
        </div>

        {error && (
          <p role="alert" className={`rounded-input px-4 py-3 text-center font-semibold ${error.locked ? 'bg-danger text-white' : 'bg-danger-bg text-danger'}`}>
            {error.text}
            {locked && <span className="num mt-1 block font-medium">{t('signIn.lockedFor', { time: lock.timeLeft })}</span>}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" busy={busy} disabled={!ready || locked}>
          {t('signIn.open')}
        </Button>
      </form>
    </AuthShell>
  );
}
