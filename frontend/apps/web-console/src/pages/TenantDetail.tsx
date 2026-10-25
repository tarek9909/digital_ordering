import type { AuditPurpose } from '@dop/contracts';
import { formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Card, EmptyState, LiveRegion, Modal, PageShell, Pill, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { AuditTable } from '../components/AuditTable';
import { ErrorNote, FormButtons, InfoRow, Initials, StatusBadge, Table, tabPanelProps, Tabs, Td } from '../components/common';
import { PurposeGate } from '../components/PurposeGate';
import { TenantActions } from '../components/TenantActions';
import { TenantLogoSection } from '../components/TenantLogo';
import { CommercialActions } from '../components/tenant/CommercialActions';
import { FlagsTab } from '../components/tenant/FlagsTab';
import { NotesTab } from '../components/tenant/NotesTab';
import { SupportTab } from '../components/tenant/SupportTab';
import { api } from '../lib/api';
import { fmtDate, fmtDay } from '../lib/format';
import { useMe } from '../lib/me';
import { forgetPurpose, purposeHeaders } from '../lib/purpose';
import { can } from '../lib/roles';
import type { AuditRow, BillingView, Paged, Payment, TenantDetail } from '../lib/types';

const TABS = ['overview', 'venues', 'billing', 'notes', 'support', 'flags', 'audit'] as const;
type Role = Parameters<typeof can>[0];
const TAB_PERM: Partial<Record<(typeof TABS)[number], Parameters<typeof can>[1]>> = {
  billing: 'billing.read',
  notes: 'notes',
  support: 'support',
  flags: 'settings',
  audit: 'audit',
};
const tabAllowed = (role: Role, tab: (typeof TABS)[number]) => {
  const p = TAB_PERM[tab];
  return p ? can(role, p) : true;
};
type Tab = (typeof TABS)[number];

const TAB_ICONS: Record<Tab, ReactNode> = {
  overview: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4" aria-hidden="true">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  ),
  venues: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4" aria-hidden="true">
      <path d="M3 7.5L10 3l7 4.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V7.5z" />
    </svg>
  ),
  billing: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4" aria-hidden="true">
      <rect x="2" y="4" width="16" height="12" rx="2" />
      <path d="M2 9h16" />
    </svg>
  ),
  notes: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z" />
      <path d="M7 6h6" />
      <path d="M7 10h6" />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.5 7.5a2.5 2.5 0 014.5 1.5c0 1.5-2 2-2 3" />
      <circle cx="10" cy="14.5" r=".75" />
    </svg>
  ),
  flags: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4" aria-hidden="true">
      <path d="M4 3v14" />
      <path d="M4 4h10l-2 4 2 4H4" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4" aria-hidden="true">
      <rect x="4" y="8" width="12" height="9" rx="1.5" />
      <path d="M7 8V5.5a3 3 0 016 0V8" />
    </svg>
  ),
};

export function TenantDetailPage() {
  const { id = '' } = useParams();
  return (
    <PurposeGate key={id} tenantId={id}>
      {(purpose) => <TenantView id={id} purpose={purpose} />}
    </PurposeGate>
  );
}

function TenantView({ id, purpose }: { id: string; purpose: AuditPurpose }) {
  const { t, i18n } = useTranslation();
  const role = useMe().data?.platformUser.role;
  const [tab, setTab] = useState<Tab>('overview');
  const detail = useQuery({
    queryKey: ['tenant', id, purpose],
    queryFn: () => api.call<TenantDetail>('GET', `/tenants/${id}`, { headers: purposeHeaders(purpose) }),
  });
  const tabs = TABS.filter((x) => tabAllowed(role, x));

  if (detail.isPending)
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-8 sm:px-6">
        <Spinner label={t('common:loading')} />
      </div>
    );
  if (detail.error)
    return (
      <div className="flex flex-col gap-4 px-4 py-8 sm:px-6 max-w-lg mx-auto">
        <ErrorNote error={detail.error} />
        <Link to="/tenants" className="inline-flex items-center gap-2 text-primary font-bold hover:underline">
          ← {t('tenant.backToList')}
        </Link>
      </div>
    );
  const d = detail.data;
  const x = d.tenant;
  const l = i18n.language;
  const billingLine = x.complimentary
    ? t('tenantUx.complimentaryLine')
    : x.paidUntil
      ? t('tenantUx.paidLine', { date: fmtDay(x.paidUntil, l) })
      : t('tenantUx.noPaidPeriod');

  return (
    <PageShell
      wide
      eyebrow={
        <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 text-xs font-semibold">
          <Link to="/tenants" className="hover:text-primary transition-colors">
            {t('layout.groups.tenants')}
          </Link>
          <span aria-hidden="true" className="text-muted">/</span>
          <span dir="ltr" className="console-mono-chip normal-case">
            {x.slug}
          </span>
        </span>
      }
      title={x.name}
      actions={
        <div className="flex flex-wrap items-center gap-x-2 rounded-xl bg-surface py-1.5 ps-3.5 pe-1.5 shadow-card border border-line">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
            {t('tenant.purposeIs', { purpose: t(`purpose.${purpose}`) })}
          </span>
          <Button
            variant="ghost"
            size="md"
            className="text-xs font-bold text-muted hover:text-ink"
            onClick={() => {
              forgetPurpose(id);
              window.location.reload();
            }}
          >
            {t('tenant.changePurpose')}
          </Button>
        </div>
      }
    >
      {/* Summary KPI Strip */}
      <section aria-label={t('tenantUx.summary')} className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label={t('tenants.status')}>
          <div className="flex items-center gap-2">
            <StatusBadge status={x.status} />
          </div>
          {x.statusReason && <span className="mt-1 block truncate text-xs text-muted font-medium">{x.statusReason}</span>}
        </SummaryTile>
        <SummaryTile label={t('tenants.plan')}>
          <div className="flex items-center gap-1.5">
            <span className="font-display text-lg font-bold text-ink">{t(`plan.${x.plan}`, { defaultValue: x.plan })}</span>
            {x.complimentary && <Pill tone="ink" className="text-[0.625rem] py-0">{t('tenants.complimentary')}</Pill>}
          </div>
          <span className="block text-xs text-muted font-medium">{billingLine}</span>
        </SummaryTile>
        <SummaryTile label={t('tenantUx.venues')}>
          <span className="num font-display text-lg font-bold text-ink">{d.venues.length}</span>
          <span className="block text-xs text-muted font-medium">
            {t('tenantUx.devicesDisplays', { devices: d.devices.length, displays: d.displays.length })}
          </span>
        </SummaryTile>
        <SummaryTile label={t('tenants.lastActivity')}>
          <span className="font-display text-lg font-bold text-ink">{fmtDay(x.lastActivityAt, l)}</span>
          <span className="block text-xs text-muted font-medium">{t('tenantsUx.createdOn', { date: fmtDay(x.createdAt, l) })}</span>
        </SummaryTile>
      </section>

      {/* Enhanced Subtabs with Icons */}
      <Tabs
        id="tenant"
        label={t('tenant.tabs')}
        value={tab}
        onChange={setTab}
        tabs={tabs.map((v) => ({
          value: v,
          label: t(`tenant.tab.${v}`),
          count: v === 'venues' ? d.venues.length : undefined,
          icon: TAB_ICONS[v],
        }))}
      />

      <div {...tabPanelProps('tenant', tab)}>
        {tab === 'overview' && (
          <div className="flex flex-col gap-6">
            <Overview d={d} />
            <div className="grid items-start gap-6 xl:grid-cols-2">
              {can(role, 'tenants.lifecycle') && <TenantActions tenant={d.tenant} />}
              <CommercialActions tenant={d.tenant} />
              {can(role, 'tenants.lifecycle') && <TenantLogoSection tenantId={d.tenant.id} logoUrl={d.tenant.logoUrl} />}
            </div>
          </div>
        )}
        {tab === 'venues' && <Venues d={d} canSignOut={can(role, 'devices')} />}
        {tab === 'billing' && <Billing id={id} purpose={purpose} />}
        {tab === 'notes' && <NotesTab tenantId={id} purpose={purpose} />}
        {tab === 'support' && <SupportTab tenant={d.tenant} purpose={purpose} />}
        {tab === 'flags' && <FlagsTab tenantId={id} />}
        {tab === 'audit' && <TenantAudit id={id} />}
      </div>
    </PageShell>
  );
}

function SummaryTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-surface p-4 shadow-card border border-line">
      <span className="eyebrow text-xs text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Overview({ d }: { d: TenantDetail }) {
  const { t, i18n } = useTranslation();
  const x = d.tenant;
  const l = i18n.language;
  const regions = (() => {
    try {
      return new Intl.DisplayNames([l], { type: 'region' });
    } catch {
      return null;
    }
  })();
  const pay = d.payments[0];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card className="rounded-2xl border border-line shadow-card">
        <div className="flex items-center justify-between border-b border-line/60 pb-3 mb-2">
          <h2 className="font-display text-lg font-bold text-ink">{t('tenant.profile')}</h2>
          <span dir="ltr" className="console-mono-chip">{x.slug}</span>
        </div>
        <dl className="divide-y divide-line/40">
          <InfoRow label={t('tenants.slug')}>
            <span dir="ltr" className="font-mono text-sm font-semibold text-primary">
              {x.slug}
            </span>
          </InfoRow>
          <InfoRow label={t('tenants.plan')}>
            <span className="font-semibold text-ink">
              {t(`plan.${x.plan}`, { defaultValue: x.plan })}
            </span>{' '}
            {x.complimentary && <Pill tone="ink" className="text-xs ms-1.5">{t('tenants.complimentary')}</Pill>}
          </InfoRow>
          {x.planStartsAt && <InfoRow label={t('tenant.planStarts')}>{fmtDate(x.planStartsAt, l)}</InfoRow>}
          {x.planEndsAt && <InfoRow label={t('tenant.planEnds')}>{fmtDate(x.planEndsAt, l)}</InfoRow>}
          {x.graceEndsAt && <InfoRow label={t('tenant.graceEnds')}>{fmtDate(x.graceEndsAt, l)}</InfoRow>}
          {x.deletionRequestedAt && (
            <InfoRow label={t('tenant.deletionRequested')}>
              <span className="text-danger font-bold">{fmtDate(x.deletionRequestedAt, l)}</span>
            </InfoRow>
          )}
          <InfoRow label={t('tenant.country')}>{regions?.of(x.country) ?? x.country}</InfoRow>
          <InfoRow label={t('tenant.locale')}>{t(`lang.${x.defaultLocale}`, { defaultValue: x.defaultLocale })}</InfoRow>
          <InfoRow label={t('tenants.created')}>{fmtDate(x.createdAt, l)}</InfoRow>
        </dl>
      </Card>
      <div className="flex flex-col gap-6">
        <Card className="rounded-2xl border border-line shadow-card">
          <h2 className="mb-3 font-display text-lg font-bold text-ink border-b border-line/60 pb-3">
            {t('tenant.members')}
          </h2>
          <ul className="flex flex-col gap-3">
            {d.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-2 rounded-xl bg-canvas/40 border border-line/50">
                <Initials name={m.name} tone={m.role === 'owner' ? 'ink' : 'soft'} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold text-sm text-ink">
                    {m.name} <span className="text-xs font-normal text-muted">· {t(`memberRole.${m.role}`, { defaultValue: m.role })}</span>
                  </span>
                  <span dir="ltr" className="max-w-full self-start truncate font-mono text-xs text-muted">
                    {m.email}
                  </span>
                </span>
                {m.verified ? (
                  <Pill tone="ok" className="shrink-0 text-[0.625rem]">
                    {t('tenant.verified')}
                  </Pill>
                ) : (
                  <Pill tone="warn" className="shrink-0 text-[0.625rem]">
                    {t('tenant.notVerified')}
                  </Pill>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="rounded-2xl border border-line shadow-card">
          <h2 className="mb-2 font-display text-lg font-bold text-ink border-b border-line/60 pb-3">
            {t('tenant.lastPayment')}
          </h2>
          {pay ? (
            <div className="flex flex-col gap-1.5 pt-1">
              <span className="num font-display text-2xl font-extrabold tracking-tight text-ink">
                {formatMoney(pay.amountMinor, pay.currency, l)}
              </span>
              <span className="text-xs sm:text-sm text-ink-2">
                {t('billing.monthsCount', { count: pay.months })} · {t(`billing.method.${pay.method}`)} · {fmtDate(pay.recordedAt, l)}
              </span>
            </div>
          ) : (
            <p className="text-xs sm:text-sm text-muted pt-1">{t('billing.noPayments')}</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Venues({ d, canSignOut }: { d: TenantDetail; canSignOut: boolean }) {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  const [announce, setAnnounce] = useState('');
  if (d.venues.length === 0) return <EmptyState title={t('tenant.noVenues')} />;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <LiveRegion toast text={announce} />
      {d.venues.map((v) => {
        const devices = d.devices.filter((x) => x.venue_id === v.id);
        const displays = d.displays.filter((x) => x.venue_id === v.id);
        return (
          <Card key={v.id} className="flex flex-col gap-4.5 rounded-2xl border border-line shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 pb-3">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold text-ink break-words">{v.name}</h2>
                <p className="text-xs text-muted flex items-center gap-2 mt-0.5">
                  <span dir="ltr" className="console-mono-chip font-bold">
                    {v.venue_code}
                  </span>
                  <span>·</span>
                  <span dir="ltr">{v.time_zone}</span>
                </p>
              </div>
              <Pill tone={v.status === 'active' ? 'ok' : 'neutral'}>
                {t(`venueStatus.${v.status}`, { defaultValue: v.status })}
              </Pill>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="eyebrow text-xs text-muted font-bold uppercase tracking-wider">{t('tenant.devices', { count: devices.length })}</h3>
              {devices.length === 0 ? (
                <p className="text-xs text-muted p-2 rounded-lg bg-canvas">{t('tenantUx.noDevices')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line/60 rounded-xl border border-line bg-canvas/30">
                  {devices.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs sm:text-sm">
                      <span className="min-w-0 font-medium text-ink break-words">{x.name}</span>
                      <span className="text-xs text-muted">{t('tenant.lastSeen', { date: fmtDate(x.last_seen_at, l) })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canSignOut && (
              <SignOutDevices tenantId={d.tenant.id} venue={v} count={devices.length} onDone={() => setAnnounce(t('devices.done', { venue: v.name }))} />
            )}
            <div className="flex flex-col gap-2">
              <h3 className="eyebrow text-xs text-muted font-bold uppercase tracking-wider">{t('tenant.displays', { count: displays.length })}</h3>
              {displays.length === 0 ? (
                <p className="text-xs text-muted p-2 rounded-lg bg-canvas">{t('tenantUx.noDisplays')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line/60 rounded-xl border border-line bg-canvas/30">
                  {displays.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs sm:text-sm">
                      <span className="min-w-0 font-medium text-ink break-words">{x.name}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs">
                        {x.paired_at ? <Pill tone="ok" className="py-0">{t('tenant.paired')}</Pill> : <Pill className="py-0">{t('tenant.notPaired')}</Pill>}
                        {x.sound_enabled ? <Pill tone="info" className="py-0">{t('tenant.soundOn')}</Pill> : <Pill tone="warn" className="py-0">{t('tenant.soundOff')}</Pill>}
                        <span className="text-xs text-muted">{t('tenant.lastSeen', { date: fmtDate(x.last_seen_at, l) })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Sign out all staff devices of one venue (FR-SA-16), after confirmation. */
function SignOutDevices({
  tenantId,
  venue,
  count,
  onDone,
}: {
  tenantId: string;
  venue: TenantDetail['venues'][number];
  count: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post(`/venues/${venue.id}/signout-devices`),
    onSuccess: () => {
      setOpen(false);
      onDone();
      void qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
    },
  });
  return (
    <>
      <div>
        <Button variant="secondary" size="md" className="text-danger text-xs font-bold" disabled={count === 0} onClick={() => setOpen(true)}>
          {t('devices.button')}
        </Button>
      </div>
      {open && (
        <Modal open onOpenChange={(o) => !o && setOpen(false)} title={t('devices.title')} description={t('devices.body', { venue: venue.name, count })}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate();
            }}
            className="flex flex-col gap-4"
          >
            <ErrorNote error={m.error} />
            <FormButtons onCancel={() => setOpen(false)} busy={m.isPending} label={t('devices.button')} danger />
          </form>
        </Modal>
      )}
    </>
  );
}

function Billing({ id, purpose }: { id: string; purpose: AuditPurpose }) {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  const q = useQuery({
    queryKey: ['tenant-billing', id, purpose],
    queryFn: () => api.call<BillingView>('GET', `/tenants/${id}/billing`, { headers: purposeHeaders(purpose) }),
  });
  if (q.isPending) return <Spinner label={t('common:loading')} />;
  if (q.error) return <ErrorNote error={q.error} />;
  const b = q.data;
  return (
    <div className="flex flex-col gap-6">
      <Card className="rounded-2xl border border-line shadow-card">
        <h2 className="mb-3 font-display text-lg font-bold text-ink border-b border-line/60 pb-3">{t('billing.paidPeriod')}</h2>
        <dl className="divide-y divide-line/40">
          <InfoRow label={t('tenant.paidUntil')}>
            <span className="font-bold text-ink">{b.complimentary ? t('tenants.complimentary') : fmtDate(b.paidUntil, l)}</span>
          </InfoRow>
          <InfoRow label={t('tenant.graceEnds')}>{fmtDate(b.graceEndsAt, l)}</InfoRow>
        </dl>
      </Card>
      <PaymentsTable payments={b.payments} />
    </div>
  );
}

export function PaymentsTable({ payments }: { payments: Payment[] }) {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  return (
    <Table
      caption={t('billing.payments')}
      head={[t('billing.recorded'), t('billing.amount'), t('billing.covers'), t('billing.methodLabel'), t('billing.reference')]}
    >
      {payments.length === 0 && (
        <tr>
          <Td className="text-muted text-center py-6" colSpan={5}>
            {t('billing.noPayments')}
          </Td>
        </tr>
      )}
      {payments.map((p) => (
        <tr key={p.id}>
          <Td className="text-xs text-ink-2 font-medium">{fmtDate(p.recordedAt, l)}</Td>
          <Td className="num font-bold text-ink">{formatMoney(p.amountMinor, p.currency, l)}</Td>
          <Td className="text-xs">
            {fmtDate(p.coversFrom, l)} – {fmtDate(p.coversUntil, l)}
          </Td>
          <Td>
            <Pill tone="neutral" className="text-xs">{t(`billing.method.${p.method}`)}</Pill>
          </Td>
          <Td className="text-xs">
            <span className="font-mono">{p.reference ?? '—'}</span>
            {p.note && <span className="block text-xs text-muted mt-0.5">{p.note}</span>}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

function TenantAudit({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['audit', { tenantId: id }], queryFn: () => api.get<Paged<AuditRow>>('/audit', { tenantId: id, limit: 100 }) });
  if (q.isPending) return <Spinner label={t('common:loading')} />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <div className="flex flex-col gap-4">
      <AuditTable rows={q.data.items} />
      <div className="flex justify-end">
        <Link to={`/reports?tab=audit&tenantId=${id}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-primary hover:underline">
          {t('tenant.moreAudit')} →
        </Link>
      </div>
    </div>
  );
}
