import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from './api';
import type { VenueAdmin, VenueListItem } from './types';

// The selected venue. Multi-site tenants (R2, TR-FE-26) get a switcher in the top bar; the choice is remembered in
// localStorage (guarded: private windows and blocked storage simply fall back to the first venue).

export const VENUE_KEY = 'dop.admin.venue';

interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const local = (): KeyValueStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function readStoredVenueId(s: KeyValueStorage | null = local()): string | null {
  try {
    const v = s?.getItem(VENUE_KEY) ?? null;
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeVenueId(id: string, s: KeyValueStorage | null = local()) {
  try {
    s?.setItem(VENUE_KEY, id);
  } catch {
    // storage unavailable
  }
}

/** The chosen venue when it is still active, else the first one. */
export function resolveVenueId(chosen: string | null, list: ReadonlyArray<{ id: string }>): string | null {
  if (chosen && list.some((v) => v.id === chosen)) return chosen;
  return list[0]?.id ?? null;
}

interface VenueStore {
  venueId: string | null;
  setVenueId: (id: string) => void;
}
export const useVenueStore = create<VenueStore>((set) => ({
  venueId: readStoredVenueId(),
  setVenueId: (venueId) => {
    storeVenueId(venueId);
    set({ venueId });
  },
}));

export const venuesKey = ['venues'] as const;
export const venueKey = (id: string) => ['venue', id] as const;

export function useVenues(enabled = true) {
  return useQuery({ queryKey: venuesKey, queryFn: async () => (await api.get<{ items: VenueListItem[] }>('/venues')).items, enabled, staleTime: 5 * 60_000 });
}

/** Current venue id: the chosen one, else the first active venue. */
export function useCurrentVenueId(enabled = true): string | null {
  const chosen = useVenueStore((s) => s.venueId);
  const venues = useVenues(enabled);
  return resolveVenueId(chosen, venues.data ?? []);
}

export function useVenue(id: string | null) {
  return useQuery({ queryKey: venueKey(id ?? ''), queryFn: () => api.get<VenueAdmin>(`/venues/${id}`), enabled: Boolean(id) });
}
