// Host → surface (TRD §5.1). The tenant is resolved from the host slug, never from a request parameter.

export type Surface =
  | { kind: 'customer' }
  | { kind: 'www' }
  | { kind: 'console' }
  | { kind: 'integration' }
  | { kind: 'tenant'; slug: string }
  | { kind: 'unknown' };

export function surfaceOf(host: string, domain: string): Surface {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  if (h === domain || h === `www.${domain}`) return { kind: 'www' };
  if (h === `t.${domain}`) return { kind: 'customer' };
  if (h === `admin.${domain}`) return { kind: 'console' };
  if (h === `api.${domain}`) return { kind: 'integration' };
  if (h.endsWith(`.${domain}`)) {
    const slug = h.slice(0, -(domain.length + 1));
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return { kind: 'tenant', slug };
  }
  return { kind: 'unknown' };
}

/** Host without port, as stored on sessions (sessions are per host, TR-TEN-13). */
export const bareHost = (host: string) => host.toLowerCase().replace(/:\d+$/, '');
