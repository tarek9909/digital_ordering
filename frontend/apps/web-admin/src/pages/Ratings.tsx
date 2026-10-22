import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { LiveRegion } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmButton, ErrorNote, QueryView, Table, Td } from '../components/common';
import { api } from '../lib/api';
import type { Rating } from '../lib/types';
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

export function RatingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const venueId = useCurrentVenueId();
  const key = ['ratings', venueId] as const;
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get<{ items: Rating[] }>('/ratings', { venueId: venueId ?? undefined })).items, enabled: Boolean(venueId) });
  // Deleting customer comments is the owner's decision (L-10).
  const isOwner = useRole() === 'owner';
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/ratings/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const items = q.data ?? [];
  const avg = items.length ? Math.round((items.reduce((a, r) => a + r.stars, 0) / items.length) * 10) / 10 : null;
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{t('nav.ratings')}</h1>
      <p className="mb-4 text-muted">{t('ratings.intro')}</p>
      {avg !== null && <p className="mb-4 font-semibold">{t('ratings.average', { avg, n: items.length })}</p>}
      <ErrorNote error={remove.error} />
      <QueryView q={q}>
        {(list) =>
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
