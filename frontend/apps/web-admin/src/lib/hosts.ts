/** URL on the sign-up site: the admin runs on {slug}.{domain}, the site on www.{domain}. */
export function wwwUrl(path: string, loc: { protocol: string; hostname: string; port: string } = window.location): string {
  const parts = loc.hostname.split('.');
  const domain = parts.length > 2 ? parts.slice(1).join('.') : loc.hostname;
  return `${loc.protocol}//www.${domain}${loc.port ? `:${loc.port}` : ''}${path}`;
}
