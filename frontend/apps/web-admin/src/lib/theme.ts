import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'dop.admin.theme';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // storage unavailable
  }
  return null;
}

/** The chosen theme, else the system's. */
export function currentTheme(): Theme {
  return stored() ?? (query().matches ? 'dark' : 'light');
}

export function applyTheme() {
  document.documentElement.dataset.theme = currentTheme();
  listeners.forEach((l) => l());
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable: the choice lasts until reload
    document.documentElement.dataset.theme = theme;
    listeners.forEach((l) => l());
    return;
  }
  applyTheme();
}

// Follow the system until the person chooses.
applyTheme();
query().addEventListener('change', () => {
  if (!stored()) applyTheme();
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'), () => 'light');
}
