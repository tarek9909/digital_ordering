// Request-log redaction (TR-SEC-10, M-3). Paths and queries that carry bearer secrets are masked before they reach
// any log: ticket and manifest tokens, tenant and platform invitation tokens, and every query value except a short
// list of harmless filters (so an OAuth `code`/`state`, a claim `clientId` or a signed link never appears).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query parameters whose values are never secret and help diagnosis. */
const SAFE_QUERY = new Set(['venueId', 'counterId', 'tenantId', 'tenantIds', 'from', 'to', 'locale', 'limit', 'cursor', 'status', 'size', 'kind', 'chooser', 'name', 'durationMs', 'domain', 'q']);

/** Path segments after these names are credentials (unless they are plain record IDs). */
const SECRET_AFTER = new Set(['tickets', 'invitations', 'platform-invitations', 'm', 'handoff', 'support-handoff']);

const mask = (s: string) => (s.length > 8 ? `${s.slice(0, 4)}…` : '…');

export function redactPath(path: string): string {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!;
    const seg = parts[i]!;
    if (!seg || UUID.test(seg)) continue;
    if (SECRET_AFTER.has(prev)) {
      const ext = /\.[a-z]+$/.exec(seg)?.[0] ?? '';
      parts[i] = `${mask(seg.slice(0, seg.length - ext.length))}${ext}`;
    } else if (seg.length >= 32 && /^[A-Za-z0-9_-]+$/.test(seg)) {
      // Any other long opaque segment is treated as a token.
      parts[i] = mask(seg);
    }
  }
  return parts.join('/');
}

export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  const path = redactPath(q < 0 ? url : url.slice(0, q));
  if (q < 0) return path;
  const params = new URLSearchParams(url.slice(q + 1));
  const out: string[] = [];
  for (const [k, v] of params) out.push(`${encodeURIComponent(k)}=${SAFE_QUERY.has(k) ? encodeURIComponent(v) : '[redacted]'}`);
  return out.length ? `${path}?${out.join('&')}` : path;
}
