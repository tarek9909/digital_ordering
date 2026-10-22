import type { Connect, Plugin } from 'vite';

// Shared Vite dev-server settings. Every app calls the API same-origin under /api and /rt (TR-API-01); locally
// Vite proxies those to the back end and keeps the Host header so the API can resolve the tenant from it.
// Use hosts like http://t.dop.localhost:5173 or http://burger-house.dop.localhost:5174/staff
// (*.localhost resolves to 127.0.0.1 in browsers). See frontend/README.md.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Production builds emit no source maps (L-21): they would be publicly downloadable next to the bundles. Set
 * DOP_SOURCEMAP=hidden to emit unreferenced maps for an error tracker upload; deploy/web.Dockerfile still deletes
 * them before the image is built.
 */
export const buildSourcemap: boolean | 'hidden' = env.DOP_SOURCEMAP === 'hidden' ? 'hidden' : false;

/**
 * Dev/preview servers listen on loopback only (I-17); *.dop.localhost resolves to loopback, so local flows are
 * unchanged. For testing from a phone or another machine on the LAN, opt in with DOP_DEV_HOST=0.0.0.0 (or a
 * specific interface address).
 */
const devHost = env.DOP_DEV_HOST?.trim() || '127.0.0.1';

export function devProxy(port: number) {
  const target = env.DOP_API ?? 'http://127.0.0.1:4000';
  const rt = env.DOP_RT ?? 'http://127.0.0.1:4001';
  return {
    port,
    strictPort: true,
    host: devHost,
    allowedHosts: ['.dop.localhost', 'localhost'],
    proxy: {
      '/api': { target, changeOrigin: false, xfwd: true },
      '/m/': { target, changeOrigin: false, xfwd: true },
      '/rt': { target: rt, ws: true, changeOrigin: false, xfwd: true },
    },
  };
}

/**
 * Dev and preview only: `/admin` → `/admin/` (likewise /display, /staff). Vite serves an app with a base path only
 * below it, while links from the API (emails, handoff, staff links) use the path without the trailing slash.
 */
export function baseRedirect(base: string): Plugin {
  const bare = base.replace(/\/$/, '');
  const redirect: Connect.NextHandleFunction = (req, res, next) => {
    const [path, query] = ((req as { url?: string }).url ?? '').split('?');
    if (path !== bare) return next();
    res.statusCode = 302;
    res.setHeader('Location', `${base}${query ? `?${query}` : ''}`);
    res.end();
  };
  return {
    name: 'dop-base-redirect',
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}
