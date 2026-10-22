/** Tanbeeh mark: an ember tile with a dot and two signal arcs (an order being called). Decorative. */
export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="36" height="36" rx="11" fill="#c2410c" />
      <circle cx="13" cy="23" r="3.2" fill="#ffffff" />
      <path d="M13 15.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <path d="M13 9a14 14 0 0 1 14 14" fill="none" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
