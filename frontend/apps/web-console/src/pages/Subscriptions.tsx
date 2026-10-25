import { useTranslation } from '@dop/i18n';
import { PageShell, Skeleton, Stat } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ErrorNote, StatusBadge, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { fmtDay } from '../lib/format';

// Monthly review: who is active and who is not, and when each one ends or ended. The same figures are emailed to
// every console user on the 1st of the month.

interface Row {
  id: string;
  name: string;
  slug: string;
  status: string;
  complimentary: boolean;
  endsAt: string | null;
  stoppedAt: string | null;
  endsInDays: number | null;
}
interface SubscriptionsResponse {
  generatedAt: string;
  counts: { running: number; stopped: number; endingIn30Days: number };
  running: Row[];
  stopped: Row[];
}

export function SubscriptionsPage() {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  const q = useQuery({ queryKey: ['subscriptions'], queryFn: () => api.get<SubscriptionsResponse>('/reports/subscriptions') });
  const d = q.data;
  const name = (r: Row) => (
    <Link to={`/tenants/${r.id}`} className="font-semibold text-ink hover:underline">
      {r.name}
    </Link>
  );
  return (
    <PageShell wide eyebrow={t('layout.groups.insights')} title={t('subscriptions.title')} description={t('subscriptions.description')}>
      <ErrorNote error={q.error} />
      {!d && q.isFetching && <Skeleton className="h-40 w-full" />}
      {d && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat accent label={t('subscriptions.active')} value={String(d.counts.running)} />
            <Stat label={t('subscriptions.endingSoon')} value={String(d.counts.endingIn30Days)} />
            <Stat label={t('subscriptions.stopped')} value={String(d.counts.stopped)} />
          </div>
          <Table caption={t('subscriptions.active')} head={[t('subscriptions.restaurant'), t('subscriptions.status'), t('subscriptions.endsOn'), t('subscriptions.daysLeft')]}>
            {d.running.map((r) => (
              <tr key={r.id}>
                <Td>{name(r)}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td>{r.complimentary ? t('subscriptions.never') : fmtDay(r.endsAt, l)}</Td>
                <Td className={r.endsInDays !== null && r.endsInDays <= 7 ? 'font-semibold text-danger' : undefined}>{r.endsInDays === null ? '—' : r.endsInDays}</Td>
              </tr>
            ))}
          </Table>
          <Table caption={t('subscriptions.stopped')} head={[t('subscriptions.restaurant'), t('subscriptions.status'), t('subscriptions.stoppedOn')]}>
            {d.stopped.map((r) => (
              <tr key={r.id}>
                <Td>{name(r)}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td>{fmtDay(r.stoppedAt, l)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </PageShell>
  );
}
