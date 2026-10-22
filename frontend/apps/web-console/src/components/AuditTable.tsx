import { useTranslation } from '@dop/i18n';
import { Link } from 'react-router';
import { fmtDate } from '../lib/format';
import type { AuditRow } from '../lib/types';
import { Table, Td } from './common';

export function AuditTable({ rows, showTenant }: { rows: AuditRow[]; showTenant?: boolean }) {
  const { t, i18n } = useTranslation();
  const head = [t('audit.when'), t('audit.action'), t('audit.actor'), ...(showTenant ? [t('audit.tenant')] : []), t('audit.entity'), t('audit.purpose')];
  return (
    <Table caption={t('audit.title')} head={head}>
      {rows.length === 0 && (
        <tr>
          <Td className="text-muted">{t('audit.empty')}</Td>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={r.id}>
          <Td>{fmtDate(r.occurred_at, i18n.language)}</Td>
          <Td>
            <code dir="ltr">{r.action}</code>
          </Td>
          <Td>
            {t(`actorType.${r.actor_type}`, { defaultValue: r.actor_type })}
            {r.actor_id && (
              <span dir="ltr" className="block text-xs text-muted">
                {r.actor_id}
              </span>
            )}
          </Td>
          {showTenant && (
            <Td>
              {r.tenant_id ? (
                <Link className="text-primary underline" to={`/tenants/${r.tenant_id}`} dir="ltr">
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
              <span dir="ltr" className="block text-xs text-muted">
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
