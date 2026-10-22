import { useTranslation } from '@dop/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { QueryView, Section, Stat, StatusPill, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { formatDuration, pct } from '../lib/format';
import { useCurrentVenueId } from '../lib/venue';
import type { Onboarding, OnboardingKey, TodayReport, WaitingTicket } from '../lib/types';

const STEP_LINKS: Record<OnboardingKey, string> = {
  verify_email: '/account',
  branding: '/venue?tab=branding',
  messages: '/venue?tab=messages',
  staff_pin: '/staff-access',
  staff_device: '/staff-access',
  display: '/displays',
  posters: '/posters',
  test_ticket: '/staff',
};

/** Staff board link for owners and managers (FR-STF-17); the board is a separate app on the same host. */
export const staffBoardUrl = (venueId: string | null) => `/staff${venueId ? `?venueId=${encodeURIComponent(venueId)}` : ''}`;

function Checklist() {
  const { t } = useTranslation();
  // Re-polled so it ticks itself as the owner completes steps elsewhere (FR-ADM-02).
  const q = useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<Onboarding>('/onboarding'), refetchInterval: 30_000, refetchOnWindowFocus: true });
  return (
    <QueryView q={q}>
      {(o) =>
        o.complete ? null : (
          <Section title={t('onboarding.title')} description={t('onboarding.progress', { done: o.steps.filter((s) => s.done).length, total: o.steps.length })}>
            <ol className="flex flex-col gap-1">
              {o.steps.map((s, i) => (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2 last:border-0">
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className={`grid size-8 place-items-center rounded-full border-2 font-bold ${s.done ? 'border-ok bg-ok text-white' : 'border-line'}`}>
                      {s.done ? '✓' : i + 1}
                    </span>
                    <span className={s.done ? 'text-muted line-through' : 'font-medium'}>{t(`onboarding.steps.${s.key}`)}</span>
                    <span className="sr-only">{s.done ? t('onboarding.done') : t('onboarding.todo')}</span>
                  </span>
                  {!s.done &&
                    (s.key === 'test_ticket' ? (
                      <a className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 font-semibold text-on-primary" href={staffBoardUrl(o.venueId)}>
                        {t('onboarding.openBoard')}
                      </a>
                    ) : (
                      <Link className="inline-flex min-h-12 items-center rounded-lg border border-line px-4 font-semibold" to={STEP_LINKS[s.key]}>
                        {t('onboarding.go')}
                      </Link>
                    ))}
                </li>
              ))}
            </ol>
          </Section>
        )
      }
    </QueryView>
  );
}

export function TodayStats({ r }: { r: TodayReport }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('today.tickets')} value={r.tickets} />
        <Stat label={t('today.open')} value={r.open} />
        <Stat label={t('today.prep')} value={formatDuration(r.prepSecondsP50)} hint={t('reports.prepNote')} />
        <Stat label={t('today.pickup')} value={formatDuration(r.pickupSecondsP50)} hint={t('reports.pickupNote')} />
      </div>
      <h3 className="mb-2 font-bold">{t('today.reachTitle')}</h3>
      <div className="mb-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['push', 'live', 'closed', 'none'] as const).map((k) => (
          <Stat key={k} label={t(`common:alertLevel.${k}`)} value={r.alertReach[k]} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('today.reachPct')} value={pct(r.reachPushOrLivePct)} />
        <Stat label={t('today.ackPct')} value={pct(r.acknowledgedPct)} />
      </div>
      <p className="mt-3 text-sm text-muted">{t('reports.wordingNote')}</p>
      <LongestWaiting items={r.longestWaiting ?? []} />
    </>
  );
}

/** Open tickets waiting longest, oldest first (FR-RPT-01). Waiting time counts from ticket creation. */
export function LongestWaiting({ items }: { items: WaitingTicket[] }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4">
      <h3 className="mb-2 font-bold">{t('today.longestTitle')}</h3>
      {items.length === 0 ? (
        <p className="text-muted">{t('today.longestEmpty')}</p>
      ) : (
        <Table caption={t('today.longestTitle')} head={[t('today.longestNumber'), t('today.longestStatus'), t('today.longestWaiting')]}>
          {items.map((w) => (
            <tr key={w.id}>
              <Td>
                <span dir="ltr" className="num font-semibold">
                  {w.displayNumber}
                </span>
              </Td>
              <Td>{t(`common:status.${w.status}`, { defaultValue: w.status })}</Td>
              <Td className="num">{formatDuration(w.waitingSeconds)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-1 text-xs text-muted">{t('today.longestNote')}</p>
    </div>
  );
}

function Today({ venueId }: { venueId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['today', venueId], queryFn: () => api.get<TodayReport>('/reports/today', { venueId }), refetchInterval: 30_000 });
  return (
    <Section
      title={t('today.title')}
      description={q.data ? t('today.businessDate', { date: q.data.businessDate }) : undefined}
      actions={
        <a className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 font-semibold text-on-primary" href={staffBoardUrl(venueId)}>
          {t('onboarding.openBoard')}
        </a>
      }
    >
      <QueryView q={q}>{(r) => (r.tickets === 0 ? <p className="text-muted">{t('today.empty')}</p> : <TodayStats r={r} />)}</QueryView>
      {q.data && q.data.byStatus && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('today.byStatus')}>
          {Object.entries(q.data.byStatus).map(([s, n]) => (
            <li key={s}>
              <StatusPill tone="info">
                {t(`common:status.${s}`, { defaultValue: s })}: <span className="num">{n}</span>
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const venueId = useCurrentVenueId();
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t('nav.home')}</h1>
      <Checklist />
      {venueId && <Today venueId={venueId} />}
    </>
  );
}
