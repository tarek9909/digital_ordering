import { useTranslation } from '@dop/i18n';
import { setLanguage } from '../lib/lang';

/** Switches between Arabic and English; the label is written in the other language so it is findable. */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const next = i18n.language === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      lang={next}
      aria-label={t('nav.switchLanguage')}
      className="min-h-11 min-w-11 rounded-full px-3 font-semibold text-ink-2 hover:bg-canvas"
    >
      {next === 'ar' ? 'العربية' : 'English'}
    </button>
  );
}
