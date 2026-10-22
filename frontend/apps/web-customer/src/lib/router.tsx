import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

// Minimal history router for the customer app. It has four routes, and React Router v7 alone would use about a
// fifth of the 120 KB initial-route budget (TR-FE-05), so this small matcher replaces it here only.

interface Loc {
  path: string;
  search: URLSearchParams;
}
const LocCtx = createContext<Loc>({ path: '/', search: new URLSearchParams() });
const ParamsCtx = createContext<Record<string, string>>({});

const read = (): Loc => ({ path: location.pathname, search: new URLSearchParams(location.search) });

export function navigate(to: string) {
  history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export interface Route {
  path: string; // '/v/:venueCode', '/:token', '/tickets'
  element: ReactNode;
}

function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Router({ routes }: { routes: Route[] }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  for (const r of routes) {
    const params = match(r.path, loc.path);
    if (params) {
      return (
        <LocCtx.Provider value={loc}>
          <ParamsCtx.Provider value={params}>{r.element}</ParamsCtx.Provider>
        </LocCtx.Provider>
      );
    }
  }
  return null;
}

export const useParams = () => useContext(ParamsCtx);
export const useSearchParams = (): [URLSearchParams] => [useContext(LocCtx).search];

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
