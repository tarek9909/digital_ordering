import type { MemberRole, TenantStatus } from '@dop/contracts';

// Which admin sections a user can reach (TRD §14.2). A suspended, expired or cancelled tenant keeps only team, settings (export, deletion) and account (EX-13, EX-14; the API's limitedAccessOk routes).
// A platform support agent inside a support session ("support") gets the venue and reports;
// never team, account or settings (TR-AUTH-10). Integrations and support access are run by the platform team in the
// console, not here.

export type Section = 'home' | 'venues' | 'venue' | 'counters' | 'staff' | 'displays' | 'posters' | 'reports' | 'ratings' | 'team' | 'settings' | 'account';

/** Role of whoever uses the admin app: a member role, or a support agent. */
export type ViewerRole = MemberRole | 'support';

export const LIMITED_STATUSES: readonly TenantStatus[] = ['suspended', 'trial_expired', 'cancelled'];
const LIMITED_SECTIONS: readonly Section[] = ['team', 'settings', 'account'];
const OWNER_ONLY: readonly Section[] = [];
const SUPPORT_HIDDEN: readonly Section[] = ['team', 'account', 'settings'];
const SUPPORT_VIEW: readonly Section[] = [];

export const isLimited = (status: TenantStatus | undefined) => status !== undefined && LIMITED_STATUSES.includes(status);

export function canReach(section: Section, status: TenantStatus | undefined, role: ViewerRole | null): boolean {
  if (role === 'support') {
    if (SUPPORT_HIDDEN.includes(section)) return false;
  } else if (OWNER_ONLY.includes(section) && role !== 'owner') return false;
  if (isLimited(status)) return LIMITED_SECTIONS.includes(section);
  return true;
}

/** Can change things in this section (support agents see billing read-only). */
export function canManage(section: Section, role: ViewerRole | null): boolean {
  if (role === 'support') return !SUPPORT_VIEW.includes(section) && !SUPPORT_HIDDEN.includes(section);
  if (OWNER_ONLY.includes(section)) return role === 'owner';
  return role !== null;
}

/** First section the user may open. */
export function homeSection(status: TenantStatus | undefined, role: ViewerRole | null): Section {
  if (!isLimited(status)) return 'home';
  return 'team';
}

/** Whole days until `iso` (rounded up, never negative). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}
