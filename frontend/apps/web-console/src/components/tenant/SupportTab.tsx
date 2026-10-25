import type { AuditPurpose } from '@dop/contracts';
import { supportCodeBody, supportRequestBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Card, Field, LiveRegion, Modal, Pill, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { errorText, isCode } from '../../lib/errors';
import { fmtDate } from '../../lib/format';
import { useMe } from '../../lib/me';
import { purposeHeaders } from '../../lib/purpose';
import { can } from '../../lib/roles';
import { cleanCode, isLive, isMine, SUPPORT_DEFAULT_MINUTES, SUPPORT_MAX_MINUTES, SUPPORT_MIN_MINUTES, type SupportSession } from '../../lib/support';
import type { TenantDetail } from '../../lib/types';
import { ErrorNote, FormButtons, Table, Td, TextArea } from '../common';
import { MfaCancelled, useFreshMfa } from '../FreshMfa';

// Support access (FR-SUP-02 – FR-SUP-06, §8.3): request → owner/manager approves or reads an 8-digit code by phone
// → the agent enters the tenant admin through a one-time handoff URL. Emergency access is super admin only.

type Tenant = TenantDetail['tenant'];
type Dialog = { kind: 'code'; session: SupportSession } | { kind: 'end'; session: SupportSession } | { kind: 'emergency' } | null;

export function SupportTab({ tenant, purpose }: { tenant: Tenant; purpose: AuditPurpose }) {
  const { t, i18n } = useTranslation();
  const me = useMe().data?.platformUser;
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [announce, setAnnounce] = useState('');
  const [handoff, setHandoff] = useState<string | null>(null);
  const key = ['support-sessions', tenant.id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.call<{ items: SupportSession[] }>('GET', `/tenants/${tenant.id}/support-sessions`, { headers: purposeHeaders(purpose) }),
  });
  const refresh = (msg: string) => {
    setDialog(null);
    setAnnounce(msg);
    void qc.invalidateQueries({ queryKey: key });
  };

  const enter = useMutation({
    mutationFn: (s: SupportSession) => api.post<{ url: string }>(`/support-sessions/${s.id}/enter`, undefined, purposeHeaders(purpose)),
    onSuccess: ({ url }) => {
      const w = window.open('', '_blank');
      if (w) {
        w.opener = null;
        w.location.href = url;
      }
      setHandoff(w ? null : url);
      setAnnounce(t('support.entered'));
    },
  });

  const l = i18n.language;
  return (
    <div className="flex flex-col gap-6">
      <LiveRegion toast text={announce} />
      <RequestForm tenantId={tenant.id} purpose={purpose} onDone={() => refresh(t('support.requested'))} />
      {can(me?.role, 'support.emergency') && (
        <Card className="rounded-2xl border border-danger/30 bg-danger-bg/25 p-5 shadow-card">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="grid size-6 place-items-center rounded-md bg-danger text-white text-xs font-bold" aria-hidden="true">
              !
            </span>
            <h2 className="text-base font-bold text-danger uppercase tracking-wider">{t('support.emergency.title')}</h2>
          </div>
          <p className="mb-4 text-xs sm:text-sm text-ink-2 max-w-2xl">{t('support.emergency.intro')}</p>
          <Button variant="danger" size="md" className="font-bold shadow-button" onClick={() => setDialog({ kind: 'emergency' })}>
            {t('support.emergency.button')}
          </Button>
        </Card>
      )}
      <ErrorNote error={q.error ?? enter.error} />
      {handoff && (
        <Banner tone="warn">
          {t('support.popupBlocked')}{' '}
          <a href={handoff} target="_blank" rel="noreferrer noopener" className="underline font-bold" onClick={() => setHandoff(null)}>
            {t('support.openLink')}
          </a>
        </Banner>
      )}
      {q.isPending ? (
        <div className="p-8 text-center">
          <Spinner label={t('common:loading')} />
        </div>
      ) : (
        <Table
          caption={t('support.sessions')}
          head={[t('support.status'), t('support.agent'), t('support.reason'), t('support.requestedAt'), t('support.expiresAt'), t('support.actions')]}
        >
          {q.data?.items.length === 0 && (
            <tr>
              <Td className="text-muted text-center py-6" colSpan={6}>
                {t('support.none')}
              </Td>
            </tr>
          )}
          {q.data?.items.map((s) => {
            const mine = isMine(s, me?.name);
            const live = isLive(s);
            const shown = s.status === 'active' && !live ? 'expired' : s.status;
            return (
              <tr key={s.id}>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    <Pill tone={live ? 'ok' : shown === 'requested' ? 'warn' : 'neutral'} className="text-xs">
                      {live && <span className="nova-live-dot size-1.5 bg-current" aria-hidden="true" />}
                      {t(`support.state.${shown}`, { defaultValue: shown })}
                    </Pill>
                    {s.kind === 'emergency' && <span className="font-bold text-danger text-xs">· {t('support.emergencyKind')}</span>}
                  </span>
                </Td>
                <Td className="font-semibold text-xs text-ink">{s.agentName}</Td>
                <Td className="max-w-64 break-words whitespace-pre-wrap text-xs text-ink-2">{s.reason}</Td>
                <Td className="text-xs text-muted whitespace-nowrap">{fmtDate(s.requestedAt, l)}</Td>
                <Td className="text-xs text-muted whitespace-nowrap">{fmtDate(s.expiresAt, l)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {s.status === 'requested' && mine && (
                      <Button variant="secondary" size="md" className="text-xs font-bold" onClick={() => setDialog({ kind: 'code', session: s })}>
                        {t('support.enterCode')}
                      </Button>
                    )}
                    {live && mine && (
                      <Button size="md" className="text-xs font-bold shadow-button" busy={enter.isPending && enter.variables?.id === s.id} onClick={() => enter.mutate(s)}>
                        {t('support.open')}
                      </Button>
                    )}
                    {live && (mine || me?.role === 'super_admin') && (
                      <Button variant="danger" size="md" className="text-xs font-bold" onClick={() => setDialog({ kind: 'end', session: s })}>
                        {t('support.end')}
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      {dialog?.kind === 'code' && (
        <Modal open onOpenChange={(o) => !o && setDialog(null)} title={t('support.code.title')} description={t('support.code.body')}>
          <div className="pt-2">
            <CodeForm session={dialog.session} purpose={purpose} onCancel={() => setDialog(null)} onDone={() => refresh(t('support.code.done'))} />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'end' && (
        <Modal open onOpenChange={(o) => !o && setDialog(null)} title={t('support.endTitle')} description={t('support.endBody')}>
          <div className="pt-2">
            <EndForm session={dialog.session} purpose={purpose} onCancel={() => setDialog(null)} onDone={() => refresh(t('support.ended'))} />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'emergency' && (
        <Modal open onOpenChange={(o) => !o && setDialog(null)} title={t('support.emergency.title')} description={t('support.emergency.body', { slug: tenant.slug })}>
          <div className="pt-2">
            <EmergencyForm tenant={tenant} purpose={purpose} onCancel={() => setDialog(null)} onDone={() => refresh(t('support.emergency.done'))} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function RequestForm({ tenantId, purpose, onDone }: { tenantId: string; purpose: AuditPurpose; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(String(SUPPORT_DEFAULT_MINUTES));
  const [errs, setErrs] = useState<{ reason?: boolean; minutes?: boolean }>({});
  const m = useMutation({
    mutationFn: (body: { reason: string; durationMinutes: number }) => api.post(`/tenants/${tenantId}/support-sessions`, body, purposeHeaders(purpose)),
    onSuccess: () => {
      setReason('');
      setMinutes(String(SUPPORT_DEFAULT_MINUTES));
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = supportRequestBody.safeParse({ reason, durationMinutes: Number(minutes) });
    if (!r.success) {
      const paths = new Set(r.error.issues.map((i) => i.path[0]));
      setErrs({ reason: paths.has('reason'), minutes: paths.has('durationMinutes') });
      return;
    }
    setErrs({});
    m.mutate(r.data);
  };
  const range = { min: SUPPORT_MIN_MINUTES, max: SUPPORT_MAX_MINUTES };
  return (
    <Card className="rounded-2xl border border-line shadow-card p-5">
      <h2 className="mb-1 font-display text-lg font-bold text-ink">{t('support.request.title')}</h2>
      <p className="mb-4 text-xs sm:text-sm text-muted">{t('support.request.intro')}</p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <ErrorNote error={m.error} />
        <TextArea
          label={t('support.reason')}
          maxLength={500}
          value={reason}
          placeholder="Detailed explanation of the issue or ticket context..."
          error={errs.reason ? t('support.request.reasonInvalid') : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex flex-col gap-2">
          <Field
            label={t('support.request.duration')}
            type="number"
            inputMode="numeric"
            min={SUPPORT_MIN_MINUTES}
            max={SUPPORT_MAX_MINUTES}
            className="max-w-xs"
            value={minutes}
            error={errs.minutes ? t('support.request.durationInvalid', range) : undefined}
            hint={t('support.request.durationHint', range)}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[15, 30, 60, 240].map((mVal) => (
              <button
                key={mVal}
                type="button"
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold ring-1 transition-all ${
                  minutes === String(mVal)
                    ? 'bg-ink text-white ring-ink shadow-sm'
                    : 'bg-canvas text-ink-2 ring-line hover:bg-surface'
                }`}
                onClick={() => setMinutes(String(mVal))}
              >
                {mVal < 60 ? `${mVal} min` : `${mVal / 60} hr`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end pt-2 border-t border-line/50">
          <Button type="submit" size="md" className="font-bold shadow-button px-5" busy={m.isPending}>
            {t('support.request.button')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CodeForm({ session, purpose, onCancel, onDone }: { session: SupportSession; purpose: AuditPurpose; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const m = useMutation({ mutationFn: (c: string) => api.post(`/support-sessions/${session.id}/verify-code`, { code: c }, purposeHeaders(purpose)), onSuccess: onDone });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = supportCodeBody.safeParse({ code });
    setInvalid(!r.success);
    if (r.success) m.mutate(r.data.code);
  };
  const serverErr = m.error ? (isCode(m.error, 'SUPPORT_CODE_INVALID') ? t('support.code.wrong') : errorText(t, m.error)) : undefined;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4.5" noValidate>
      <Field
        label={t('support.code.label')}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        autoFocus
        className="font-mono text-center tracking-[0.25em] text-lg font-bold"
        value={code}
        error={invalid ? t('support.code.format') : serverErr}
        onChange={(e) => setCode(cleanCode(e.target.value))}
      />
      <FormButtons onCancel={onCancel} busy={m.isPending} label={t('support.code.verify')} />
    </form>
  );
}

function EndForm({ session, purpose, onCancel, onDone }: { session: SupportSession; purpose: AuditPurpose; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const m = useMutation({ mutationFn: () => api.post(`/support-sessions/${session.id}/end`, undefined, purposeHeaders(purpose)), onSuccess: onDone });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="flex flex-col gap-4.5"
    >
      <ErrorNote error={m.error} />
      <FormButtons onCancel={onCancel} busy={m.isPending} label={t('support.end')} danger />
    </form>
  );
}

function EmergencyForm({ tenant, purpose, onCancel, onDone }: { tenant: Tenant; purpose: AuditPurpose; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const run = useFreshMfa();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errs, setErrs] = useState<{ reason?: boolean; confirm?: boolean }>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = reason.trim();
    const bad = { reason: r.length < 10 || r.length > 500, confirm: confirm.trim() !== tenant.slug };
    setErrs(bad);
    if (bad.reason || bad.confirm) return;
    setBusy(true);
    setError(null);
    try {
      await run(() => api.post(`/tenants/${tenant.id}/support-sessions/emergency`, { reason: r, confirm: confirm.trim() }, purposeHeaders(purpose)));
      onDone();
    } catch (x) {
      if (!(x instanceof MfaCancelled)) setError(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4.5" noValidate>
      <Banner tone="warn">{t('support.emergency.ownerNotified')}</Banner>
      <ErrorNote error={error} />
      <TextArea
        label={t('support.reason')}
        maxLength={500}
        value={reason}
        error={errs.reason ? t('support.emergency.reasonInvalid') : undefined}
        onChange={(e) => setReason(e.target.value)}
      />
      <Field
        label={t('actions.typeSlug', { slug: tenant.slug })}
        dir="ltr"
        autoComplete="off"
        value={confirm}
        error={errs.confirm ? t('actions.slugMismatch') : undefined}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <FormButtons onCancel={onCancel} busy={busy} label={t('support.emergency.button')} danger />
    </form>
  );
}
