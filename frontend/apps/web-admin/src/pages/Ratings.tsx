import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { LiveRegion } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmButton, ErrorNote, QueryView, Table, Td } from '../components/common';
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
      <span aria-hidden="true" className="text-[#b45309]">
        {'★'.repeat(n)}
      </span>
      <span aria-hidden="true" className="text-muted">
        {'☆'.repeat(Math.max(0, 5 - n))}
      </span>
    </span>
  );
}

/** How many ratings of each star count, over every retained rating (BRD §12.1 "Rating: distribution"). */
export function Distribution({ summary }: { summary: RatingSummary }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...summary.distribution);
  return (
    <section aria-labelledby="rating-dist-h" className="mb-4">
      <h2 id="rating-dist-h" className="mb-2 font-bold">
        {t('ratings.distributionTitle')}
      </h2>
      <Table caption={t('ratings.distributionTitle')} head={[t('ratings.stars'), t('ratings.count'), t('ratings.share')]}>
        {[5, 4, 3, 2, 1].map((n) => {
          const c = summary.distribution[n - 1] ?? 0;
          return (
            <tr key={n}>
              <Td>
                <Stars n={n} />
              </Td>
              <Td className="num">
                <span className="me-2 inline-block h-3 rounded-sm bg-[#b45309] align-middle" style={{ width: `${Math.round((c / max) * 8)}rem` }} aria-hidden="true" />
                {c}
              </Td>
              <Td className="num">{summary.count ? `${Math.round((c / summary.count) * 100)}%` : '—'}</Td>
            </tr>
          );
        })}
      </Table>
    </section>
  );
}

export function RatingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const venueId = useCurrentVenueId();
  const key = ['ratings', venueId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ items: Rating[]; summary?: RatingSummary }>('/ratings', { venueId: venueId ?? undefined }), enabled: Boolean(venueId) });
  // Deleting customer comments is the owner's decision (L-10).
  const isOwner = useRole() === 'owner';
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/ratings/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const summary = q.data?.summary;
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{t('nav.ratings')}</h1>
      <p className="mb-4 text-muted">{t('ratings.intro')}</p>
      {summary && summary.average !== null && <p className="mb-4 font-semibold">{t('ratings.average', { avg: summary.average, n: summary.count })}</p>}
      {summary && summary.count > 0 && <Distribution summary={summary} />}
      <ErrorNote error={remove.error} />
      <QueryView q={q}>
        {({ items: list }) =>
          list.length === 0 ? (
            <p className="text-muted">{t('ratings.none')}</p>
          ) : (
            <Table caption={t('nav.ratings')} head={[t('ratings.stars'), t('ratings.comment'), t('ratings.ticket'), t('ratings.when'), '']}>
              {list.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Stars n={r.stars} />
                  </Td>
                  <Td className="max-w-md break-words">{r.comment ?? <span className="text-muted">{r.commentDeleted ? t('ratings.commentDeleted') : t('ratings.noComment')}</span>}</Td>
                  <Td>
                    <span dir="ltr" className="num font-semibold">
                      {r.displayNumber}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(r.createdAt, i18n.language)}</Td>
                  <Td>
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
    </>
  );
}
