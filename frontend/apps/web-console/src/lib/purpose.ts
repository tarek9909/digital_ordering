import { AUDIT_PURPOSES, type AuditPurpose } from '@dop/contracts';

// Purpose memory (TR-FE-25, FR-SUP-07): the purpose chosen when opening a tenant is remembered for one hour per
// tenant in sessionStorage and sent as `X-Purpose`.

export const PURPOSE_TTL_MS = 60 * 60 * 1000;
export type PurposeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (tenantId: string) => `dop.console.purpose.${tenantId}`;

function session(): PurposeStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

const isPurpose = (v: unknown): v is AuditPurpose => typeof v === 'string' && (AUDIT_PURPOSES as readonly string[]).includes(v);

export function getPurpose(tenantId: string, storage: PurposeStorage | null = session(), now = Date.now()): AuditPurpose | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(tenantId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { purpose?: unknown; at?: unknown };
    if (!isPurpose(v.purpose) || typeof v.at !== 'number' || now - v.at >= PURPOSE_TTL_MS || v.at > now) {
      storage.removeItem(key(tenantId));
      return null;
    }
    return v.purpose;
  } catch {
    return null;
  }
}

export function rememberPurpose(tenantId: string, purpose: AuditPurpose, storage: PurposeStorage | null = session(), now = Date.now()): void {
  try {
    storage?.setItem(key(tenantId), JSON.stringify({ purpose, at: now }));
  } catch {
    // Storage blocked: the purpose is asked again next time.
  }
}

export function forgetPurpose(tenantId: string, storage: PurposeStorage | null = session()): void {
  try {
    storage?.removeItem(key(tenantId));
  } catch {
    // ignore
  }
}

export const purposeHeaders = (purpose: AuditPurpose) => ({ 'X-Purpose': purpose });
