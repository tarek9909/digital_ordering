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
const TAB_PERM: Partial<Record<(typeof TABS)[number], Parameters<typeof can>[1]>> = { billing: 'billing.read', notes: 'notes', support: 'support', flags: 'settings', audit: 'audit' };
const tabAllowed = (role: Role, tab: (typeof TABS)[number]) => {
  const p = TAB_PERM[tab];
  return p ? can(role, p) : true;
};
type Tab = (typeof TABS)[number];

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
      <div className="px-4 py-8 sm:px-6">
        <Spinner label={t('common:loading')} />
      </div>
    );
  if (detail.error)
    return (
      <div className="flex flex-col gap-3 px-4 py-8 sm:px-6">
        <ErrorNote error={detail.error} />
        <Link to="/tenants" className="text-primary underline">
          {t('tenant.backToList')}
        </Link>
      </div>
    );
  const d = detail.data;
  const x = d.tenant;
  const l = i18n.language;
  const billingLine = x.complimentary
    ? t('tenantUx.complimentaryLine')
    : x.status === 'trial'
      ? t('tenantUx.trialLine', { date: fmtDay(x.trialEndsAt, l) })
      : x.paidUntil
        ? t('tenantUx.paidLine', { date: fmtDay(x.paidUntil, l) })
        : t('tenantUx.noPaidPeriod');

  return (
    <PageShell
      wide
      eyebrow={
        <span className="inline-flex max-w-full flex-wrap items-center gap-x-2">
          <Link to="/tenants" className="hover:text-ink">
            {t('layout.groups.tenants')}
          </Link>
          <span aria-hidden="true">/</span>
          <span dir="ltr" className="min-w-0 font-mono break-all normal-case">
            {x.slug}
          </span>
        </span>
      }
      title={x.name}
      actions={
        <div className="flex flex-wrap items-center gap-x-2 rounded-control bg-surface py-1 ps-4 pe-1 shadow-card">
          <span className="min-w-0 text-sm text-ink-2">{t('tenant.purposeIs', { purpose: t(`purpose.${purpose}`) })}</span>
          <Button
            variant="ghost"
            className="text-sm"
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
      <section aria-label={t('tenantUx.summary')} className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label={t('tenants.status')}>
          <StatusBadge status={x.status} />
          {x.statusReason && <span className="mt-1 block truncate text-xs text-muted">{x.statusReason}</span>}
        </SummaryTile>
        <SummaryTile label={t('tenants.plan')}>
          <span className="font-display text-lg font-bold">{t(`plan.${x.plan}`, { defaultValue: x.plan })}</span>
          <span className="block text-xs text-muted">{billingLine}</span>
        </SummaryTile>
        <SummaryTile label={t('tenantUx.venues')}>
          <span className="num font-display text-lg font-bold">{d.venues.length}</span>
          <span className="block text-xs text-muted">{t('tenantUx.devicesDisplays', { devices: d.devices.length, displays: d.displays.length })}</span>
        </SummaryTile>
        <SummaryTile label={t('tenants.lastActivity')}>
          <span className="font-display text-lg font-bold">{fmtDay(x.lastActivityAt, l)}</span>
          <span className="block text-xs text-muted">{t('tenantsUx.createdOn', { date: fmtDay(x.createdAt, l) })}</span>
        </SummaryTile>
      </section>
      <Tabs id="tenant" label={t('tenant.tabs')} value={tab} onChange={setTab} tabs={tabs.map((v) => ({ value: v, label: t(`tenant.tab.${v}`), count: v === 'venues' ? d.venues.length : undefined }))} />
      <div {...tabPanelProps('tenant', tab)}>
        {tab === 'overview' && (
          <div className="flex flex-col gap-6">
            <Overview d={d} />
            <div className="grid items-start gap-6 xl:grid-cols-2">
              {can(role, 'tenants.lifecycle') && <TenantActions tenant={d.tenant} />}
              <CommercialActions tenant={d.tenant} />
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
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] bg-surface p-4 shadow-card">
      <span className="eyebrow">{label}</span>
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
      <Card>
        <h2 className="mb-1 text-lg font-bold">{t('tenant.profile')}</h2>
        <dl className="divide-y divide-line">
          <InfoRow label={t('tenants.slug')}>
            <span dir="ltr" className="font-mono text-sm">
              {x.slug}
            </span>
          </InfoRow>
          <InfoRow label={t('tenants.plan')}>
            {t(`plan.${x.plan}`, { defaultValue: x.plan })} {x.complimentary && <Pill tone="ink">{t('tenants.complimentary')}</Pill>}
          </InfoRow>
          {x.trialEndsAt && <InfoRow label={t('tenant.trialEnds')}>{fmtDate(x.trialEndsAt, l)}</InfoRow>}
          {x.paidUntil && <InfoRow label={t('tenant.paidUntil')}>{fmtDate(x.paidUntil, l)}</InfoRow>}
          {x.graceEndsAt && <InfoRow label={t('tenant.graceEnds')}>{fmtDate(x.graceEndsAt, l)}</InfoRow>}
          {x.deletionRequestedAt && (
            <InfoRow label={t('tenant.deletionRequested')}>
              <span className="text-danger">{fmtDate(x.deletionRequestedAt, l)}</span>
            </InfoRow>
          )}
          <InfoRow label={t('tenant.country')}>{regions?.of(x.country) ?? x.country}</InfoRow>
          <InfoRow label={t('tenant.locale')}>{t(`lang.${x.defaultLocale}`, { defaultValue: x.defaultLocale })}</InfoRow>
          <InfoRow label={t('tenants.created')}>{fmtDate(x.createdAt, l)}</InfoRow>
        </dl>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t('tenant.members')}</h2>
          <ul className="flex flex-col gap-3">
            {d.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <Initials name={m.name} tone={m.role === 'owner' ? 'ink' : 'soft'} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">
                    {m.name} <span className="text-sm font-normal text-muted">· {t(`memberRole.${m.role}`, { defaultValue: m.role })}</span>
                  </span>
                  <span dir="ltr" className="max-w-full self-start truncate text-sm text-muted">
                    {m.email}
                  </span>
                </span>
                {m.verified ? (
                  <Pill tone="ok" className="shrink-0">
                    {t('tenant.verified')}
                  </Pill>
                ) : (
                  <Pill tone="warn" className="shrink-0">
                    {t('tenant.notVerified')}
                  </Pill>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-bold">{t('tenant.lastPayment')}</h2>
          {pay ? (
            <div className="flex flex-col gap-1">
              <span className="num font-display text-2xl font-extrabold tracking-tight">{formatMoney(pay.amountMinor, pay.currency, l)}</span>
              <span className="text-sm text-ink-2">
                {t('billing.monthsCount', { count: pay.months })} · {t(`billing.method.${pay.method}`)} · {fmtDate(pay.recordedAt, l)}
              </span>
            </div>
          ) : (
            <p className="text-muted">{t('billing.noPayments')}</p>
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
      <LiveRegion text={announce} />
      {d.venues.map((v) => {
        const devices = d.devices.filter((x) => x.venue_id === v.id);
        const displays = d.displays.filter((x) => x.venue_id === v.id);
        return (
          <Card key={v.id} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold break-words">{v.name}</h2>
                <p className="text-sm text-muted">
                  <span dir="ltr" className="font-mono">
                    {v.venue_code}
                  </span>{' '}
                  · <span dir="ltr">{v.time_zone}</span>
                </p>
              </div>
              <Pill tone={v.status === 'active' ? 'ok' : 'neutral'}>{t(`venueStatus.${v.status}`, { defaultValue: v.status })}</Pill>
            </div>
            <div>
              <h3 className="eyebrow mb-2">{t('tenant.devices', { count: devices.length })}</h3>
              {devices.length === 0 ? (
                <p className="text-sm text-muted">{t('tenantUx.noDevices')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-input border border-line">
                  {devices.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 font-medium break-words">{x.name}</span>
                      <span className="text-muted">{t('tenant.lastSeen', { date: fmtDate(x.last_seen_at, l) })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canSignOut && <SignOutDevices tenantId={d.tenant.id} venue={v} count={devices.length} onDone={() => setAnnounce(t('devices.done', { venue: v.name }))} />}
            <div>
              <h3 className="eyebrow mb-2">{t('tenant.displays', { count: displays.length })}</h3>
              {displays.length === 0 ? (
                <p className="text-sm text-muted">{t('tenantUx.noDisplays')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-input border border-line">
                  {displays.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 font-medium break-words">{x.name}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {x.paired_at ? <Pill tone="ok">{t('tenant.paired')}</Pill> : <Pill>{t('tenant.notPaired')}</Pill>}
                        {x.sound_enabled ? <Pill tone="info">{t('tenant.soundOn')}</Pill> : <Pill tone="warn">{t('tenant.soundOff')}</Pill>}
                        <span className="text-muted">{t('tenant.lastSeen', { date: fmtDate(x.last_seen_at, l) })}</span>
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

/** Sign out all staff devices of one venue (FR-SA-16), after a confirmation. */
function SignOutDevices({ tenantId, venue, count, onDone }: { tenantId: string; venue: TenantDetail['venues'][number]; count: number; onDone: () => void }) {
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
        <Button variant="secondary" className="text-danger" disabled={count === 0} onClick={() => setOpen(true)}>
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
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('billing.paidPeriod')}</h2>
        <dl className="divide-y divide-line">
          <InfoRow label={t('tenant.paidUntil')}>{b.complimentary ? t('tenants.complimentary') : fmtDate(b.paidUntil, l)}</InfoRow>
          <InfoRow label={t('tenant.trialEnds')}>{fmtDate(b.trialEndsAt, l)}</InfoRow>
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
    <Table caption={t('billing.payments')} head={[t('billing.recorded'), t('billing.amount'), t('billing.covers'), t('billing.methodLabel'), t('billing.reference')]}>
      {payments.length === 0 && (
        <tr>
          <Td className="text-muted">{t('billing.noPayments')}</Td>
        </tr>
      )}
      {payments.map((p) => (
        <tr key={p.id}>
          <Td>{fmtDate(p.recordedAt, l)}</Td>
          <Td className="num">{formatMoney(p.amountMinor, p.currency, l)}</Td>
          <Td>
            {fmtDate(p.coversFrom, l)} – {fmtDate(p.coversUntil, l)}
          </Td>
          <Td>{t(`billing.method.${p.method}`)}</Td>
          <Td>
            {p.reference ?? '—'}
            {p.note && <span className="block text-sm text-muted">{p.note}</span>}
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
    <>
      <AuditTable rows={q.data.items} />
      <Link to={`/audit?tenantId=${id}`} className="mt-3 inline-flex min-h-12 items-center text-primary underline">
        {t('tenant.moreAudit')}
      </Link>
    </>
  );
}
