import { ApiError } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../lib/api';

// Customer privacy notice (NFR-PRV-01, FR-QR-09, W12): the platform-published notice in the page language, with its
// version and date. Without a published notice (404 or no HTML) the built-in translation is shown.

export interface LegalDocument {
  kind: string;
  version: string;
  locale: string;
  publishedAt: string;
  url: string | null;
  /** Sanitised by the server with a strict allowlist; the only HTML this app renders. */
  html: string | null;
}

export function PrivacyPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const q = useQuery({
    queryKey: ['legal', 'customer_privacy', locale],
    queryFn: () => publicApi.get<LegalDocument>('/legal/customer_privacy', { locale }),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    staleTime: 10 * 60_000,
  });
  const notPublished = q.error instanceof ApiError && q.error.status === 404;
  const doc = q.data?.html ? q.data : null;

  let body;
  if (doc) {
    const date = Number.isNaN(Date.parse(doc.publishedAt)) ? doc.publishedAt : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(doc.publishedAt));
    body = (
      <>
        <p className="mb-4 text-sm text-muted">{t('privacy.versionLine', { version: doc.version, date })}</p>
        <div className="legal text-lg leading-relaxed [&_a]:underline [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ms-6 [&_li]:list-disc [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: doc.html! }} />
      </>
    );
  } else if (q.isSuccess || notPublished) {
    body = <p className="text-lg leading-relaxed">{t('privacy.body')}</p>;
  } else if (q.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p>{t('privacy.loadError')}</p>
        <Button busy={q.isFetching} onClick={() => void q.refetch()}>
          {t('common:retry')}
        </Button>
      </div>
    );
  } else body = <Spinner label={t('common:loading')} />;

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">{t('privacy.title')}</h1>
      {body}
    </main>
  );
}
