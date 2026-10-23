import type { PublicTicket } from '@dop/contracts';
import { ApiError, brandTokens } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Skeleton } from '@dop/ui';
import { useQueries } from '@tanstack/react-query';
import { useEffect } from 'react';
import { TicketCard } from '../components/TicketCard';
import { publicApi } from '../lib/api';
import { forgetTicket, markClosed, storedTickets } from '../lib/storage';

const OPEN = new Set(['received', 'preparing', 'ready']);

// All tickets on this phone, each with its own branding (FR-QR-07/08, TRD §16.2 `/tickets`).
export function MyTicketsPage() {
  const { t } = useTranslation();
  const stored = storedTickets().slice().reverse();
  const results = useQueries({
    queries: stored.map((s) => ({ queryKey: ['ticket', s.token], queryFn: () => publicApi.get<PublicTicket>(`/tickets/${s.token}`), retry: false })),
  });
  const tickets = results.map((r) => r.data).filter((x): x is PublicTicket => Boolean(x));
  // Loading, empty, partial failure and unavailable are distinct (CSD08): a failed fetch is never "no orders".
  // A ticket the server no longer knows (404) is genuinely gone; any other error keeps the entry and offers a retry.
  const isGone = (e: unknown) => e instanceof ApiError && e.status === 404;
  const failed = results.filter((r) => r.isError && !r.data && !isGone(r.error));
  const loading = results.some((r) => r.isPending);
  const retrying = failed.some((r) => r.isFetching);
  const retryFailed = () => {
    for (const r of failed) void r.refetch();
  };

  // A ticket seen closed here starts its 24-hour prune clock, even if its own page was never reopened (TR-FE-09);
  // a ticket the server no longer knows is dropped.
  const closedKey = tickets
    .filter((tk) => !OPEN.has(tk.status))
    .map((tk) => tk.token)
    .join(',');
  const goneKey = stored
    .filter((_, i) => isGone(results[i]?.error))
    .map((s) => s.token)
    .join(',');
  useEffect(() => {
    for (const token of closedKey.split(',').filter(Boolean)) markClosed(token);
  }, [closedKey]);
  useEffect(() => {
    for (const token of goneKey.split(',').filter(Boolean)) forgetTicket(token);
  }, [goneKey]);

  // Open orders first; the list keeps the newest-first order within each group.
  const sorted = [...tickets.filter((tk) => OPEN.has(tk.status)), ...tickets.filter((tk) => !OPEN.has(tk.status))];
  return (
    <main className="safe-x mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 bg-canvas pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] md:pt-16">
      <h1 className="font-display text-[1.875rem] leading-tight font-bold tracking-tight">{t('tickets.title')}</h1>
      {failed.length > 0 && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] bg-danger-bg p-4">
          <p className="font-medium text-danger">{t(tickets.length > 0 ? 'tickets.partialFailed' : 'tickets.loadFailed')}</p>
          <Button busy={retrying} variant="secondary" onClick={retryFailed}>
            {t('common:retry')}
          </Button>
        </div>
      )}
      {loading && tickets.length === 0 && failed.length === 0 && (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">{t('common:loading')}</span>
          <Skeleton className="h-21 rounded-[var(--radius-card)]" />
          <Skeleton className="h-21 rounded-[var(--radius-card)]" />
        </div>
      )}
      {!loading && tickets.length === 0 && failed.length === 0 && <EmptyState title={t('tickets.empty')}>{t('tickets.emptyHint')}</EmptyState>}
      {sorted.length > 0 && (
        <div data-motion="stagger" className="flex flex-col gap-3">
          {sorted.map((tk) => {
            const b = brandTokens(tk.venue.brandColor);
            return (
              <TicketCard
                key={tk.token}
                token={tk.token}
                displayNumber={tk.displayNumber}
                status={tk.status}
                venueName={tk.venue.name}
                band={b['--brand-band']}
                onBand={b['--on-band']}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
