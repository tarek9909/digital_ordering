import { useTranslation } from '@dop/i18n';
import { Link } from '../lib/router';
import { ChevronIcon } from './icons';

// One order in a list (venue page, My orders): the number on a tile in the venue's own colour, the venue and the
// status, and a small ring showing how far the order has come.

const STAGE: Record<string, number> = { received: 0.25, preparing: 0.6, ready: 1, collected: 1 };

export function TicketCard({
  token,
  displayNumber,
  status,
  venueName,
  band,
  onBand,
}: {
  token: string;
  displayNumber: string;
  status: string;
  venueName?: string;
  /** The venue's band colour and its text colour; defaults to the page's venue. */
  band?: string;
  onBand?: string;
}) {
  const { t } = useTranslation();
  const p = STAGE[status] ?? 0;
  const ready = status === 'ready';
  const closed = !(status in STAGE) || status === 'collected';
  const colour = band ?? 'var(--brand-band)';
  return (
    <Link
      to={`/${token}`}
      data-flip-id={token}
      className="group flex min-h-20 items-center gap-4 rounded-[var(--radius-card)] bg-surface p-2.5 pe-4 shadow-card transition-transform active:scale-[.99]"
    >
      <span
        className={`num grid h-16 min-w-16 place-items-center rounded-[1rem] px-3 font-display text-3xl font-extrabold tracking-tight ${closed ? 'bg-canvas text-muted' : ''}`}
        style={closed ? undefined : { background: colour, color: onBand ?? 'var(--on-band)' }}
      >
        {displayNumber}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start">
        {venueName && (
          <span dir="auto" className="max-w-full truncate font-semibold">
            {venueName}
          </span>
        )}
        <span className={`inline-flex items-center gap-2 ${venueName ? 'text-sm text-muted' : 'font-semibold'} ${ready ? 'font-bold text-ink' : ''}`}>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 shrink-0">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--color-line)" strokeWidth="3" />
            {p > 0 && (
              <circle
                cx="10"
                cy="10"
                r="7.5"
                fill="none"
                stroke={closed ? 'var(--color-muted)' : colour}
                strokeWidth="3"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={`${p} 1`}
                transform="rotate(-90 10 10)"
              />
            )}
          </svg>
          {t(`common:status.${status}`)}
        </span>
      </span>
      <ChevronIcon className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );
}
