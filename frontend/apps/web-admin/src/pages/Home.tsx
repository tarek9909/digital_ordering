import { useTranslation } from '@dop/i18n';
import { formatDateTime } from '@dop/client-sdk';
import { Button, EmptyState, Modal } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Figures, LoadingShape, Page, QueryView, Section, linkClass } from '../components/common';
import { LATE_MINUTES, PaceChart, PassLane, ServiceRing, Spark } from '../components/TodayCharts';
import { daysUntil } from '../lib/access';
import { api } from '../lib/api';
import { formatDuration, pct } from '../lib/format';
import { useMe, useTenant } from '../lib/me';
import { useCurrentVenueId } from '../lib/venue';
import type { Reach, TodayReport, TrendsReport, WaitingTicket } from '../lib/types';

/** Staff board link for owners and managers (FR-STF-17); the board is a separate app on the same host. */
export const staffBoardUrl = (venueId: string | null) => `/staff${venueId ? `?venueId=${encodeURIComponent(venueId)}` : ''}`;

/** A button that opens a notice in a pop-up, so set-up and plan notices stay out of the dashboard's way. */
function NoticeDialog({ label, badge, title, description, children }: { label: string; badge?: string; title: string; description?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {label}
        {badge && <span className="num rounded-full bg-panel px-2 py-0.5 text-xs font-bold text-white">{badge}</span>}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        {children}
      </Modal>
    </>
  );
}

/** The free trial: days left in a pop-up, with the way to billing for owners. Hidden for paid and complimentary accounts. */
function TrialNotice() {
  const { t, i18n } = useTranslation();
  const tenant = useTenant().data;
  const isOwner = useMe().data?.currentRole === 'owner';
  if (!tenant || tenant.status !== 'trial' || tenant.complimentary || !tenant.trial_ends_at) return null;
  const count = daysUntil(tenant.trial_ends_at);
  return (
    <NoticeDialog label={t('banners.trialButton', { count })} title={t('banners.trialTitle')}>
      <div className="flex flex-col gap-4">
        <p>{t('banners.trial', { count, date: formatDateTime(tenant.trial_ends_at, i18n.language) })}</p>
      </div>
    </NoticeDialog>
  );
}

/** The paid plan's end date: days left in a pop-up, with the way to billing for owners. Hidden for trial and complimentary accounts. */
function PlanEndNotice() {
  const { t, i18n } = useTranslation();
  const tenant = useTenant().data;
  const isOwner = useMe().data?.currentRole === 'owner';
  if (!tenant || tenant.complimentary || tenant.status === 'trial' || !tenant.paid_until) return null;
  const count = daysUntil(tenant.paid_until);
  const ended = new Date(tenant.paid_until).getTime() <= Date.now();
  const date = formatDateTime(tenant.paid_until, i18n.language);
  return (
    <NoticeDialog label={ended ? t('banners.planEndedButton') : t('banners.planEndsButton', { count })} title={t('banners.planTitle')}>
      <div className="flex flex-col gap-4">
        <p>{ended ? t('banners.planEnded', { date }) : t('banners.planEnds', { count, date })}</p>
      </div>
    </NoticeDialog>
  );
}

/** Set-up and trial notices as a row of buttons; nothing shows when there is nothing to say. */
function Notices() {
  return (
    <div className="mb-6 flex flex-wrap gap-3 empty:hidden">
      <TrialNotice />
      <PlanEndNotice />
    </div>
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

type Tone = 'ok' | 'warn' | 'flat';
interface Compare {
  text: string;
  tone: Tone;
}

const dayBefore = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Today's figures against the same day last week, from the daily roll-ups. */
function useWeekComparison(venueId: string, date: string) {
  return useQuery({
    queryKey: ['today-trends', venueId, date],
    queryFn: () => api.get<TrendsReport>('/reports/trends', { venueId, from: dayBefore(date, 8), to: date }),
    refetchInterval: 300_000,
  });
}

function Figure({ label, value, compare, spark }: { label: string; value: string; compare?: Compare; spark: number[] }) {
  const { t } = useTranslation();
  return (
    <div className="@container flex min-w-0 flex-col gap-1.5 bg-surface p-4 sm:p-5">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span data-motion="count" className="num font-display text-[length:clamp(1.5rem,24cqi,1.875rem)] leading-tight font-bold tracking-tight">
          {value}
        </span>
        <Spark values={spark} label={`${label}, ${t('today.vsLabel')}`} />
      </div>
      <span className={`text-sm font-medium ${compare?.tone === 'ok' ? 'text-ok' : compare?.tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{compare?.text ?? t('today.vsNone')}</span>
    </div>
  );
}

/** Five figures with a seven-day line each and what changed since the same day last week. */
function Comparison({ r, venueId }: { r: TodayReport; venueId: string }) {
  const { t } = useTranslation();
  const q = useWeekComparison(venueId, r.businessDate);
  const series = q.data?.series ?? [];
  const lastWeek = series.find((s) => s.date === dayBefore(r.businessDate, 7));
  const before = series.filter((s) => s.date < r.businessDate).slice(-6);
  const arrow = (d: number) => (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '');
  const count = (cur: number, prev: number | undefined): Compare | undefined => {
    if (prev === undefined) return undefined;
    const d = cur - prev;
    return { tone: 'flat', text: d === 0 ? t('today.vsSame') : arrow(d) + t(d > 0 ? 'today.vsMore' : 'today.vsFewer', { n: Math.abs(d) }) };
  };
  const duration = (cur: number | null, prev: number | null | undefined): Compare | undefined => {
    if (cur === null || prev === null || prev === undefined) return undefined;
    const d = Math.round(cur - prev);
    if (Math.abs(d) < 5) return { tone: 'flat', text: t('today.vsSame') };
    return { tone: d < 0 ? 'ok' : 'warn', text: arrow(d) + t(d < 0 ? 'today.vsFaster' : 'today.vsSlower', { n: formatDuration(Math.abs(d)) }) };
  };
  const points = (cur: number | null, prev: number | null | undefined): Compare | undefined => {
    if (cur === null || prev === null || prev === undefined) return undefined;
    const d = cur - prev;
    return { tone: d > 0 ? 'ok' : 'flat', text: d === 0 ? t('today.vsSame') : arrow(d) + t('today.vsPoints', { n: Math.abs(d) }) };
  };
  const line = (pick: (s: TrendsReport['series'][number]) => number | null, today: number | null) => [...before.map(pick), today].filter((v): v is number => v !== null);
  return (
    <Figures flat className="mb-6 grid-cols-2 lg:grid-cols-5" label={t('today.vsLabel')}>
      <Figure label={t('today.tickets')} value={String(r.tickets)} compare={count(r.tickets, lastWeek?.tickets)} spark={line((s) => s.tickets, r.tickets)} />
      <Figure label={t('today.prep')} value={formatDuration(r.prepSecondsP50)} compare={duration(r.prepSecondsP50, lastWeek?.prepSecondsP50)} spark={line((s) => s.prepSecondsP50, r.prepSecondsP50)} />
      <Figure label={t('today.pickup')} value={formatDuration(r.pickupSecondsP50)} compare={duration(r.pickupSecondsP50, lastWeek?.pickupSecondsP50)} spark={line((s) => s.pickupSecondsP50, r.pickupSecondsP50)} />
      <Figure label={t('today.reachPct')} value={pct(r.reachPushOrLivePct)} compare={points(r.reachPushOrLivePct, lastWeek?.reachPushOrLivePct)} spark={line((s) => s.reachPushOrLivePct, r.reachPushOrLivePct)} />
      <Figure label={t('today.uncollected')} value={String(r.byStatus?.ready ?? 0)} spark={line((s) => s.uncollected, r.byStatus?.ready ?? 0)} />
    </Figures>
  );
}

/** Names the open tickets past the late line, worst first, with a way to find them on the board. */
function LateBanner({ items, venueId }: { items: WaitingTicket[]; venueId: string | null }) {
  const { t } = useTranslation();
  const late = items.filter((w) => w.waitingSeconds > LATE_MINUTES * 60);
  const worst = late[0];
  if (!worst) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-input bg-danger-bg px-4 py-3 text-danger">
      <p className="text-sm">
        {t('today.passAlert', { number: worst.displayNumber, duration: formatDuration(worst.waitingSeconds) })}
        {late.length > 1 && <> {t('today.passAlertMore', { count: late.length - 1, n: LATE_MINUTES })}</>}
      </p>
      <a className={linkClass('secondary')} href={staffBoardUrl(venueId)}>
        {t('today.passBoard')}
      </a>
    </div>
  );
}

/**
 * The Tanbeeh ring first (service so far, with open orders in the middle), then the pass, five figures against last
 * week, kitchen pace and how alerts reached customers. The ring's ember dot is the page's one ember element.
 */
export function TodayStats({ r, next, venueId }: { r: TodayReport; next?: ReactNode; venueId?: string | null }) {
  const { t } = useTranslation();
  const open = r.openTickets ?? r.longestWaiting ?? [];
  const notDrawn = r.openTickets ? Math.max(0, r.open - open.length) : 0;
  const called = r.alertReach.push + r.alertReach.live + r.alertReach.closed + r.alertReach.none;
  return (
    <>
      {next}
      <div className="mb-6 grid items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <section aria-labelledby="ring-h" className="ember-glow flex flex-col gap-2 rounded-[var(--radius-card)] bg-panel p-5 text-white sm:p-6">
          <h2 id="ring-h" className="font-display text-lg font-semibold">
            {t('today.ringTitle')}
          </h2>
          <p className="text-sm text-white/70">{t('today.ringNote')}</p>
          <ServiceRing hourly={r.hourly ?? Array.from({ length: 24 }, () => 0)} open={r.open} tickets={r.tickets} localMinutes={r.localMinutes} />
        </section>
        <Section className="m-0" title={t('today.passTitle')} description={t('today.passNote', { n: LATE_MINUTES })}>
          <div className="flex flex-col gap-4">
            {open.length === 0 ? <p className="text-muted">{t('today.passEmpty')}</p> : <PassLane items={open} />}
            {notDrawn > 0 && <p className="text-sm text-muted">{t('today.passMore', { n: notDrawn })}</p>}
            <LateBanner items={open} venueId={venueId ?? null} />
          </div>
        </Section>
      </div>
      {venueId && <Comparison r={r} venueId={venueId} />}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section className="m-0" title={t('today.paceTitle')} description={t('today.paceNote')}>
          <PaceChart pace={r.pace ?? []} todayMedian={r.prepSecondsP50} />
        </Section>
        <Section className="m-0" title={t('today.reachTitle')} description={t('today.reachSub', { n: called })}>
          <ReachBar reach={r.alertReach} />
          <p className="num mt-5 border-t border-line pt-5 font-display text-lg font-semibold">
            {t('today.ackLine', { pct: pct(r.acknowledgedPct) })}
          </p>
          <p className="mt-3 text-sm text-muted">{t('reports.wordingNote')}</p>
        </Section>
      </div>
    </>
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
              <Notices />
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
            <TodayStats r={r} venueId={venueId} next={<Notices />} />
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
