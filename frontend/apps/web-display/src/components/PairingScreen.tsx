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
    <main className="grid min-h-dvh bg-surface text-ink landscape:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="ember-glow flex flex-col justify-between gap-[4vmin] bg-ink p-[6vmin] text-white portrait:min-h-[34vh]">
        <span className="flex items-center gap-[2vmin] font-display text-[3.4vmin] font-bold">
          <span data-motion="draw" className="contents">
            <BrandMark tone="light" className="size-[8vmin]" />
          </span>
          {t('common:appName')}
        </span>
        <div className="flex flex-col gap-[2.4vmin]">
          <p className="font-display text-[7.4vmin] leading-[1.02] font-extrabold tracking-tight text-balance">{t('pairing.title')}</p>
          <p className="max-w-[60vmin] text-[2.8vmin] leading-snug text-white/70">{t('pairing.lead')}</p>
        </div>
      </aside>

      <div className="flex flex-col items-center justify-center p-[6vmin]">
        <form onSubmit={submit} className="flex w-full max-w-[78vmin] flex-col gap-[3vmin]">
          <h1 className="sr-only">{t('pairing.title')}</h1>
          <label htmlFor="pair-code" className="font-display text-[3.2vmin] font-bold text-ink">
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
            className="pair-code num w-full rounded-[3vmin] border-[0.4vmin] border-line bg-canvas py-[2.6vmin] text-center text-[11vmin] leading-none font-medium text-ink focus-visible:border-primary focus-visible:bg-surface focus-visible:shadow-[0_0_0_1vmin_var(--color-primary-soft)] focus-visible:outline-none"
          />
          {error && (
            <p id="pair-error" role="alert" className="flex items-center gap-[1.4vmin] rounded-[2vmin] bg-danger-bg px-[2.4vmin] py-[1.6vmin] text-[2.6vmin] font-semibold text-danger">
              <span aria-hidden="true" className="size-[1.4vmin] shrink-0 rounded-full bg-danger" />
              {error}
            </p>
          )}
          <Button type="submit" size="xl" busy={busy} disabled={!valid} className="min-h-[10vmin] w-full text-[3.2vmin]">
            {t('pairing.submit')}
          </Button>
          <ol id="pair-help" className="mt-[1.6vmin] flex flex-col gap-[1.6vmin] border-t border-line pt-[3vmin] text-[2.5vmin] leading-snug text-ink-2">
            {(['step1', 'step2', 'step3'] as const).map((k, i) => (
              <li key={k} className="flex items-baseline gap-[1.8vmin]">
                <span aria-hidden="true" className="num flex size-[4vmin] shrink-0 items-center justify-center self-start rounded-full bg-ink/[0.06] font-mono text-[2vmin] font-medium text-ink">
                  {i + 1}
                </span>
                <span>{t(`pairing.${k}`)}</span>
              </li>
            ))}
          </ol>
        </form>
      </div>
    </main>
  );
}
