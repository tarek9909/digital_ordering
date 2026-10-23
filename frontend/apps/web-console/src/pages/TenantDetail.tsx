import type { AuditPurpose } from '@dop/contracts';
import { formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Card, LiveRegion, Modal, PageShell, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { AuditTable } from '../components/AuditTable';
import { ErrorNote, FormButtons, StatusBadge, Table, Td } from '../components/common';
import { PurposeGate } from '../components/PurposeGate';
import { TenantActions } from '../components/TenantActions';
import { CommercialActions } from '../components/tenant/CommercialActions';
import { FlagsTab } from '../components/tenant/FlagsTab';
import { NotesTab } from '../components/tenant/NotesTab';
import { SupportTab } from '../components/tenant/SupportTab';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
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
  const { t } = useTranslation();
  const role = useMe().data?.platformUser.role;
  const [tab, setTab] = useState<Tab>('overview');
  const detail = useQuery({
    queryKey: ['tenant', id, purpose],
    queryFn: () => api.call<TenantDetail>('GET', `/tenants/${id}`, { headers: purposeHeaders(purpose) }),
  });
  const tabs = TABS.filter((x) => tabAllowed(role, x));

  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    const step = e.key === 'ArrowRight' ? dir : e.key === 'ArrowLeft' ? -dir : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

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

  return (
    <PageShell
      wide
      eyebrow={
        <span className="inline-flex items-center gap-2">
          {t('tenant.eyebrow')}
          <span dir="ltr" className="font-mono normal-case">
            {d.tenant.slug}
          </span>
          <span className="font-sans tracking-normal normal-case">
            <StatusBadge status={d.tenant.status} />
          </span>
        </span>
      }
      title={d.tenant.name}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">{t('tenant.purposeIs', { purpose: t(`purpose.${purpose}`) })}</span>
          <Button
            variant="ghost"
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
      <div role="tablist" aria-label={t('tenant.tabs')} className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((x, i) => (
          <button
            key={x}
            id={`tab-${x}`}
            role="tab"
            aria-selected={tab === x}
            aria-controls={`panel-${x}`}
            tabIndex={tab === x ? 0 : -1}
            onClick={() => setTab(x)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px min-h-12 border-b-2 px-4 font-semibold transition-colors ${tab === x ? 'border-primary text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {t(`tenant.tab.${x}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && (
          <>
            <Overview d={d} />
            {can(role, 'tenants.lifecycle') && <TenantActions tenant={d.tenant} />}
            <CommercialActions tenant={d.tenant} />
          </>
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 font-medium text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Overview({ d }: { d: TenantDetail }) {
  const { t, i18n } = useTranslation();
  const x = d.tenant;
  const l = i18n.language;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('tenant.profile')}</h2>
        <dl className="divide-y divide-line">
          <Row label={t('tenants.slug')}>
            <span dir="ltr">{x.slug}</span>
          </Row>
          <Row label={t('tenants.status')}>
            <StatusBadge status={x.status} />
            {x.statusReason && <span className="ms-2 text-sm text-muted">{x.statusReason}</span>}
          </Row>
          <Row label={t('tenants.plan')}>
            {t(`plan.${x.plan}`, { defaultValue: x.plan })} {x.complimentary && `(${t('tenants.complimentary')})`}
          </Row>
          <Row label={t('tenant.trialEnds')}>{fmtDate(x.trialEndsAt, l)}</Row>
          <Row label={t('tenant.paidUntil')}>{fmtDate(x.paidUntil, l)}</Row>
          <Row label={t('tenant.graceEnds')}>{fmtDate(x.graceEndsAt, l)}</Row>
          <Row label={t('tenant.deletionRequested')}>{fmtDate(x.deletionRequestedAt, l)}</Row>
          <Row label={t('tenant.country')}>{x.country}</Row>
          <Row label={t('tenant.locale')}>{x.defaultLocale}</Row>
          <Row label={t('tenants.created')}>{fmtDate(x.createdAt, l)}</Row>
          <Row label={t('tenants.lastActivity')}>{fmtDate(x.lastActivityAt, l)}</Row>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('tenant.members')}</h2>
        <ul className="divide-y divide-line">
          {d.members.map((m) => (
            <li key={m.id} className="py-2">
              <span className="font-medium">{m.name}</span> · {t(`memberRole.${m.role}`, { defaultValue: m.role })}
              <span dir="ltr" className="block text-sm text-muted">
                {m.email}
              </span>
              <span className="text-sm">{m.verified ? `✓ ${t('tenant.verified')}` : `✗ ${t('tenant.notVerified')}`}</span>
            </li>
          ))}
        </ul>
        <h2 className="mt-4 mb-2 text-lg font-bold">{t('tenant.lastPayment')}</h2>
        {d.payments[0] ? (
          <p>
            {formatMoney(d.payments[0].amountMinor, d.payments[0].currency, l)} · {t('billing.monthsCount', { count: d.payments[0].months })} · {t(`billing.method.${d.payments[0].method}`)} ·{' '}
            {fmtDate(d.payments[0].recordedAt, l)}
          </p>
        ) : (
          <p className="text-muted">{t('billing.noPayments')}</p>
        )}
      </Card>
    </div>
  );
}

function Venues({ d, canSignOut }: { d: TenantDetail; canSignOut: boolean }) {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  const [announce, setAnnounce] = useState('');
  return (
    <div className="flex flex-col gap-6">
      <LiveRegion text={announce} />
      {d.venues.map((v) => {
        const devices = d.devices.filter((x) => x.venue_id === v.id);
        const displays = d.displays.filter((x) => x.venue_id === v.id);
        return (
          <Card key={v.id}>
            <h2 className="text-lg font-bold">
              {v.name} <span className="text-sm font-normal text-muted" dir="ltr">({v.venue_code})</span>
            </h2>
            <p className="mb-3 text-sm text-muted">
              {t(`venueStatus.${v.status}`, { defaultValue: v.status })} · <span dir="ltr">{v.time_zone}</span>
            </p>
            <h3 className="font-semibold">{t('tenant.devices', { count: devices.length })}</h3>
            <ul className="mb-3 list-disc ps-6">
              {devices.map((x) => (
                <li key={x.id}>
                  {x.name} — {t('tenant.lastSeen', { date: fmtDate(x.last_seen_at, l) })}
                </li>
              ))}
            </ul>
            {canSignOut && <SignOutDevices tenantId={d.tenant.id} venue={v} count={devices.length} onDone={() => setAnnounce(t('devices.done', { venue: v.name }))} />}
            <h3 className="font-semibold">{t('tenant.displays', { count: displays.length })}</h3>
            <ul className="list-disc ps-6">
              {displays.map((x) => (
                <li key={x.id}>
                  {x.name} — {x.paired_at ? t('tenant.paired') : t('tenant.notPaired')} · {x.sound_enabled ? t('tenant.soundOn') : `⚠ ${t('tenant.soundOff')}`} ·{' '}
                  {t('tenant.lastSeen', { date: fmtDate(x.last_seen_at, l) })}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {d.venues.length === 0 && <p className="text-muted">{t('tenant.noVenues')}</p>}
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
      <div className="mb-3">
        <Button variant="danger" disabled={count === 0} onClick={() => setOpen(true)}>
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
        <dl>
          <Row label={t('tenant.paidUntil')}>{b.complimentary ? t('tenants.complimentary') : fmtDate(b.paidUntil, l)}</Row>
          <Row label={t('tenant.trialEnds')}>{fmtDate(b.trialEndsAt, l)}</Row>
          <Row label={t('tenant.graceEnds')}>{fmtDate(b.graceEndsAt, l)}</Row>
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
