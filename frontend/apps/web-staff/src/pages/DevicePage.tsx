import { useTranslation } from '@dop/i18n';
import { Button, Card, Field, PageShell } from '@dop/ui';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useBoardQuery } from '../board/boardData';
import { Icon } from '../components/Icon';
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
  const venue = query.data?.venue.name;

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
      eyebrow={venue}
      title={t('device.title')}
      actions={
        <div className="flex items-center gap-1">
          <LangSwitch />
          <Link to="/" className="inline-flex min-h-12 items-center gap-2 rounded-control bg-ink px-5 font-semibold text-white shadow-button transition-colors hover:bg-ink-2">
            <Icon name="arrowBack" className="size-5 rtl:rotate-180" />
            {t('device.backToBoard')}
          </Link>
        </div>
      }
    >
      <div className="grid max-w-3xl gap-4">
        <Card className="flex flex-col gap-4">
          {device ? (
            <form onSubmit={rename} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field className="flex-1" label={t('signIn.deviceName')} value={value} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="ink" busy={busy === 'rename'}>
                {t('common:save')}
              </Button>
            </form>
          ) : (
            <p className="text-ink-2">{t('device.personal')}</p>
          )}
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={`rounded-input px-4 py-2.5 text-sm font-semibold ${msg.ok ? 'bg-ok-bg text-ok' : 'bg-danger-bg text-danger'}`}>
              {msg.text}
            </p>
          )}
        </Card>

        <Card>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 font-display text-lg font-bold tracking-tight">{t('device.mode')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['board', 'kitchen'] as const).map((m) => {
                const on = (device?.mode ?? 'board') === m;
                return (
                  <label
                    key={m}
                    className={`relative flex min-h-24 cursor-pointer flex-col gap-1 rounded-input p-4 ring-inset transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary ${on ? 'bg-ink text-white ring-0' : 'bg-surface ring-1 ring-line hover:bg-canvas'} ${device ? '' : 'cursor-not-allowed opacity-60'}`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={m}
                      checked={on}
                      disabled={!device || busy === 'mode'}
                      onChange={() => void setMode(m)}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-2 font-display text-lg font-bold">
                      <span aria-hidden="true" className={`grid size-5 place-items-center rounded-full ring-2 ${on ? 'ring-white' : 'ring-line'}`}>
                        {on && <span className="size-2.5 rounded-full bg-white" />}
                      </span>
                      {t(m === 'board' ? 'device.modeBoard' : 'device.modeKitchen')}
                    </span>
                    <span className={`text-sm ${on ? 'text-white/75' : 'text-muted'}`}>{t(m === 'board' ? 'device.modeBoardHint' : 'device.modeKitchenHint')}</span>
                  </label>
                );
              })}
            </div>
            {!device && (
              <p className="text-sm text-ink-2">
                {t('device.kitchenLink')}{' '}
                <Link to="/kitchen" className="font-semibold text-ink underline decoration-primary decoration-2 underline-offset-4">
                  {t('device.openKitchen')}
                </Link>
              </p>
            )}
          </fieldset>
        </Card>

        {device && (
          <div className="flex justify-end">
            <Button variant="danger" size="lg" busy={busy === 'signout'} onClick={() => void signOut()}>
              {t('common:signOut')}
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
