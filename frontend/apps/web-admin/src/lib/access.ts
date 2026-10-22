import type { MemberRole, TenantStatus } from '@dop/contracts';

// Which admin sections a user can reach (TRD §14.2). A suspended, expired or cancelled tenant keeps only billing,
// team, settings (export, deletion), account and support access (EX-13, EX-14; the API's limitedAccessOk routes).
// A platform support agent inside an approved session ("support") gets the venue, reports and view-only billing
// and integrations; never team, account, settings or the support-access page (TR-AUTH-10).

export type Section =
  | 'home'
  | 'venues'
  | 'venue'
  | 'counters'
  | 'staff'
  | 'displays'
  | 'posters'
  | 'reports'
  | 'ratings'
  | 'team'
  | 'integrations'
  | 'support'
  | 'billing'
  | 'settings'
  | 'account';

/** Role of whoever uses the admin app: a member role, or a support agent. */
export type ViewerRole = MemberRole | 'support';

export const LIMITED_STATUSES: readonly TenantStatus[] = ['suspended', 'trial_expired', 'cancelled'];
const LIMITED_SECTIONS: readonly Section[] = ['billing', 'team', 'settings', 'account', 'support'];
const OWNER_ONLY: readonly Section[] = ['billing', 'integrations'];
const SUPPORT_HIDDEN: readonly Section[] = ['team', 'account', 'settings', 'support'];
/** Read-only for a support agent (billing view, integrations view). */
const SUPPORT_VIEW: readonly Section[] = ['billing', 'integrations'];

export const isLimited = (status: TenantStatus | undefined) => status !== undefined && LIMITED_STATUSES.includes(status);

export function canReach(section: Section, status: TenantStatus | undefined, role: ViewerRole | null): boolean {
  if (role === 'support') {
    if (SUPPORT_HIDDEN.includes(section)) return false;
  } else if (OWNER_ONLY.includes(section) && role !== 'owner') return false;
  if (isLimited(status)) return LIMITED_SECTIONS.includes(section);
  return true;
}

/** Can change things in this section (support agents see billing and integrations read-only). */
export function canManage(section: Section, role: ViewerRole | null): boolean {
  if (role === 'support') return !SUPPORT_VIEW.includes(section) && !SUPPORT_HIDDEN.includes(section);
  if (OWNER_ONLY.includes(section)) return role === 'owner';
  return role !== null;
}

/** First section the user may open. */
export function homeSection(status: TenantStatus | undefined, role: ViewerRole | null): Section {
  if (!isLimited(status)) return 'home';
  return role === 'owner' ? 'billing' : 'team';
}

/** Whole days until `iso` (rounded up, never negative). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}
