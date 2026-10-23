import { useTranslation } from '@dop/i18n';
import { Link } from 'react-router';
import { InnerPage, PageHeader, pillLink } from '../components/PageHeader';

/** A ring that never closed: the brand mark's arc without its ember dot. */
function OpenRing() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-20 text-line">
      <path d="M32 12a20 20 0 1 1-17.32 10" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <InnerPage width="max-w-xl">
      <div className="flex flex-col items-center gap-8 py-10">
        <OpenRing />
        <PageHeader center compact eyebrow="404" title={t('common:notFound')} />
        <Link to="/" className={pillLink.ink}>
          {t('nav.home')}
        </Link>
      </div>
    </InnerPage>
  );
}
