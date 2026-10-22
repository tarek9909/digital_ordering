import type { PublicTicket } from '@dop/contracts';
import { ApiError, brandTokens } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Spinner } from '@dop/ui';
import { useQueries } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from '../lib/router';
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-bold">{t('tickets.title')}</h1>
      {failed.length > 0 && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-4">
          <p className="text-danger">{t(tickets.length > 0 ? 'tickets.partialFailed' : 'tickets.loadFailed')}</p>
          <Button busy={retrying} onClick={retryFailed}>
            {t('common:retry')}
          </Button>
        </div>
      )}
      {loading && tickets.length === 0 && failed.length === 0 && <Spinner label={t('common:loading')} />}
      {!loading && tickets.length === 0 && failed.length === 0 && <p className="text-muted">{t('tickets.empty')}</p>}
      {tickets.map((tk) => {
        const b = brandTokens(tk.venue.brandColor);
        return (
          <Link key={tk.token} to={`/${tk.token}`}>
            <Card className="flex items-center justify-between overflow-hidden p-0">
              <div className="flex flex-col gap-1 p-4">
                <span className="font-semibold">{tk.venue.name}</span>
                <span className="text-muted">{t(`common:status.${tk.status}`)}</span>
              </div>
              <span className="num self-stretch px-6 py-4 text-4xl font-black" style={{ background: b['--brand-band'], color: b['--on-band'] }}>
                {tk.displayNumber}
              </span>
            </Card>
          </Link>
        );
      })}
    </main>
  );
}
