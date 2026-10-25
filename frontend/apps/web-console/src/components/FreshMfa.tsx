import { zodResolver } from '@hookform/resolvers/zod';
import { totpConfirmBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, Modal } from '@dop/ui';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { authApi } from '../lib/api';
import { errorText, isCode } from '../lib/errors';

// Fresh MFA (TR-FE-23): destructive actions answer MFA_REQUIRED when the last check is older than 15 minutes.
// run(fn) asks for a TOTP code, refreshes the MFA time of the session and retries once.

type Run = <T>(fn: () => Promise<T>) => Promise<T>;
const Ctx = createContext<Run | null>(null);

export class MfaCancelled extends Error {
  constructor() {
    super('MFA cancelled');
    this.name = 'MfaCancelled';
  }
}

export function FreshMfaProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const run = useCallback<Run>(async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (!isCode(e, 'MFA_REQUIRED')) throw e;
      await new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setOpen(true);
      });
      return fn();
    }
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    const p = pending.current;
    pending.current = null;
    if (ok) p?.resolve();
    else p?.reject(new MfaCancelled());
  };

  return (
    <Ctx.Provider value={run}>
      {children}
      <MfaDialog open={open} onDone={finish} />
    </Ctx.Provider>
  );
}

function MfaDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(totpConfirmBody), defaultValues: { code: '' } });
  const [err, setErr] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      await authApi.post('/mfa/refresh', v);
      form.reset();
      onDone(true);
    } catch (e) {
      setErr(errorText(t, e));
    }
  });
  return (
    <Modal open={open} onOpenChange={(o) => !o && onDone(false)} title={t('mfa.freshTitle')} description={t('mfa.freshBody')}>
      <div className="mb-4 flex items-center gap-3 rounded-xl bg-primary-wash p-3 border border-primary/20 text-ink">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-5" aria-hidden="true">
            <rect x="4" y="8" width="12" height="9" rx="1.5" />
            <path d="M7 8V5.5a3 3 0 016 0V8" />
          </svg>
        </span>
        <span className="text-xs sm:text-sm font-medium">{t('mfa.freshBody')}</span>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label={t('mfa.code')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          dir="ltr"
          className="font-mono text-center tracking-[0.35em] text-lg font-bold"
          autoFocus
          error={form.formState.errors.code ? t('mfa.codeInvalid') : (err ?? undefined)}
          {...form.register('code')}
        />
        <div className="flex flex-wrap justify-end gap-2.5 pt-2">
          <Button type="button" variant="secondary" onClick={() => onDone(false)}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            {t('mfa.verify')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function useFreshMfa(): Run {
  const run = useContext(Ctx);
  if (!run) throw new Error('FreshMfaProvider missing');
  return run;
}
