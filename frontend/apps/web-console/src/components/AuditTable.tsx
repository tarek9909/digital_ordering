import { useTranslation } from '@dop/i18n';
import { EmptyState } from '@dop/ui';
import { Link } from 'react-router';
import { fmtDate } from '../lib/format';
import type { AuditRow } from '../lib/types';
import { Table, Td } from './common';

function actionTone(action: string): string {
  if (/delete|suspend|revoke|purge|cancel/i.test(action)) return 'bg-danger-bg text-danger ring-danger/30';
  if (/create|publish|activate|enable|grant/i.test(action)) return 'bg-ok/10 text-ok ring-ok/30';
  if (/plan|payment|billing|upgrade|extend/i.test(action)) return 'bg-primary/10 text-primary ring-primary/30';
  if (/mfa|role|password|auth|security/i.test(action)) return 'bg-info/10 text-info ring-info/30';
  return 'bg-canvas text-ink ring-line';
}

export function AuditTable({ rows, showTenant }: { rows: AuditRow[]; showTenant?: boolean }) {
  const { t, i18n } = useTranslation();
  const head = [t('audit.when'), t('audit.action'), t('audit.actor'), ...(showTenant ? [t('audit.tenant')] : []), t('audit.entity'), t('audit.purpose')];
  if (rows.length === 0) return <EmptyState title={t('audit.empty')}>{t('audit.emptyHint')}</EmptyState>;
  return (
    <Table caption={t('audit.title')} head={head}>
      {rows.map((r) => (
        <tr key={r.id} className="hover:bg-canvas/40">
          <Td className="whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <svg aria-hidden="true" className="size-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {fmtDate(r.occurred_at, i18n.language)}
            </span>
          </Td>
          <Td>
            <span dir="ltr" className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold ring-1 whitespace-nowrap ${actionTone(r.action)}`}>
              {r.action}
            </span>
          </Td>
          <Td>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-ink">
                {t(`actorType.${r.actor_type}`, { defaultValue: r.actor_type })}
              </span>
              {r.actor_id && (
                <span dir="ltr" className="font-mono text-[11px] text-muted">
                  {r.actor_id.slice(0, 12)}…
                </span>
              )}
            </div>
          </Td>
          {showTenant && (
            <Td>
              {r.tenant_id ? (
                <Link className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-0.5 font-mono text-xs font-semibold text-ink ring-1 ring-line hover:text-primary hover:ring-primary/40" to={`/tenants/${r.tenant_id}`} dir="ltr">
                  <span>{r.tenant_id.slice(0, 8)}…</span>
                </Link>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Td>
          )}
          <Td>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-ink">{r.entity_type}</span>
              {r.entity_id && (
                <span dir="ltr" className="font-mono text-[11px] text-muted">
                  {r.entity_id.slice(0, 12)}…
                </span>
              )}
            </div>
          </Td>
          <Td>
            {r.purpose ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
                  r.purpose === 'security'
                    ? 'bg-danger-bg text-danger ring-danger/30'
                    : r.purpose === 'billing'
                    ? 'bg-primary-wash text-primary ring-primary/20'
                    : 'bg-canvas text-ink-2 ring-line'
                }`}
              >
                {r.purpose === 'security' && (
                  <svg aria-hidden="true" className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
                {t(`purpose.${r.purpose}`)}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}
