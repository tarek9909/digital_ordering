// Small inline icons (no icon font, works offline). Decorative: the text label next to each icon carries meaning.

const PATHS = {
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 17h2',
  pageOpen: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  pageClosed: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
  none: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM5 5l14 14',
  check: 'M4 12l5 5L20 6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-15v5l3 3',
  warning: 'M12 3l10 18H2L12 3zm0 6v5m0 3v.5',
  megaphone: 'M3 10v4h4l7 5V5L7 10H3zm15-2a5 5 0 0 1 0 8',
  menu: 'M12 5v.5M12 12v.5M12 19v.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm10 3l-5-5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 3',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z',
  device: 'M4 5h16v11H4zM9 20h6M12 16v4',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  sound: 'M3 10v4h4l5 4V6L7 10H3zm13-1a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12',
  backspace: 'M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7zm3 4l6 6m0-6l-6 6',
  arrowBack: 'M15 6l-6 6 6 6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
