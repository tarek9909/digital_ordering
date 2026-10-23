import { useTranslation } from '@dop/i18n';
import { Button, Field, Spinner } from '@dop/ui';
import { useEffect, useState } from 'react';
import { publicApi } from '../lib/api';
import { navigate } from '../lib/router';
import { uaFamily } from '../lib/platform';
import { clientId, rememberTicket } from '../lib/storage';

// Claim by number on the venue page (FR-QR-06): with the claim code the phone joins at once; with staff
// approval the request waits for the board (polled every 3 s; the socket also pushes `claim.decided`).
export function ClaimForm({ venueCode, mode }: { venueCode: string; mode: 'code' | 'staff_approval' }) {
  const { t } = useTranslation();
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'invalid' | 'pending' | 'refused' | 'expired'>('idle');
  const [claimId, setClaimId] = useState<string | null>(null);

  useEffect(() => {
    if (state !== 'pending' || !claimId) return;
    const id = setInterval(async () => {
      try {
        const r = await publicApi.get<{ status: string; ticketToken?: string }>(`/claims/${claimId}`, { clientId: clientId() });
        if (r.status === 'approved' && r.ticketToken) {
          rememberTicket(r.ticketToken, venueCode);
          navigate(`/${r.ticketToken}`);
        } else if (r.status === 'refused' || r.status === 'expired') setState(r.status);
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [state, claimId, venueCode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('busy');
    try {
      const r = await publicApi.post<{ token?: string; claimId?: string }>(`/venues/${venueCode}/claims`, {
        clientId: clientId(),
        number: number.trim(),
        ...(mode === 'code' && { claimCode: code.trim() }),
        uaFamily: uaFamily(),
      });
      if (r.token) {
        rememberTicket(r.token, venueCode);
        navigate(`/${r.token}`);
      } else if (r.claimId) {
        setClaimId(r.claimId);
        setState('pending');
      }
    } catch {
      setState('invalid');
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight">{t('claim.title')}</h2>
        <p className="mt-1 text-ink-2">{t(mode === 'code' ? 'claim.introCode' : 'claim.introStaff')}</p>
      </div>
      <div className={mode === 'code' ? 'grid grid-cols-2 items-end gap-3' : ''}>
        <Field
          label={t('claim.number')}
          inputMode="text"
          autoComplete="off"
          dir="ltr"
          className="[&_input]:font-display [&_input]:text-xl [&_input]:font-bold [&_input]:tabular-nums"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          required
          maxLength={8}
        />
        {mode === 'code' && (
          <Field
            label={t('claim.code')}
            autoComplete="off"
            dir="ltr"
            className="[&_input]:font-mono [&_input]:text-xl [&_input]:tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            minLength={4}
            maxLength={4}
          />
        )}
      </div>
      {state === 'invalid' && (
        <p role="alert" className="text-danger">
          {t('claim.invalid')}
        </p>
      )}
      {state === 'pending' && (
        <p role="status" className="flex items-center gap-2 rounded-input bg-primary-wash p-3 text-ink-2">
          <Spinner />
          {t('claim.pending')}
        </p>
      )}
      {(state === 'refused' || state === 'expired') && (
        <p role="alert" className="text-danger">
          {t(`claim.${state}`)}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" busy={state === 'busy'} disabled={state === 'pending'}>
        {t('claim.submit')}
      </Button>
    </form>
  );
}
