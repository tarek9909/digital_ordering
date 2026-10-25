import { createApi } from '@dop/client-sdk';

// Sign-up site API clients (TRD §12.3, §12.4). Sessions on www are per host (TR-TEN-13).
export const authApi = createApi({ base: '/api/auth/v1' });
export const publicApi = createApi({ base: '/api/public/v1' });

export type SignInResponse = { ok: true } | { mfaRequired: boolean; mfaEnrollmentRequired: boolean; mfaToken: string };

export interface Membership {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  role: 'owner' | 'manager';
}

export interface MeResponse {
  user: { id: string; email: string; name: string; locale: string; emailVerified: boolean; mfaEnrolled: boolean };
  memberships: Membership[];
  csrfToken: string;
}

export interface SlugAvailability {
  available: boolean;
  reason?: 'invalid' | 'reserved' | 'taken';
}

export interface LegalDocument {
  /** The exact published version shown (AS04). */
  id?: string;
  kind: string;
  version: string;
  locale: string;
  url: string;
  publishedAt: string | null;
  /** Server-sanitised HTML (strict allowlist), or null when the document is not HTML (W12). */
  html: string | null;
}

/** GET /plans (W02): public, non-archived plans with active prices. */
export interface PublicPlan {
  code: string;
  name: string;
  description?: string;
  limits: Record<string, unknown> | null;
  features: string[];
  prices: Array<{ period: 'month' | 'quarter' | 'year'; currency: string; amountMinor: number }>;
}

export interface PublicPlansResponse {
  items: PublicPlan[];
  trialDays: unknown;
}

export const LEGAL_KINDS = ['terms', 'privacy', 'dpa', 'customer_privacy'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const isLegalKind = (k: string | undefined): k is LegalKind => (LEGAL_KINDS as readonly string[]).includes(k ?? '');
