import { useTranslation } from '@dop/i18n';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="mb-4 text-2xl font-bold">{t('common:notFound')}</h1>
      <Link to="/" className="inline-flex min-h-12 items-center rounded-lg border border-line bg-surface px-4 font-semibold">
        {t('nav.home')}
      </Link>
    </div>
  );
}
