import type { KeyProvider } from '@dop/auth';
import type { DbClients } from '@dop/db';
import type { Jobs } from '@dop/jobs';
import type { Logger } from 'pino';
import type { KV } from './kv.js';

// Everything a service needs, passed explicitly so tests can swap any part.

export type LocalApp = 'customer' | 'staff' | 'display' | 'admin' | 'console' | 'www';

export const LOCAL_PORTS: Record<LocalApp, number> = { customer: 5173, staff: 5174, display: 5175, admin: 5176, console: 5177, www: 5178 };

export interface ServiceConfig {
  domain: string;
  appEnv: string;
  pepper: string;
  cdnBaseUrl: string;
  vapidPublicKey: string;
  /** Where links in emails and QR codes point; `https://` in every deployed environment. */
  scheme: 'https' | 'http';
  /** Local development only: each front-end app runs on its own Vite port (frontend/README.md). */
  localPorts?: Partial<Record<LocalApp, number>>;
}

export interface Deps {
  config: ServiceConfig;
  db: DbClients;
  kv: KV;
  jobs: Jobs;
  keys: KeyProvider;
  log: Logger;
  now: () => Date;
}

export function urls(c: ServiceConfig) {
  const base = (host: string, app: LocalApp) => {
    const port = c.localPorts?.[app];
    return `${c.scheme}://${host}${port ? `:${port}` : ''}`;
  };
  return {
    ticket: (token: string) => `${base(`t.${c.domain}`, 'customer')}/${token}`,
    venue: (venueCode: string) => `${base(`t.${c.domain}`, 'customer')}/v/${venueCode}`,
    staff: (slug: string, staffKey: string) => `${base(`${slug}.${c.domain}`, 'staff')}/staff/${staffKey}`,
    admin: (slug: string, path = '') => `${base(`${slug}.${c.domain}`, 'admin')}/admin${path}`,
    www: (path = '') => `${base(`www.${c.domain}`, 'www')}${path}`,
    console: (path = '') => `${base(`admin.${c.domain}`, 'console')}${path}`,
    logo: (key: string | null) => (key ? `${c.cdnBaseUrl}/${key}` : null),
  };
}
