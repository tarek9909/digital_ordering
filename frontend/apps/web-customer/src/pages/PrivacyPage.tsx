import { ApiError } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { BackIcon } from '../components/icons';
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
        <p className="mb-8 text-sm text-muted">{t('privacy.versionLine', { version: doc.version, date })}</p>
        <div className="legal" dangerouslySetInnerHTML={{ __html: doc.html! }} />
      </>
    );
  } else if (q.isSuccess || notPublished) {
    body = (
      <div className="legal">
        <p>{t('privacy.body')}</p>
      </div>
    );
  } else if (q.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] bg-danger-bg p-4">
        <p className="font-medium text-danger">{t('privacy.loadError')}</p>
        <Button busy={q.isFetching} onClick={() => void q.refetch()}>
          {t('common:retry')}
        </Button>
      </div>
    );
  } else
    body = (
      <div className="text-muted">
        <Spinner label={t('common:loading')} />
      </div>
    );

  return (
    <main className="mx-auto min-h-dvh max-w-[38rem] bg-surface px-5 pt-6 pb-12">
      {history.length > 1 && (
        <button
          className="-ms-3 mb-6 inline-flex min-h-12 items-center gap-1.5 rounded-control px-3 font-semibold text-ink-2 hover:bg-canvas"
          onClick={() => history.back()}
        >
          <BackIcon className="size-5" />
          {t('common:back')}
        </button>
      )}
      <h1 className="mb-2 font-display text-[2rem] leading-tight font-extrabold tracking-tight">{t('privacy.title')}</h1>
      {body}
    </main>
  );
}
