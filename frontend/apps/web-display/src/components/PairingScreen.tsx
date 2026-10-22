import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorText } from '../lib/api';
import { BOARD_KEY } from '../useDisplayBoard';

/** Pairing with the 6-digit code shown in the admin area (FR-DSP-01). */
export function PairingScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{6}$/.test(code);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/pair', { code });
      await qc.resetQueries({ queryKey: BOARD_KEY });
    } catch (err) {
      setCode('');
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-[4vmin] p-[4vmin] text-center">
      <p className="font-display text-[3.4vmin] font-bold text-primary">{t('common:appName')}</p>
      <h1 className="font-display text-[6vmin] font-bold">{t('pairing.title')}</h1>
      <form onSubmit={submit} className="flex flex-col items-center gap-[3vmin]">
        <label htmlFor="pair-code" className="text-[3vmin] text-ink-2">
          {t('pairing.code')}
        </label>
        <input
          id="pair-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'pair-error' : 'pair-help'}
          className="num w-[60vmin] rounded-[3vmin] border-[0.5vmin] border-line bg-canvas py-[2vmin] text-center font-mono text-[10vmin] font-medium tracking-[0.3em] text-ink focus-visible:border-primary focus-visible:outline-none"
        />
        {error && (
          <p id="pair-error" role="alert" className="rounded-full bg-danger-bg px-6 py-3 text-[3vmin] font-semibold text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="xl" busy={busy} disabled={!valid} className="min-w-[40vmin]">
          {t('pairing.submit')}
        </Button>
      </form>
      <ol id="pair-help" className="max-w-[90vmin] list-decimal space-y-[1vmin] ps-[4vmin] text-start text-[2.6vmin] text-muted">
        <li>{t('pairing.step1')}</li>
        <li>{t('pairing.step2')}</li>
        <li>{t('pairing.step3')}</li>
      </ol>
    </main>
  );
}
