import { useTranslation } from '@dop/i18n';
import { Spinner } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { FormCard } from '../components/FormCard';
import { CredentialsForm, LinkGoogleForm, MfaForm } from '../components/SignInForms';
import { TenantChooser } from '../components/TenantChooser';
import { authApi, type MeResponse } from '../lib/api';

type Step = { kind: 'credentials' } | { kind: 'mfa'; mfaToken: string } | { kind: 'link'; linkToken: string } | { kind: 'tenants' };

/**
 * Google sign-in returns here with `#mfa=<token>` for an account with an authenticator, or `#link=<token>` when an
 * account with a password already uses that email (M-1). Both are single-use and short-lived; the fragment is read
 * once and removed from the address bar and history entry.
 */
function takeMfaFromFragment(): Step | null {
  const m = /^#(mfa|link)=([^&]+)$/.exec(window.location.hash);
  if (!m) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const token = decodeURIComponent(m[2]!);
  return m[1] === 'link' ? { kind: 'link', linkToken: token } : { kind: 'mfa', mfaToken: token };
}

/** Sign-in with tenant chooser (TRD §16.7): credentials → optional TOTP → choose restaurant → handoff. */
export function SignInPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step | null>(takeMfaFromFragment);
  // An existing www session skips straight to the chooser.
  const existing = useQuery({ queryKey: ['www-me'], queryFn: () => authApi.get<MeResponse>('/me'), retry: false, enabled: step === null });

  const toCredentials = useCallback(() => {
    qc.removeQueries({ queryKey: ['www-tenants'] });
    qc.removeQueries({ queryKey: ['www-me'] });
    setStep({ kind: 'credentials' });
  }, [qc]);
  const toTenants = useCallback(() => {
    qc.removeQueries({ queryKey: ['www-tenants'] });
    setStep({ kind: 'tenants' });
  }, [qc]);

  let current: Step;
  if (step) current = step;
  else if (existing.isPending) return <Spinner label={t('common:loading')} />;
  else current = existing.isSuccess ? { kind: 'tenants' } : { kind: 'credentials' };

  if (current.kind === 'link') {
    return (
      <FormCard title={t('signin.linkTitle')}>
        <LinkGoogleForm linkToken={current.linkToken} onDone={(nx) => (nx.kind === 'mfa' ? setStep({ kind: 'mfa', mfaToken: nx.mfaToken }) : toTenants())} onBack={toCredentials} />
      </FormCard>
    );
  }
  if (current.kind === 'mfa') {
    return (
      <FormCard title={t('signin.mfaTitle')}>
        <MfaForm mfaToken={current.mfaToken} onDone={toTenants} onBack={toCredentials} />
      </FormCard>
    );
  }
  if (current.kind === 'tenants') {
    return (
      <FormCard title={t('signin.chooseTitle')}>
        <TenantChooser onSignedOut={toCredentials} />
      </FormCard>
    );
  }
  return (
    <FormCard title={t('signin.title')}>
      <CredentialsForm onDone={(n) => (n.kind === 'mfa' ? setStep({ kind: 'mfa', mfaToken: n.mfaToken }) : toTenants())} />
    </FormCard>
  );
}
