// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

// CSD02: an owner/manager board (`?venueId=`) searching by number or receipt sends one valid query string with
// both `venueId` and `q`, through the real `vq` and the real SDK HTTP wrapper.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  sessionStorage.clear();
});

it('owner/manager staff search sends venueId and q together', async () => {
  const venueId = '123e4567-e89b-12d3-a456-426614174000';
  history.replaceState(null, '', '/?venueId=' + venueId);
  vi.resetModules();
  const { api, vq } = await import('./api');
  const fetch = vi.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await api.get(vq('/tickets/search'), { q: 'receipt 123' });
  const sent = String(fetch.mock.calls[0]![0]);
  expect(sent.match(/\?/g)).toHaveLength(1);
  const url = new URL(sent, 'http://example.com');
  expect(url.pathname).toBe('/api/staff/v1/tickets/search');
  expect(url.searchParams.get('venueId')).toBe(venueId);
  expect(url.searchParams.get('q')).toBe('receipt 123');
});

it('a device board without a venue query sends only q', async () => {
  history.replaceState(null, '', '/');
  vi.resetModules();
  const { api, vq } = await import('./api');
  const fetch = vi.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await api.get(vq('/tickets/search'), { q: '42' });
  expect(String(fetch.mock.calls[0]![0])).toBe('/api/staff/v1/tickets/search?q=42');
});
