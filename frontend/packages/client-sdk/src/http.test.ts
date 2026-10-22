import { afterEach, expect, it, vi } from 'vitest';
import { createApi, withQuery } from './http';

// CSD02: query parameters are combined through one URLSearchParams path, whatever the path already carries.
afterEach(() => vi.unstubAllGlobals());

it('withQuery merges into an existing query string without a second "?"', () => {
  expect(withQuery('/tickets/search?venueId=v1', { q: 'receipt 12&3' })).toBe('/tickets/search?venueId=v1&q=receipt+12%263');
  expect(withQuery('/tickets/search', { q: 'a', skip: undefined, none: null, empty: '' })).toBe('/tickets/search?q=a');
  expect(withQuery('/x?a=1', { a: 2 })).toBe('/x?a=2');
  expect(withQuery('/x', { flag: true, n: 0 })).toBe('/x?flag=true&n=0');
});

it('withQuery leaves a path untouched without a query and drops an all-empty query', () => {
  expect(withQuery('/board?venueId=a%20b')).toBe('/board?venueId=a%20b');
  expect(withQuery('/board', { q: '' })).toBe('/board');
  expect(withQuery('/board?venueId=v', {})).toBe('/board?venueId=v');
});

it('the HTTP client sends a path query and structured query arguments as one valid query string', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const venueId = '123e4567-e89b-12d3-a456-426614174000';
  await createApi({ base: '/api/staff/v1' }).get(`/tickets/search?venueId=${venueId}`, { q: 'receipt123' });
  const sent = String(fetch.mock.calls[0]![0]);
  expect(sent.split('?')).toHaveLength(2);
  const url = new URL(sent, 'http://example.com');
  expect(url.pathname).toBe('/api/staff/v1/tickets/search');
  expect(url.searchParams.get('venueId')).toBe(venueId);
  expect(url.searchParams.get('q')).toBe('receipt123');
});
