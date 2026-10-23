// Helpers for editing the website's landing text (setting `site.landing`). The built-in text is the site's own
// translation files, loaded on demand; the setting stores only what differs from it.

export type CopyTree = Record<string, unknown>;
export type CopyLangs = { ar: CopyTree; en: CopyTree };

/** Translation subtrees the console edits (the site lays the same ones over its copy). */
export const COPY_ROOTS = ['landing', 'nav'] as const;

/** Set in their own forms on the Website page (`site.pricing`), so not repeated in the text editor. */
export const EDITED_ELSEWHERE = new Set(['landing.pricing.title', 'landing.pricing.includedItems', 'landing.pricing.chains']);

export const isObject = (v: unknown): v is CopyTree => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The site's built-in landing and menu text in both languages. */
export async function loadSiteCopy(): Promise<CopyLangs> {
  const [ar, en] = await Promise.all([import('@dop/i18n/locales/ar/site.json'), import('@dop/i18n/locales/en/site.json')]);
  const pick = (m: CopyTree): CopyTree => Object.fromEntries(COPY_ROOTS.map((r) => [r, m[r]]));
  return { ar: pick(ar.default as CopyTree), en: pick(en.default as CopyTree) };
}

export const getIn = (tree: unknown, path: (string | number)[]): unknown => path.reduce<unknown>((v, k) => (v == null ? undefined : (v as Record<string | number, unknown>)[k]), tree);

export function setIn<T>(tree: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [k, ...rest] = path;
  const copy = (Array.isArray(tree) ? [...tree] : { ...(tree as object) }) as Record<string | number, unknown>;
  copy[k!] = setIn(copy[k!], rest, value);
  return copy as T;
}

const isBlank = (v: unknown): boolean => (typeof v === 'string' ? !v.trim() : isObject(v) ? Object.values(v).every(isBlank) : false);

/** What the draft changes from the built-in text: changed texts, and whole lists that differ. Blank texts are left out. */
export function diffCopy(base: unknown, draft: unknown): unknown {
  if (typeof base === 'string') return typeof draft === 'string' && draft.trim() && draft !== base ? draft : undefined;
  if (Array.isArray(base)) {
    // Items left entirely blank are dropped rather than shown empty on the site.
    const kept = Array.isArray(draft) ? draft.filter((x) => !isBlank(x)) : base;
    return JSON.stringify(base) === JSON.stringify(kept) ? undefined : kept;
  }
  if (isObject(base) && isObject(draft)) {
    const out = Object.fromEntries(
      Object.keys(base)
        .map((k) => [k, diffCopy(base[k], draft[k])] as const)
        .filter(([, v]) => v !== undefined),
    );
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** `{{number}}` style placeholders the site fills in. */
export const placeholders = (s: string) => [...new Set(s.match(/\{\{\s*\w+\s*\}\}/g) ?? [])];

/** Texts that dropped a placeholder of the built-in text, as paths. */
export function missingPlaceholders(base: unknown, draft: unknown, path: (string | number)[] = []): string[] {
  if (typeof base === 'string') return typeof draft === 'string' && draft.trim() && placeholders(base).some((p) => !draft.includes(p)) ? [path.join('.')] : [];
  if (isObject(base)) return Object.keys(base).flatMap((k) => missingPlaceholders(base[k], getIn(draft, [k]), [...path, k]));
  return [];
}

/** `phoneWait` → `Phone wait`. */
export const humanize = (key: string) => {
  const s = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
