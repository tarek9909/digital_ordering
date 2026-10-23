import { useTranslation } from '@dop/i18n';
import { EmptyState } from '@dop/ui';
import { Link } from 'react-router';
import { fmtDate } from '../lib/format';
import type { AuditRow } from '../lib/types';
import { Table, Td } from './common';

export function AuditTable({ rows, showTenant }: { rows: AuditRow[]; showTenant?: boolean }) {
  const { t, i18n } = useTranslation();
  const head = [t('audit.when'), t('audit.action'), t('audit.actor'), ...(showTenant ? [t('audit.tenant')] : []), t('audit.entity'), t('audit.purpose')];
  if (rows.length === 0) return <EmptyState title={t('audit.empty')}>{t('audit.emptyHint')}</EmptyState>;
  return (
    <Table caption={t('audit.title')} head={head}>
      {rows.map((r) => (
        <tr key={r.id}>
          <Td className="whitespace-nowrap text-ink-2">{fmtDate(r.occurred_at, i18n.language)}</Td>
          <Td>
            <code dir="ltr" className="font-mono text-xs whitespace-nowrap">
              {r.action}
            </code>
          </Td>
          <Td>
            {t(`actorType.${r.actor_type}`, { defaultValue: r.actor_type })}
            {r.actor_id && (
              <span dir="ltr" className="block font-mono text-[0.6875rem] text-muted">
                {r.actor_id}
              </span>
            )}
          </Td>
          {showTenant && (
            <Td>
              {r.tenant_id ? (
                <Link className="font-mono text-xs font-semibold text-ink underline decoration-primary/40 underline-offset-4 hover:text-primary" to={`/tenants/${r.tenant_id}`} dir="ltr">
                  {r.tenant_id.slice(0, 8)}…
                </Link>
              ) : (
                '—'
              )}
            </Td>
          )}
          <Td>
            {r.entity_type}
            {r.entity_id && (
              <span dir="ltr" className="block font-mono text-[0.6875rem] text-muted">
                {r.entity_id}
              </span>
            )}
          </Td>
          <Td>{r.purpose ? t(`purpose.${r.purpose}`) : '—'}</Td>
        </tr>
      ))}
    </Table>
  );
}
