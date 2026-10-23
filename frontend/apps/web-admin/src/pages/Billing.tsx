import { formatDateTime, formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Banner, EmptyState, PageShell } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { QueryView, Section, StatusPill, Table, Td, usePageEyebrow } from '../components/common';
import { canManage } from '../lib/access';
import { api } from '../lib/api';
import { useRole } from '../lib/me';
import type { Billing, BillingPlan } from '../lib/types';

const billingKey = ['billing'] as const;

/** Prices of a plan, e.g. "USD 30.00 per venue · Monthly". */
function PlanPrices({ p }: { p: BillingPlan }) {
  const { t, i18n } = useTranslation();
  return (
    <ul className="flex flex-col gap-1">
      {p.prices.map((x) => (
        <li key={`${x.period}-${x.currency}`}>
          <span className="num font-semibold">{formatMoney(x.amountMinor, x.currency, i18n.language)}</span> <span className="text-ink-2">{t('billing.perVenue')}</span>{' '}
          <span className="text-muted">({t(`billing.periods.${x.period}`)})</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Billing (§12.7), read-only. Venues pay the platform team directly (cash, transfer or wallet); the team records each
 * payment, which extends the paid-until date. Plans are chosen or changed by contacting the team.
 */
export function BillingPage() {
  const { t, i18n } = useTranslation();
  const manage = canManage('billing', useRole());
  const q = useQuery({
    queryKey: billingKey,
    queryFn: () => api.get<Billing>('/billing'),
  });
  const date = (iso: string) => formatDateTime(iso, i18n.language);
  const eyebrow = usePageEyebrow('tenant');
  return (
    <PageShell eyebrow={eyebrow} title={t('nav.billing')} description={t('billing.description')}>
      <QueryView q={q} skeleton="form">
        {(b) => (
          <>
            <Section title={t('billing.plan')}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display text-3xl font-extrabold tracking-tight">{b.plan.name}</span>
                <StatusPill tone={b.status === 'active' ? 'ok' : b.status === 'trial' ? 'info' : b.status === 'past_due' ? 'warn' : 'danger'}>{t(`tenantStatus.${b.status}`)}</StatusPill>
                {b.complimentary && <StatusPill tone="ok">{t('billing.complimentary')}</StatusPill>}
              </div>
              {b.trialEndsAt && b.status === 'trial' && <p className="mt-3 text-ink-2">{t('billing.trialEnds', { date: date(b.trialEndsAt) })}</p>}
              {b.paidUntil && !b.complimentary && b.status !== 'trial' && <p className="mt-3 text-ink-2">{t('billing.paidUntil', { date: date(b.paidUntil) })}</p>}
              {b.graceEndsAt && b.status === 'past_due' && <p className="mt-3 text-ink-2">{t('billing.graceEnds', { date: date(b.graceEndsAt) })}</p>}
            </Section>
            {!b.complimentary && (
              <Section title={t('billing.renewTitle')}>
                <p className="max-w-2xl text-ink-2">{t('billing.renewBody')}</p>
              </Section>
            )}
            {!manage && (
              <div className="mb-5">
                <Banner tone="info">{t('billing.viewOnly')}</Banner>
              </div>
            )}
            <Section title={t('billing.pricesTitle')}>
              {(b.plans ?? []).length === 0 ? (
                <p className="text-muted">{t('billing.noPrices')}</p>
              ) : (
                <Table caption={t('billing.pricesTitle')} head={[t('billing.plan'), t('billing.limits'), t('billing.price')]}>
                  {(b.plans ?? []).map((p) => (
                    <tr key={p.code}>
                      <Td>
                        <span className="font-semibold">{p.name}</span>
                      </Td>
                      <Td>
                        {t('billing.planLimits', {
                          venues: p.limits.maxVenues,
                          counters: p.limits.maxCountersPerVenue,
                        })}
                      </Td>
                      <Td>
                        <PlanPrices p={p} />
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
            <Section title={t('billing.payments')}>
              {b.payments.length === 0 ? (
                <EmptyState title={t('billing.noPayments')}>{t('billing.noPaymentsBody')}</EmptyState>
              ) : (
                <Table caption={t('billing.payments')} head={[t('billing.date'), t('billing.amount'), t('billing.covers'), t('billing.method'), t('billing.reference')]}>
                  {b.payments.map((p) => (
                    <tr key={p.id}>
                      <Td className="whitespace-nowrap text-ink-2">{date(p.recordedAt)}</Td>
                      <Td className="num font-semibold whitespace-nowrap">{formatMoney(p.amountMinor, p.currency, i18n.language)}</Td>
                      <Td>
                        {t('billing.coversRange', {
                          from: date(p.coversFrom),
                          to: date(p.coversUntil),
                          count: p.months,
                        })}
                      </Td>
                      <Td>{t(`billing.methods.${p.method}`)}</Td>
                      <Td>
                        <span dir="ltr" className="font-mono text-xs text-muted">
                          {p.reference ?? '—'}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          </>
        )}
      </QueryView>
    </PageShell>
  );
}
