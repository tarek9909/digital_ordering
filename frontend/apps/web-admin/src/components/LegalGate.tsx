import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Modal, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { errorText, isCode } from '../lib/errors';
import { wwwUrl } from '../lib/hosts';
import type { LegalPending } from '../lib/types';
import { Checkbox, textLinkClass } from './common';

export const legalKey = (locale: string) => ['legal-pending', locale] as const;
const docLocale = (lang: string) => (lang === 'en' ? 'en' : 'ar');

/** Typography for the server-sanitised document (headings, paragraphs, lists, links, tables). */
const LEGAL_TYPOGRAPHY = [
  'leading-relaxed break-words text-sm',
  '[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:font-semibold',
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-5 [&_a]:underline',
  '[&_table]:my-2 [&_table]:w-full [&_td]:border [&_td]:border-line [&_td]:p-1 [&_th]:border [&_th]:border-line [&_th]:p-1',
].join(' ');

/**
 * New terms, privacy or DPA versions must be accepted before going on (FR-ADM-16, TR-PRV-09). The dialog cannot be
 * closed. It shows the exact versions (id, locale, content) it records on acceptance (AS04/AS05), and it fails
 * closed: while the check loads, and when it fails, the app stays covered with a retry instead of opening (AS06).
 */
export function LegalGate() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const locale = docLocale(i18n.language);
  const key = legalKey(locale);
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: LegalPending[] }>('/legal/pending', { locale })).items,
    staleTime: Infinity,
    retry: 1,
  });
  const [agreed, setAgreed] = useState(false);
  const [changed, setChanged] = useState(false);
  const accept = useMutation({
    mutationFn: (ids: string[]) => api.post('/legal/accept', { documentIds: ids, locale }),
    onSuccess: () => qc.setQueryData(key, []),
    onError: (e) => {
      // A newer version was published, or the list no longer matches: show the current documents again.
      if (isCode(e, 'VALIDATION_FAILED')) {
        setAgreed(false);
        setChanged(true);
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });

  if (q.isPending) {
    return (
      <Modal open onOpenChange={() => undefined} title={t('legal.checking')}>
        <Spinner label={t('legal.checking')} />
      </Modal>
    );
  }
  if (q.isError) {
    return (
      <Modal open onOpenChange={() => undefined} title={t('legal.checkFailedTitle')} description={t('legal.checkFailed')}>
        <Banner tone="danger">{errorText(t, q.error)}</Banner>
        <div className="mt-3 flex justify-end">
          <Button busy={q.isFetching} onClick={() => void q.refetch()}>
            {t('legal.retry')}
          </Button>
        </div>
      </Modal>
    );
  }
  const items = q.data;
  if (items.length === 0) return null;
  const names = items.map((d) => t(`legal.kinds.${d.kind}`, { defaultValue: d.kind }));
  return (
    <Modal open onOpenChange={() => undefined} title={t('legal.title')} description={t('legal.body')}>
      {changed && <Banner tone="warn">{t('legal.changed')}</Banner>}
      <ul className="mb-4 flex flex-col gap-3">
        {items.map((d) => (
          <li key={d.id} className="rounded-input border border-line p-3.5">
            <h3 className="font-semibold">
              {t(`legal.kinds.${d.kind}`, { defaultValue: d.kind })}{' '}
              <span className="ms-1 text-sm font-normal text-muted" dir="ltr">
                ({d.version})
              </span>
            </h3>
            {d.publishedAt && (
              <p className="text-xs text-muted">
                {t('legal.published', {
                  date: formatDateTime(d.publishedAt, i18n.language),
                })}
              </p>
            )}
            {d.html ? (
              // Sanitised on the server with a strict allow-list (W12), like the public legal page.
              <div
                className={`mt-2 max-h-48 overflow-auto rounded-input border border-line bg-canvas p-3 ${LEGAL_TYPOGRAPHY}`}
                lang={d.locale}
                tabIndex={0}
                aria-label={t(`legal.kinds.${d.kind}`, {
                  defaultValue: d.kind,
                })}
                dangerouslySetInnerHTML={{ __html: d.html }}
              />
            ) : null}
            <a className={textLinkClass} href={wwwUrl(`/legal/${d.kind}?document=${encodeURIComponent(d.id)}`)} target="_blank" rel="noreferrer">
              {t('legal.openVersion')}
            </a>
          </li>
        ))}
      </ul>
      <Checkbox
        label={t('legal.consent', {
          documents: names.join(t('legal.listSeparator')),
        })}
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
      />
      {accept.error && !isCode(accept.error, 'VALIDATION_FAILED') ? <Banner tone="danger">{errorText(t, accept.error)}</Banner> : null}
      <div className="mt-3 flex justify-end">
        <Button busy={accept.isPending} disabled={!agreed || q.isFetching} onClick={() => accept.mutate(items.map((d) => d.id))}>
          {t('legal.accept')}
        </Button>
      </div>
    </Modal>
  );
}
