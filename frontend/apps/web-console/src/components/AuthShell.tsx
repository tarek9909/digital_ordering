import { useTranslation } from '@dop/i18n';
import { BrandMark, Button } from '@dop/ui';
import type { ReactNode } from 'react';
import { switchLang } from '../lib/lang';

/** Split screen for sign-in and invitation pages: ink brand panel (wide screens only) and the form. */
export function AuthShell({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const other = i18n.language === 'ar' ? 'en' : 'ar';
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="ember-glow hidden flex-col justify-between gap-10 bg-ink p-12 text-white lg:flex">
        <span className="flex items-center gap-3 font-display text-lg font-bold">
          <BrandMark tone="light" />
          {t('appTitle')}
        </span>
        <div className="flex max-w-lg flex-col gap-6">
          <span className="eyebrow text-[#c9c3bd]">{t('auth.eyebrow')}</span>
          <p className="font-display text-5xl leading-[1.05] font-extrabold tracking-tight text-balance">{t('auth.headline')}</p>
          <ul className="flex flex-col gap-3 text-[#e7e5e4]">
            {(['mfa', 'audit', 'access'] as const).map((k) => (
              <li key={k} className="flex items-center gap-3">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-glow" />
                {t(`auth.points.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <span className="text-sm text-[#a8a29e]">© {new Date().getFullYear()} Tanbeeh</span>
      </aside>

      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-3 font-display font-bold lg:invisible">
            <BrandMark className="size-8" />
            {t('appTitle')}
          </span>
          <Button variant="ghost" lang={other} onClick={() => switchLang(other)}>
            {t('otherLanguage')}
          </Button>
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-10">
          <div className="flex flex-col gap-2">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h1 className="text-3xl font-bold">{title}</h1>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
