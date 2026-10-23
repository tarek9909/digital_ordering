import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { api, errorText, isApiError, vq } from '../lib/api';
import { claimAgeMinutes, type ClaimItem } from '../lib/claims';
import { useStaff } from '../lib/store';

export const CLAIMS_PANEL_ID = 'claims-panel';

interface Props {
  claims: ClaimItem[];
  now: number;
  disabled: boolean;
  onError: (text: string) => void;
}

/** Staff-approved claims (FR-STF-15): a customer asks to follow an order; staff approve or refuse it. */
export function ClaimsPanel({ claims, now, disabled, onError }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<Record<string, 'approve' | 'refuse'>>({});

  if (claims.length === 0) return null;

  const decide = async (c: ClaimItem, approve: boolean) => {
    setBusy((b) => ({ ...b, [c.claimId]: approve ? 'approve' : 'refuse' }));
    const st = useStaff.getState();
    try {
      const r = await api.post<{ status: string }>(vq(`/claims/${c.claimId}/decision`), { approve });
      st.claimAction({ type: 'decided', claimId: c.claimId });
      const done = r?.status === 'approved' || r?.status === 'refused' ? r.status : approve ? 'approved' : 'refused';
      st.announce(t(`claims.${done}`, { number: c.displayNumber }));
    } catch (e) {
      // Already decided on another device, or expired: drop it from the list.
      if (isApiError(e, 'NOT_FOUND') || isApiError(e, 'CONFLICT')) st.claimAction({ type: 'decided', claimId: c.claimId });
      onError(errorText(t, e));
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[c.claimId];
        return next;
      });
    }
  };

  return (
    <section
      id={CLAIMS_PANEL_ID}
      tabIndex={-1}
      aria-labelledby="claims-title"
      className="mx-3 mt-3 rounded-[var(--radius-card)] bg-surface p-3 shadow-card ring-2 ring-warn/35 sm:mx-4 sm:p-4"
    >
      <h2 id="claims-title" className="mb-3 flex items-center gap-2 px-1 font-display text-lg font-bold tracking-tight">
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-warn-bg text-warn">
          <Icon name="phone" className="size-4" />
        </span>
        {t('claims.title')}
        <span className="num grid min-w-8 place-items-center rounded-full bg-warn px-2 py-0.5 text-sm font-bold text-white">{claims.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {claims.map((c) => (
          <li key={c.claimId} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-input bg-canvas p-2 ps-4">
            <span className="num font-display text-4xl leading-none font-extrabold tracking-tight">{c.displayNumber}</span>
            <span className="me-auto flex min-w-40 flex-1 flex-col text-sm">
              <span className="font-semibold text-ink">{t('claims.asks')}</span>
              <span className="num text-muted">{t('claims.age', { count: claimAgeMinutes(c, now) })}</span>
            </span>
            <span className="flex w-full gap-2 sm:w-auto">
              <Button
                variant="ink"
                className="flex-1 sm:flex-none"
                busy={busy[c.claimId] === 'approve'}
                disabled={disabled || Boolean(busy[c.claimId])}
                onClick={() => void decide(c, true)}
                aria-label={t('claims.approveFor', { number: c.displayNumber })}
              >
                <Icon name="check" />
                {t('claims.approve')}
              </Button>
              <Button
                variant="secondary"
                className="flex-1 sm:flex-none"
                busy={busy[c.claimId] === 'refuse'}
                disabled={disabled || Boolean(busy[c.claimId])}
                onClick={() => void decide(c, false)}
                aria-label={t('claims.refuseFor', { number: c.displayNumber })}
              >
                <Icon name="close" />
                {t('claims.refuse')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
