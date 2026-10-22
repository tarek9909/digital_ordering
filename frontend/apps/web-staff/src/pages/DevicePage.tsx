import { useTranslation } from '@dop/i18n';
import { Button, Field, PageShell } from '@dop/ui';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useBoardQuery } from '../board/boardData';
import { LangSwitch } from '../components/LangSwitch';
import { deviceApi, errorText } from '../lib/api';
import { storeDeviceName } from '../lib/lang';
import { useStaff } from '../lib/store';
import { SignedOut } from '../board/BoardPage';

/** Device settings: name, board or kitchen mode (FR-STF-11), sign out. */
export function DevicePage() {
  const { t } = useTranslation();
  const query = useBoardQuery();
  const signedOut = useStaff((s) => s.signedOut);
  const device = query.data?.device ?? null;
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<'rename' | 'signout' | 'mode' | null>(null);

  if (signedOut) return <SignedOut />;

  const value = name ?? device?.name ?? '';

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy('rename');
    setMsg(null);
    try {
      await deviceApi.patch('/device', { name: value.trim() });
      storeDeviceName(value.trim());
      setMsg({ text: t('common:saved'), ok: true });
      void query.refetch();
    } catch (err) {
      setMsg({ text: errorText(t, err), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const setMode = async (mode: 'board' | 'kitchen') => {
    setBusy('mode');
    setMsg(null);
    try {
      await deviceApi.patch('/device', { mode });
      await query.refetch();
      setMsg({ text: t('common:saved'), ok: true });
    } catch (err) {
      setMsg({ text: errorText(t, err), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy('signout');
    try {
      await deviceApi.delete('/sessions/current');
      useStaff.getState().setSignedOut(true);
    } catch (err) {
      setMsg({ text: errorText(t, err), ok: false });
      setBusy(null);
    }
  };

  return (
    <PageShell
      title={t('device.title')}
      actions={
        <div className="flex gap-2">
          <LangSwitch />
          <Link to="/" className="inline-flex min-h-12 items-center rounded-lg border border-line bg-surface px-4 font-semibold">
            {t('device.backToBoard')}
          </Link>
        </div>
      }
    >
      <div className="flex max-w-md flex-col gap-6">
        {device ? (
          <form onSubmit={rename} className="flex flex-col gap-3">
            <Field label={t('signIn.deviceName')} value={value} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" busy={busy === 'rename'}>
              {t('common:save')}
            </Button>
          </form>
        ) : (
          <p className="text-muted">{t('device.personal')}</p>
        )}
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-ok' : 'text-danger'}>
            {msg.text}
          </p>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t('device.mode')}</legend>
          {(['board', 'kitchen'] as const).map((m) => (
            <label key={m} className={`flex min-h-12 items-center gap-3 ${device ? '' : 'text-muted'}`}>
              <input
                type="radio"
                name="mode"
                value={m}
                checked={(device?.mode ?? 'board') === m}
                disabled={!device || busy === 'mode'}
                onChange={() => void setMode(m)}
                className="size-5"
              />
              <span className="flex flex-col">
                <span>{t(m === 'board' ? 'device.modeBoard' : 'device.modeKitchen')}</span>
                <span className="text-sm text-muted">{t(m === 'board' ? 'device.modeBoardHint' : 'device.modeKitchenHint')}</span>
              </span>
            </label>
          ))}
          {!device && (
            <p className="text-sm text-muted">
              {t('device.kitchenLink')}{' '}
              <Link to="/kitchen" className="font-semibold text-primary underline">
                {t('device.openKitchen')}
              </Link>
            </p>
          )}
        </fieldset>
        {device && (
          <Button variant="danger" size="lg" busy={busy === 'signout'} onClick={() => void signOut()}>
            {t('common:signOut')}
          </Button>
        )}
      </div>
    </PageShell>
  );
}
