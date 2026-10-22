/**
 * Tanbeeh mark, "Almost ready": a ring that has nearly closed, with an ember dot on its leading tip (an order
 * about to be called). `tone="ink"` is the ink tile for white surfaces; `tone="light"` is the white tile for ink
 * surfaces. Geometry matches packages/ui/brand/*.svg. Decorative.
 */
export function BrandMark({ className = 'size-9', tone = 'ink' }: { className?: string; tone?: 'ink' | 'light' }) {
  const ink = tone === 'ink';
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="64" height="64" rx="16" className={ink ? 'fill-ink' : 'fill-surface'} />
      <path d="M32 18a14 14 0 1 1-12.124 7" fill="none" strokeWidth="6" strokeLinecap="round" className={ink ? 'stroke-surface' : 'stroke-ink'} />
      <circle cx="19.876" cy="25" r="5.5" className="fill-primary" />
    </svg>
  );
}
