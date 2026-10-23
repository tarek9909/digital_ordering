import { useTranslation } from '@dop/i18n';
import { AuthShell as SharedAuthShell, Button } from '@dop/ui';
import type { ReactNode } from 'react';
import { switchLang } from '../lib/lang';

/** The console's sign-in and invitation frame: the shared split screen with the console's own panel copy. */
export function AuthShell({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const other = i18n.language === 'ar' ? 'en' : 'ar';
  return (
    <SharedAuthShell
      appTitle={t('appTitle')}
      panelEyebrow={t('auth.eyebrow')}
      headline={t('auth.headline')}
      points={(['mfa', 'audit', 'access'] as const).map((k) => t(`auth.points.${k}`))}
      title={title}
      eyebrow={eyebrow}
      corner={
        <Button variant="ghost" lang={other} onClick={() => switchLang(other)}>
          {t('otherLanguage')}
        </Button>
      }
    >
      {children}
    </SharedAuthShell>
  );
}
