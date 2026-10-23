import { useTranslation } from '@dop/i18n';
import { BrandMark, Button } from '@dop/ui';
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
    <main className="grid min-h-dvh grid-rows-[auto_1fr_auto] gap-[4vmin] bg-surface p-[5vmin] text-ink">
      <span className="flex items-center gap-[1.6vmin] font-display text-[max(1rem,2.8vmin)] font-bold">
        <span data-motion="draw" className="contents">
          <BrandMark className="size-[6vmin]" />
        </span>
        {t('common:appName')}
      </span>

      <form onSubmit={submit} className="mx-auto flex w-full max-w-[84vmin] flex-col items-center justify-center gap-[3vmin] text-center">
        <div className="flex flex-col items-center gap-[1.6vmin]">
          <h1 className="font-display text-[6.4vmin] leading-[1.05] font-extrabold tracking-tight text-balance">{t('pairing.title')}</h1>
          <p className="max-w-[70vmin] text-[max(1rem,2.6vmin)] leading-snug text-muted">{t('pairing.lead')}</p>
        </div>
        <label htmlFor="pair-code" className="sr-only">
          {t('pairing.code')}
        </label>
        <input
          id="pair-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'pair-error' : 'pair-help'}
          className="pair-code num mt-[1vmin] w-full rounded-[2.4vmin] border-[0.3vmin] border-line bg-canvas py-[2.4vmin] text-center text-[10vmin] leading-none font-medium text-ink focus-visible:border-primary focus-visible:bg-surface focus-visible:shadow-[0_0_0_1vmin_var(--color-primary-soft)] focus-visible:outline-none"
        />
        {error && (
          <p id="pair-error" role="alert" className="flex w-full items-center gap-[1.4vmin] rounded-[2vmin] bg-danger-bg px-[2.4vmin] py-[1.6vmin] text-start text-[max(1rem,2.4vmin)] font-semibold text-danger">
            <span aria-hidden="true" className="size-[1.4vmin] shrink-0 rounded-full bg-danger" />
            {error}
          </p>
        )}
        <Button type="submit" size="xl" busy={busy} disabled={!valid} className="min-h-[max(3rem,9vmin)] w-full text-[max(1.125rem,3vmin)]">
          {t('pairing.submit')}
        </Button>
      </form>

      <ol id="pair-help" className="mx-auto grid w-full max-w-[150vmin] gap-[2.4vmin] text-[max(0.875rem,2.2vmin)] leading-snug text-ink-2 landscape:grid-cols-3">
        {(['step1', 'step2', 'step3'] as const).map((k, i) => (
          <li key={k} className="flex items-baseline gap-[1.4vmin]">
            <span aria-hidden="true" className="num shrink-0 font-mono text-[max(0.75rem,2vmin)] font-medium text-muted">
              0{i + 1}
            </span>
            <span>{t(`pairing.${k}`)}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
