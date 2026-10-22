import type { ErrorCode, ProblemDetails } from '@dop/contracts';

// Typed fetch wrapper (TR-FE-03): same-origin `/api/*`, CSRF header, request IDs, problem+json parsing,
// 401 handling. Every app talks to the API only through this.

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK';
  readonly problem: ProblemDetails | null;
  constructor(status: number, code: ErrorCode | 'NETWORK', problem: ProblemDetails | null, message?: string) {
    super(message ?? problem?.detail ?? problem?.title ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.problem = problem;
  }
  /** Field errors for forms (TR-FE-21). */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem?.errors ?? []).map((e) => [e.path, e.message]));
  }
}

export interface ApiClientOptions {
  /** e.g. '/api/staff/v1' */
  base: string;
  onUnauthenticated?: () => void;
  /** Called when the network fails or the server is unreachable (offline bar, TR-FE-15). */
  onNetworkError?: (e: unknown) => void;
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

let csrfToken = '';
/** Set from GET /me or a board snapshot (synchroniser token, TR-AUTH-02). */
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

export type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * Adds query parameters to a path that may already carry some (e.g. `?venueId=`), through one URLSearchParams
 * path so the result never contains a second `?` (CSD02). Empty values are skipped; a key in `query` replaces the
 * same key already in the path. Without `query` the path is returned unchanged.
 */
export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const hashAt = path.indexOf('#');
  const hash = hashAt < 0 ? '' : path.slice(hashAt);
  const noHash = hashAt < 0 ? path : path.slice(0, hashAt);
  const qAt = noHash.indexOf('?');
  const pathname = qAt < 0 ? noHash : noHash.slice(0, qAt);
  const params = new URLSearchParams(qAt < 0 ? '' : noHash.slice(qAt + 1));
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}${hash}`;
}

export function createApi(o: ApiClientOptions) {
  async function call<T>(method: string, path: string, opts: { body?: unknown; query?: Query; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Request-Id': uuid(), ...opts.headers };
    if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    let body: BodyInit | undefined;
    if (opts.raw !== undefined) body = opts.raw;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    } else if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      body = '{}';
    }
    let res: Response;
    try {
      res = await fetch(`${o.base}${withQuery(path, opts.query)}`, { method, headers, body, credentials: 'same-origin' });
    } catch (e) {
      o.onNetworkError?.(e);
      throw new ApiError(0, 'NETWORK', null, 'Network unavailable');
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      const problem = type.includes('json') ? ((await res.json().catch(() => null)) as ProblemDetails | null) : null;
      if (res.status === 401) o.onUnauthenticated?.();
      if (res.status >= 502 && !problem) o.onNetworkError?.(res.status);
      throw new ApiError(res.status, problem?.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR'), problem);
    }
    if (type.includes('json')) return (await res.json()) as T;
    return (await res.blob()) as unknown as T;
  }
  return {
    get: <T>(path: string, query?: Query) => call<T>('GET', path, { query }),
    post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => call<T>('POST', path, { body, headers }),
    put: <T>(path: string, body?: unknown) => call<T>('PUT', path, { body }),
    patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, { body }),
    delete: <T>(path: string, body?: unknown) => call<T>('DELETE', path, { body }),
    upload: <T>(path: string, file: Blob) => call<T>('POST', path, { raw: file, headers: { 'Content-Type': file.type } }),
    call,
  };
}

export type ApiClient = ReturnType<typeof createApi>;
