import type { TicketStatus } from '@dop/contracts';

// One shape per ticket status, so columns and rows never depend on colour alone. Built on the brand ring:
// a dashed ring (new), a ring that is almost closed (preparing), a closed ring with its dot (ready), a tick
// (collected) and a struck ring (cancelled, closed). Decorative: the status text next to it carries the meaning.

export function StatusGlyph({ status, className = 'size-5' }: { status: TicketStatus; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      {status === 'received' && <circle cx="12" cy="12" r="8.5" {...common} strokeDasharray="3.2 3.4" />}
      {status === 'preparing' && <path d="M12 3.5a8.5 8.5 0 1 1-7.36 4.25" {...common} />}
      {status === 'ready' && (
        <>
          <circle cx="12" cy="12" r="8.5" {...common} />
          <circle cx="12" cy="12" r="3.6" fill="currentColor" />
        </>
      )}
      {status === 'collected' && (
        <>
          <circle cx="12" cy="12" r="8.5" {...common} opacity="0.35" />
          <path d="M8 12.4l2.7 2.7L16.2 9.4" {...common} strokeLinejoin="round" />
        </>
      )}
      {(status === 'cancelled' || status === 'expired') && (
        <>
          <circle cx="12" cy="12" r="8.5" {...common} opacity="0.5" />
          <path d="M6.2 17.8L17.8 6.2" {...common} />
        </>
      )}
    </svg>
  );
}
