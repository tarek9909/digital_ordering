import type { VenueBranding } from '@dop/contracts';
import { applyBrand } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Card, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from '../lib/router';
import { ClaimForm } from '../components/ClaimForm';
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

  if (venueQ.isError) return <p className="p-6 text-center text-lg">{t('notFoundBody')}</p>;
  if (!venueQ.data) return <Spinner label={t('common:loading')} />;
  const tickets = mineQ.data?.tickets ?? [];
  return (
    <div className="flex min-h-dvh flex-col">
      <VenueHeader venue={venueQ.data.venue} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-bold">{t('venue.yourTickets')}</h1>
        {tickets.length === 0 ? (
          <Card>
            <p className="text-lg font-semibold">{t('venue.noTickets')}</p>
            <p className="text-muted">{t('venue.askStaff')}</p>
          </Card>
        ) : (
          tickets.map((tk) => (
            <Link key={tk.token} to={`/${tk.token}`} className="block">
              <Card className="flex items-center justify-between">
                <span className="num text-4xl font-black">{tk.displayNumber}</span>
                <span className="text-lg">{t(`common:status.${tk.status}`)}</span>
              </Card>
            </Link>
          ))
        )}
        {venueQ.data.claimsMode !== 'off' && (
          <Card>
            <ClaimForm venueCode={venueQ.data.venue.venueCode} mode={venueQ.data.claimsMode} />
          </Card>
        )}
      </main>
      <VenueFooter venue={venueQ.data.venue} />
    </div>
  );
}
