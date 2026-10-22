import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Card, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import { FormError } from '../components/FormCard';
import { isLegalKind, publicApi, type LegalDocument } from '../lib/api';
import { errorText, isApiError } from '../lib/errors';
import { NotFoundPage } from './NotFoundPage';

/** Readable typography for the sanitised document (headings, paragraphs, lists, links, tables). */
const LEGAL_TYPOGRAPHY = [
  'legal-doc leading-relaxed break-words',
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h1:first-child]:mt-0',
  '[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_h2:first-child]:mt-0',
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold',
  '[&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:font-semibold',
  '[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:ps-6 [&_li]:my-1',
  '[&_a]:font-semibold [&_a]:underline [&_strong]:font-bold [&_em]:italic',
  '[&_blockquote]:my-3 [&_blockquote]:border-s-4 [&_blockquote]:border-line [&_blockquote]:ps-4',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:p-2 [&_th]:border [&_th]:border-line [&_th]:p-2 [&_th]:text-start',
  '[&_hr]:my-6 [&_hr]:border-line',
].join(' ');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/legal/{terms|privacy|dpa}` from GET /api/public/v1/legal/{kind}?locale= (TRD §16.7). With `?document=<id>` it
 * shows that exact published version, as linked from the admin acceptance gate (AS04), whatever the site language.
 */
export function LegalPage() {
  const { t, i18n } = useTranslation();
  const { kind } = useParams();
  const [params] = useSearchParams();
  const raw = params.get('document');
  const document = raw && UUID.test(raw) ? raw : undefined;
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const q = useQuery({
    queryKey: ['legal', kind, locale, document ?? null],
    queryFn: async () => ({ doc: await publicApi.get<LegalDocument>(`/legal/${kind ?? ''}`, document ? { locale, document } : { locale }) }),
    enabled: isLegalKind(kind),
    retry: (n, e) => !isApiError(e, 'NOT_FOUND') && n < 2,
  });
  if (!isLegalKind(kind)) return <NotFoundPage />;
  const title = t(`legal.kinds.${kind}`);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10">
      <h1 className="text-3xl font-bold">{title}</h1>
      {q.isPending && <Spinner label={t('common:loading')} />}
      {q.isError && (isApiError(q.error, 'NOT_FOUND') ? <p className="rounded-lg bg-warn-bg px-3 py-2 text-warn">{t('legal.notPublished')}</p> : <FormError text={errorText(t, q.error)} />)}
      {q.isSuccess && (
        <>
          <p className="text-sm text-muted">
            {t('legal.version', { version: q.data.doc.version })}
            {q.data.doc.publishedAt && ` · ${t('legal.published', { date: formatDateTime(q.data.doc.publishedAt, i18n.language) })}`}
          </p>
          {q.data.doc.html ? (
            // The server sanitises this HTML with a strict allowlist (W12); it is the only HTML injected on the site.
            <Card className="p-6">
              <div className={LEGAL_TYPOGRAPHY} lang={q.data.doc.locale} dangerouslySetInnerHTML={{ __html: q.data.doc.html }} />
            </Card>
          ) : (
            <p>{t('legal.openOriginalHelp')}</p>
          )}
          <a href={q.data.doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center font-semibold underline">
            {t('legal.openOriginal')}
          </a>
        </>
      )}
    </div>
  );
}
