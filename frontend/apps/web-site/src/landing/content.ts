import { overlaySiteCopy, type SiteLanding } from '@dop/contracts';
import { i18next, LANGUAGES } from '@dop/i18n';

// Landing page text set by super admins in the console (setting `site.landing`). Overrides are laid over the
// built-in copy of the `site` namespace with `overlaySiteCopy`, so a stale or odd override can never break a section.

/** Translation subtrees the console may override. */
const ROOTS = ['landing', 'nav'] as const;
const pristine = new Map<string, Record<string, unknown>>();
let applied = '';

/** Lays the console's text over the site copy in every language, and re-renders when it changed. */
export function applySiteCopy(copy: SiteLanding['copy'] | undefined) {
  const key = JSON.stringify(copy ?? null);
  if (key === applied) return;
  applied = key;
  for (const lng of LANGUAGES) {
    const bundle = i18next.getResourceBundle(lng, 'site') as Record<string, unknown> | undefined;
    if (!bundle) continue;
    if (!pristine.has(lng)) pristine.set(lng, Object.fromEntries(ROOTS.map((r) => [r, bundle[r]])));
    const base = pristine.get(lng)!;
    const over = copy?.[lng] as Record<string, unknown> | undefined;
    const next = Object.fromEntries(ROOTS.map((r) => [r, overlaySiteCopy(base[r], over?.[r])]));
    // Not deep: each root is replaced whole, so lists never keep items from the built-in copy.
    i18next.addResourceBundle(lng, 'site', next, false, true);
  }
  // Components using translations re-render on a language change; the language itself stays the same.
  void i18next.changeLanguage(i18next.language);
}
