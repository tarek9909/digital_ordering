import { afterEach, expect, it, vi } from 'vitest';
import { createApi } from '../../../frontend/packages/client-sdk/src/http';
import { cardFlags } from '../../../frontend/apps/web-staff/src/lib/ticketState';
afterEach(() => vi.unstubAllGlobals());
it('reproduces malformed owner/manager staff-search query parameters', async () => {
  const venueId = '123e4567-e89b-12d3-a456-426614174000';
  history.replaceState(null, '', '/?venueId=' + venueId);
  const { vq } = await import('../../../frontend/apps/web-staff/src/lib/api');
  const fetch = vi.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await createApi({ base: '/api/staff/v1' }).get(vq('/tickets/search'), { q: 'receipt123' });
  const url = new URL(fetch.mock.calls[0]![0], 'http://example.com');
  expect(url.searchParams.get('q')).toBeNull();
  expect(url.searchParams.get('venueId')).toBe(venueId + '?q=receipt123');
});
it('reproduces the missing overdue call-out state on a fresh staff snapshot', () => {
  const readyAt = Date.parse('2026-10-22T12:00:00Z');
  const ticket = { status: 'ready', readyAt: new Date(readyAt).toISOString(), createdAt: new Date(readyAt).toISOString(), readyRound: 1, autoAlertsSent: 3, acknowledgedAt: null } as any;
  expect(cardFlags(ticket, readyAt + 60 * 60_000).callOut).toBe(false);
  expect(cardFlags(ticket, readyAt + 60 * 60_000, 1).callOut).toBe(true);
});
