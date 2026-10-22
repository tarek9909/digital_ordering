import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { setLang } from '../lib/lang';

/** Switches between Arabic and English; the choice is remembered on this device. */
export function LangSwitch() {
  const { t, i18n } = useTranslation();
  const next = i18n.language.startsWith('ar') ? 'en' : 'ar';
  return (
    <Button variant="ghost" onClick={() => setLang(next)} aria-label={t('common:language')} lang={next}>
      {next === 'ar' ? 'العربية' : 'English'}
    </Button>
  );
}
