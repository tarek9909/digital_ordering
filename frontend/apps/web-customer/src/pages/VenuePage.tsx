import type { VenueBranding } from '@dop/contracts';
import { ApiError, applyBrand } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Skeleton, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from '../lib/router';
import { ClaimForm } from '../components/ClaimForm';
import { OrderRing } from '../components/OrderRing';
import { TicketCard } from '../components/TicketCard';
import { VenueFooter, VenueHeader } from '../components/VenueChrome';
import { publicApi } from '../lib/api';
import { applyVenueLanguage } from '../lib/lang';
import { clientId, storedTickets } from '../lib/storage';

// Venue page (FR-QR-04/05, EX-17): the venue QR never creates a ticket (BR-13); it shows this phone's open
// tickets here, or asks the customer to get a ticket from staff. Claims arrive in R1.1 (FR-QR-06).
export function VenuePage() {
  const { venueCode = '' } = useParams();
  const { t } = useTranslation();
  const venueQ = useQuery({
    queryKey: ['venue', venueCode],
    queryFn: () => publicApi.get<{ venue: VenueBranding; tenantStatus: string; claimsMode: 'off' | 'code' | 'staff_approval' }>(`/venues/${venueCode}`),
  });
  const mineQ = useQuery({
    queryKey: ['venue-mine', venueCode],
    enabled: venueQ.isSuccess,
    queryFn: () =>
      publicApi.post<{ tickets: Array<{ token: string; displayNumber: string; status: string }> }>(`/venues/${venueCode}/my-tickets`, {
        clientId: clientId(),
        tokens: storedTickets().map((s) => s.token),
      }),
  });
  useEffect(() => {
    if (!venueQ.data) return;
    applyVenueLanguage(venueQ.data.venue.locales);
    applyBrand(document.documentElement, venueQ.data.venue.brandColor);
  }, [venueQ.data]);

  // Only a 404 means the venue link is gone; a server or network failure says so and offers a retry (CSD08).
  if (venueQ.isError && !venueQ.data) {
    if (venueQ.error instanceof ApiError && venueQ.error.status === 404)
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
          <OrderRing token="" progress={0} idle className="w-28" />
          <p className="max-w-xs text-lg text-ink-2">{t('notFoundBody')}</p>
        </main>
      );
    return (
      <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <p className="max-w-xs text-lg text-ink-2">{t('venue.loadFailed')}</p>
        <Button size="lg" className="w-full max-w-sm" busy={venueQ.isFetching} onClick={() => void venueQ.refetch()}>
          {t('common:retry')}
        </Button>
      </main>
    );
  }
  if (!venueQ.data)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas text-muted">
        <Spinner label={t('common:loading')} />
      </main>
    );
  const tickets = mineQ.data?.tickets ?? [];
  const mineFailed = mineQ.isError;
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <VenueHeader venue={venueQ.data.venue} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-8 pb-6">
        <h1 className="font-display text-[1.875rem] leading-tight font-bold tracking-tight">{t('venue.yourTickets')}</h1>
        {mineFailed && (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] bg-danger-bg p-4">
            <p className="font-medium text-danger">{t('venue.ticketsFailed')}</p>
            <Button variant="secondary" busy={mineQ.isFetching} onClick={() => void mineQ.refetch()}>
              {t('common:retry')}
            </Button>
          </div>
        )}
        {mineQ.isPending && !mineFailed && (
          <div role="status">
            <span className="sr-only">{t('common:loading')}</span>
            <Skeleton className="h-21 rounded-[var(--radius-card)]" />
          </div>
        )}
        {mineQ.isSuccess && tickets.length === 0 && (
          // No order yet: the ring waits, open, for the ticket the staff will hand over.
          <div className="flex items-center gap-4 rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
            <OrderRing token="" progress={0.08} className="w-16 shrink-0" />
            <div className="min-w-0">
              <p className="font-display text-lg leading-snug font-bold">{t('venue.noTickets')}</p>
              <p className="mt-1 text-ink-2">{t('venue.askStaff')}</p>
            </div>
          </div>
        )}
        {tickets.length > 0 && (
          <div data-motion="stagger" className="flex flex-col gap-3">
            {tickets.map((tk) => (
              <TicketCard key={tk.token} token={tk.token} displayNumber={tk.displayNumber} status={tk.status} />
            ))}
          </div>
        )}
        {venueQ.data.claimsMode !== 'off' && (
          <section className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <ClaimForm venueCode={venueQ.data.venue.venueCode} mode={venueQ.data.claimsMode} />
          </section>
        )}
      </main>
      <VenueFooter venue={venueQ.data.venue} />
    </div>
  );
}
