import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { EmptyState, LiveRegion } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmButton, ErrorNote, Figures, Page, QueryView, Section, Stat, Table, Td } from '../components/common';
import { SubNav } from '../components/SubNav';
import { api } from '../lib/api';
import type { Rating, RatingSummary } from '../lib/types';
import { useRole } from '../lib/me';
import { useCurrentVenueId } from '../lib/venue';

// Customer ratings (FR-RPT-08/09): stars, optional comment, ticket number and time. Owners and managers can delete
// a comment; the stars stay in the reports.

export function Stars({ n }: { n: number }) {
  const { t } = useTranslation();
  return (
    <span role="img" aria-label={t('ratings.starsLabel', { n })} className="whitespace-nowrap text-lg">
      <span aria-hidden="true" className="text-warn">
        {'★'.repeat(n)}
      </span>
      <span aria-hidden="true" className="text-line">
        {'★'.repeat(Math.max(0, 5 - n))}
      </span>
    </span>
  );
}

/** How many ratings of each star count, over every retained rating (BRD §12.1 "Rating: distribution"). */
export function Distribution({ summary }: { summary: RatingSummary }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...summary.distribution);
  return (
    <Section title={t('ratings.distributionTitle')}>
      <Table caption={t('ratings.distributionTitle')} head={[t('ratings.stars'), t('ratings.count'), t('ratings.share')]}>
        {[5, 4, 3, 2, 1].map((n) => {
          const c = summary.distribution[n - 1] ?? 0;
          return (
            <tr key={n}>
              <Td className="w-32">
                <Stars n={n} />
              </Td>
              <Td className="num">
                <span className="flex items-center gap-3">
                  <span className="h-2 w-full max-w-48 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
                    <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.round((c / max) * 100)}%` }} />
                  </span>
                  <span className="w-8 font-semibold">{c}</span>
                </span>
              </Td>
              <Td className="num text-ink-2">{summary.count ? `${Math.round((c / summary.count) * 100)}%` : '—'}</Td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

export function RatingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const venueId = useCurrentVenueId();
  const key = ['ratings', venueId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<{ items: Rating[]; summary?: RatingSummary }>('/ratings', {
        venueId: venueId ?? undefined,
      }),
    enabled: Boolean(venueId),
  });
  // Deleting customer comments is the owner's decision (L-10).
  const isOwner = useRole() === 'owner';
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/ratings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const summary = q.data?.summary;
  return (
    <Page title={t('nav.ratings')} description={t('ratings.intro')} tabs={<SubNav group="insights" />}>
      {summary && summary.count > 0 && (
        <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start">
          {summary.average !== null ? (
            <Figures>
              <Stat
                lead
                label={t('trends.rating')}
                value={`${summary.average}`}
                hint={t('ratings.average', {
                  avg: summary.average,
                  n: summary.count,
                })}
              />
            </Figures>
          ) : (
            <div />
          )}
          <div className="[&>section]:mb-0">
            <Distribution summary={summary} />
          </div>
        </div>
      )}
      <ErrorNote error={remove.error} />
      <QueryView q={q} skeleton="table">
        {({ items: list }) =>
          list.length === 0 ? (
            <EmptyState title={t('ratings.none')}>{t('ratings.noneBody')}</EmptyState>
          ) : (
            <Table raised caption={t('nav.ratings')} head={[t('ratings.stars'), t('ratings.comment'), t('ratings.ticket'), t('ratings.when'), '']}>
              {list.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Stars n={r.stars} />
                  </Td>
                  <Td className="max-w-md break-words">
                    {r.comment ? <span dir="auto">{r.comment}</span> : <span className="text-muted italic">{r.commentDeleted ? t('ratings.commentDeleted') : t('ratings.noComment')}</span>}
                  </Td>
                  <Td>
                    <span dir="ltr" className="num font-display font-bold">
                      {r.displayNumber}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{formatDateTime(r.createdAt, i18n.language)}</Td>
                  <Td className="text-end">
                    {r.comment && isOwner && (
                      <ConfirmButton
                        label={t('ratings.deleteComment')}
                        title={t('ratings.deleteTitle')}
                        description={t('ratings.deleteBody')}
                        confirmLabel={t('ratings.deleteComment')}
                        variant="danger"
                        busy={remove.isPending && remove.variables === r.id}
                        onConfirm={() => remove.mutateAsync(r.id).catch(() => undefined)}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )
        }
      </QueryView>
      <LiveRegion text={remove.isSuccess ? t('ratings.deleted') : ''} />
    </Page>
  );
}
