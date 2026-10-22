import { useTranslation } from '@dop/i18n';
import { Banner, LiveRegion } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Loading } from '../components/common';
import { authApi } from '../lib/api';
import { errorText } from '../lib/errors';
import { meKey } from '../lib/me';
import { setSupportMode } from '../lib/support';
import { AuthCard } from './SignIn';

/** Landing for a platform support agent (FR-SUP-04, TR-AUTH-06): exchanges the one-time code for the support cookie. */
export function SupportHandoffPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
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
        await authApi.post('/support/exchange', { code });
        setSupportMode(true);
        qc.removeQueries({ queryKey: meKey });
        navigate('/', { replace: true });
      } catch (e) {
        setError(errorText(t, e));
      }
    })();
  }, [code, navigate, qc, t]);

  return (
    <AuthCard title={t('supportHandoff.title')}>
      {error ? (
        <Banner tone="danger">{error}</Banner>
      ) : (
        <>
          <Loading />
          <LiveRegion text={t('supportHandoff.working')} />
        </>
      )}
    </AuthCard>
  );
}
