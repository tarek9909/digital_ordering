import { useTranslation } from '@dop/i18n';
import { setLang } from '../lib/lang';

/** Switches between Arabic and English; the choice is remembered on this device. `dark` is for ink surfaces. */
export function LangSwitch({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  const { t, i18n } = useTranslation();
  const next = i18n.language.startsWith('ar') ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={t('common:language')}
      lang={next}
      className={`${className} inline-flex min-h-12 min-w-12 items-center justify-center rounded-control px-4 font-semibold transition-colors ${dark ? 'text-white/85 hover:bg-white/10' : 'text-ink-2 hover:bg-canvas hover:text-ink'}`}
    >
      {next === 'ar' ? 'العربية' : 'English'}
    </button>
  );
}
