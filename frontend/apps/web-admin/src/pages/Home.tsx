import { useTranslation } from '@dop/i18n';
import { EmptyState, Pill } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Figures, LoadingShape, Page, QueryView, Section, Stat, Table, Td, linkClass } from '../components/common';
import { api } from '../lib/api';
import { formatDuration, pct } from '../lib/format';
import { useCurrentVenueId } from '../lib/venue';
import type { Onboarding, OnboardingKey, Reach, TodayReport, WaitingTicket } from '../lib/types';

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

/** "What to do next": the set-up steps with a progress track; the first open step is the one to do now. */
function Checklist() {
  const { t } = useTranslation();
  // Re-polled so it ticks itself as the owner completes steps elsewhere (FR-ADM-02).
  const q = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api.get<Onboarding>('/onboarding'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  // Nothing while it loads: most days the list is complete and never shows.
  if (q.isPending) return null;
  return (
    <QueryView q={q}>
      {(o) => {
        if (o.complete) return null;
        const done = o.steps.filter((s) => s.done).length;
        const next = o.steps.find((s) => !s.done)?.key;
        return (
          <Section
            title={t('onboarding.title')}
            description={t('onboarding.progress', {
              done,
              total: o.steps.length,
            })}
          >
            <div className="mb-3 flex gap-1" aria-hidden="true">
              {o.steps.map((s) => (
                <span key={s.key} className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${s.done ? 'bg-ink' : s.key === next ? 'bg-ink/25' : 'bg-line'}`} />
              ))}
            </div>
            <ol className="flex flex-col">
              {o.steps.map((s, i) => {
                const isNext = s.key === next;
                return (
                  <li
                    key={s.key}
                    className={`flex flex-wrap items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 ${isNext ? '-mx-3 rounded-input border-transparent bg-canvas px-3' : ''}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`grid size-8 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${s.done ? 'bg-ok-bg text-ok' : isNext ? 'bg-ink text-white' : 'border border-line text-muted'}`}
                      >
                        {s.done ? '✓' : i + 1}
                      </span>
                      <span className={s.done ? 'text-muted line-through decoration-line' : isNext ? 'font-semibold' : 'font-medium text-ink-2'}>{t(`onboarding.steps.${s.key}`)}</span>
                      <span className="sr-only">{s.done ? t('onboarding.done') : t('onboarding.todo')}</span>
                      {isNext && <Pill tone="ink">{t('onboarding.next')}</Pill>}
                    </span>
                    {!s.done &&
                      (s.key === 'test_ticket' ? (
                        <a className={linkClass(isNext ? 'ink' : 'secondary')} href={staffBoardUrl(o.venueId)}>
                          {t('onboarding.openBoard')}
                        </a>
                      ) : (
                        <Link className={linkClass(isNext ? 'ink' : 'secondary')} to={STEP_LINKS[s.key]}>
                          {t('onboarding.go')}
                        </Link>
                      ))}
                  </li>
                );
              })}
            </ol>
          </Section>
        );
      }}
    </QueryView>
  );
}

const REACH_KEYS = ['push', 'live', 'closed', 'none'] as const;
// An ink ramp: the further an alert got, the darker its share (labels and numbers carry the meaning).
const REACH_TONE: Record<(typeof REACH_KEYS)[number], string> = {
  push: 'bg-ink',
  live: 'bg-ink-2',
  closed: 'bg-muted/60',
  none: 'bg-line',
};

/** How far each ready alert got, as one proportional bar with a legend (text and numbers, not colour alone). */
function ReachBar({ reach }: { reach: Reach }) {
  const { t } = useTranslation();
  const total = REACH_KEYS.reduce((a, k) => a + reach[k], 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
        {total > 0 &&
          REACH_KEYS.map((k) =>
            reach[k] > 0 ? <span key={k} className={`${REACH_TONE[k]} h-full border-e-2 border-surface last:border-e-0`} style={{ width: `${(reach[k] / total) * 100}%` }} /> : null,
          )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-2">
        {REACH_KEYS.map((k) => (
          <div key={k} className="flex flex-col gap-1">
            <dt className="flex items-center gap-2 text-sm text-ink-2">
              <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${REACH_TONE[k]}`} />
              {t(`common:alertLevel.${k}`)}
            </dt>
            <dd className="num font-display text-2xl font-bold tracking-tight">{reach[k]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The live board first, then (optionally) what to do next, then how alerts reached customers beside the orders
 * waiting longest. Open orders lead the board as the page's one ember figure.
 */
export function TodayStats({ r, next }: { r: TodayReport; next?: ReactNode }) {
  const { t } = useTranslation();
  const statuses = Object.entries(r.byStatus ?? {});
  return (
    <>
      <Figures className="mb-6 grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <Stat
          lead
          className="col-span-2 lg:col-span-1 lg:row-span-2 lg:justify-between"
          label={
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="size-2 rounded-full bg-primary motion-safe:animate-pulse" />
              {t('today.open')}
            </span>
          }
          value={r.open}
          hint={t('today.openHint')}
        />
        <Stat label={t('today.tickets')} value={r.tickets} />
        <Stat label={t('today.prep')} value={formatDuration(r.prepSecondsP50)} hint={t('reports.prepNote')} />
        <Stat className="col-span-2 lg:col-span-1" label={t('today.pickup')} value={formatDuration(r.pickupSecondsP50)} hint={t('reports.pickupNote')} />
        <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface px-5 py-4 lg:col-span-3">
          <span className="eyebrow me-1">{t('today.byStatus')}</span>
          {statuses.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t('today.byStatus')}>
              {statuses.map(([s, n]) => (
                <li key={s}>
                  <Pill tone="neutral">
                    {t(`common:status.${s}`, { defaultValue: s })} <span className="num">{n}</span>
                  </Pill>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-muted">—</span>
          )}
        </div>
      </Figures>
      {next}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Section className="m-0" title={t('today.reachTitle')} description={t('reports.wordingNote')}>
          <ReachBar reach={r.alertReach} />
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-5">
            <div className="flex flex-col gap-1">
              <span className="eyebrow">{t('today.reachPct')}</span>
              <span data-motion="count" className="num font-display text-3xl font-extrabold tracking-tight">
                {pct(r.reachPushOrLivePct)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="eyebrow">{t('today.ackPct')}</span>
              <span data-motion="count" className="num font-display text-3xl font-extrabold tracking-tight">
                {pct(r.acknowledgedPct)}
              </span>
            </div>
          </div>
        </Section>
        <LongestWaiting items={r.longestWaiting ?? []} />
      </div>
    </>
  );
}

/** Open tickets waiting longest, oldest first (FR-RPT-01). Waiting time counts from ticket creation. */
export function LongestWaiting({ items }: { items: WaitingTicket[] }) {
  const { t } = useTranslation();
  return (
    <Section className="m-0" title={t('today.longestTitle')} description={t('today.longestNote')}>
      {items.length === 0 ? (
        <p className="text-muted">{t('today.longestEmpty')}</p>
      ) : (
        <Table caption={t('today.longestTitle')} head={[t('today.longestNumber'), t('today.longestStatus'), t('today.longestWaiting')]}>
          {items.map((w) => (
            <tr key={w.id}>
              <Td>
                <span dir="ltr" className="num font-display text-base font-bold">
                  {w.displayNumber}
                </span>
              </Td>
              <Td>
                <span className={w.status === 'ready' ? 'font-semibold text-ok' : 'text-ink-2'}>{t(`common:status.${w.status}`, { defaultValue: w.status })}</span>
              </Td>
              <Td className="num font-semibold">{formatDuration(w.waitingSeconds)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function Today({ venueId }: { venueId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['today', venueId],
    queryFn: () => api.get<TodayReport>('/reports/today', { venueId }),
    refetchInterval: 30_000,
  });
  return (
    <section aria-label={t('today.title')}>
      <QueryView q={q} skeleton="tiles">
        {(r) =>
          r.tickets === 0 ? (
            <>
              <Checklist />
              <EmptyState
                title={t('today.empty')}
                action={
                  <a className={linkClass('primary')} href={staffBoardUrl(venueId)}>
                    {t('onboarding.openBoard')}
                  </a>
                }
              >
                {t('today.emptyBody')}
              </EmptyState>
            </>
          ) : (
            <TodayStats r={r} next={<Checklist />} />
          )
        }
      </QueryView>
    </section>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const venueId = useCurrentVenueId();
  // Reads what <Today> loads (same query key) for the header line. The staff board is one tap away on the pass.
  const today = useQuery({
    queryKey: ['today', venueId],
    queryFn: () => api.get<TodayReport>('/reports/today', { venueId: venueId ?? '' }),
    enabled: false,
  }).data;
  const date = today?.businessDate;
  return (
    <Page title={t('nav.home')} description={date ? t('today.businessDate', { date }) : t('today.description')}>
      {venueId ? <Today venueId={venueId} /> : <LoadingShape kind="tiles" />}
    </Page>
  );
}
