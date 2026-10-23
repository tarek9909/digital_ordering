import { useTranslation } from '@dop/i18n';
import { Banner, LiveRegion } from '@dop/ui';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loading, textLinkClass } from '../components/common';
import { authApi } from '../lib/api';
import { errorText } from '../lib/errors';
import type { SignInResponse } from '../lib/types';
import { AuthCard, MfaStep, useFinishSignIn } from './SignIn';

/** Landing from the www tenant chooser: exchanges the one-time code for a session on this host (TR-TEN-13). */
export function HandoffPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const finish = useFinishSignIn();
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (code.length < 16) {
      setError(t('handoff.invalid'));
      return;
    }
    (async () => {
      try {
        const r = await authApi.post<SignInResponse>('/handoff/exchange', {
          code,
        });
        if (r.mfaRequired && r.mfaToken) return setMfaToken(r.mfaToken);
        if (!(await finish())) setError(t('signIn.notMember'));
      } catch (e) {
        setError(errorText(t, e));
      }
    })();
  }, [code, finish, t]);

  return (
    <AuthCard title={t('handoff.title')}>
      {mfaToken ? (
        <MfaStep mfaToken={mfaToken} onDone={finish} />
      ) : error ? (
        <div className="flex flex-col gap-4">
          <Banner tone="danger">{error}</Banner>
          <Link to="/sign-in" className={textLinkClass}>
            {t('handoff.signInInstead')}
          </Link>
        </div>
      ) : (
        <>
          <Loading />
          <LiveRegion text={t('handoff.working')} />
        </>
      )}
    </AuthCard>
  );
}
