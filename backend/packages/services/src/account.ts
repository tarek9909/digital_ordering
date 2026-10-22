import type { Actor } from '@dop/auth';
import { safeEqual, tokenHash } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { newSecretToken, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { checkAccountPassword, createUserSession, issueUserMfaChallenge, verifyUserPassword, type ClientInfo, type SignInResult } from './auth.js';
import type { Deps } from './deps.js';
import { slugAvailability } from './tenant-create.js';

// R1.1 account features: slug change (TR-URL-03), user account deletion (FR-ADM-20, TR-PRV-11), Google sign-in.

export const SLUG_REDIRECT_DAYS = 180;

/**
 * Owner only, with password. Every old slug redirects for 180 days and cannot be taken meanwhile, however many
 * renames follow (A16, TR-URL-03). A tenant may take back one of its own old slugs.
 */
export async function changeSlug(deps: Deps, actor: Actor & { kind: 'user' }, tenantId: string, slug: string, password: string) {
  await verifyUserPassword(deps, actor.userId, password);
  const db = deps.db.platform();
  const ownAlias = await db.selectFrom('tenant_slug_aliases').select('slug').where('slug', '=', slug).where('tenant_id', '=', tenantId).where('expires_at', '>', deps.now()).executeTakeFirst();
  if (!ownAlias) {
    const avail = await slugAvailability(deps, slug);
    if (!avail.available) throw new AppError(avail.reason === 'reserved' ? 'SLUG_RESERVED' : avail.reason === 'taken' ? 'SLUG_TAKEN' : 'VALIDATION_FAILED');
  }
  try {
    await db.transaction().execute(async (tx) => {
      const t = await tx.selectFrom('tenants').select(['slug']).where('id', '=', tenantId).forUpdate().executeTakeFirstOrThrow();
      if (t.slug === slug) return;
      const now = deps.now();
      await tx.deleteFrom('tenant_slug_aliases').where('slug', '=', slug).where('tenant_id', '=', tenantId).execute();
      await tx
        .insertInto('tenant_slug_aliases')
        .values({ slug: t.slug, tenant_id: tenantId, created_at: now, expires_at: new Date(now.getTime() + SLUG_REDIRECT_DAYS * 86_400_000) })
        .onDuplicateKeyUpdate({ tenant_id: tenantId, created_at: now, expires_at: new Date(now.getTime() + SLUG_REDIRECT_DAYS * 86_400_000) })
        .execute();
      // previous_slug keeps the latest old slug for display; redirects and reservations use the alias table.
      await tx.updateTable('tenants').set({ slug, previous_slug: null, slug_changed_at: now }).where('id', '=', tenantId).execute();
      await writeAudit(tx, { actor, action: 'tenant.slug_changed', tenantId, entityType: 'tenant', entityId: tenantId, before: { slug: t.slug }, after: { slug } });
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError('SLUG_TAKEN');
    throw e;
  }
  // Ticket and venue links use tokens and venue codes, so printed QR codes keep working (FR-TEN-05).
  return { slug };
}

/** Current slug of the tenant that used `oldSlug` within the last 180 days, else null. */
export async function slugRedirect(deps: Deps, oldSlug: string): Promise<string | null> {
  const t = await deps.db
    .platform()
    .selectFrom('tenant_slug_aliases')
    .innerJoin('tenants', 'tenants.id', 'tenant_slug_aliases.tenant_id')
    .select('tenants.slug')
    .where('tenant_slug_aliases.slug', '=', oldSlug)
    .where('tenant_slug_aliases.expires_at', '>', deps.now())
    .where('tenants.status', '!=', 'deleted')
    .executeTakeFirst();
  return t?.slug ?? null;
}

/** Frees old slugs after the window (run by retention.misc). */
export async function releaseOldSlugs(deps: Deps) {
  const db = deps.db.platform();
  await db.deleteFrom('tenant_slug_aliases').where('expires_at', '<=', deps.now()).execute();
  await db.updateTable('tenants').set({ previous_slug: null }).where('previous_slug', 'is not', null).where('slug_changed_at', '<', new Date(deps.now().getTime() - SLUG_REDIRECT_DAYS * 86_400_000)).execute();
}

/** A user who is not the only owner of any tenant can delete their account (TR-PRV-11). */
export async function deleteOwnAccount(deps: Deps, userId: string, password: string) {
  await verifyUserPassword(deps, userId, password);
  const db = deps.db.platform();
  const owned = await db.selectFrom('tenant_memberships').innerJoin('tenants', 'tenants.id', 'tenant_memberships.tenant_id').select(['tenants.name']).where('tenant_memberships.user_id', '=', userId).where('tenant_memberships.role', '=', 'owner').where('tenant_memberships.status', '=', 'active').where('tenants.status', '!=', 'deleted').execute();
  if (owned.length) throw new AppError('FORBIDDEN', `Transfer ownership of ${owned.map((o) => o.name).join(', ')} first`);
  const u = await db.selectFrom('users').select(['email', 'name']).where('id', '=', userId).executeTakeFirstOrThrow();
  await db.transaction().execute(async (tx) => {
    await tx.deleteFrom('tenant_memberships').where('user_id', '=', userId).execute();
    await tx.deleteFrom('user_sessions').where('user_id', '=', userId).execute();
    await tx.deleteFrom('users').where('id', '=', userId).execute(); // identities and email tokens cascade
  });
  // Names and emails in the audit log become `deleted-user-{id}` (TR-PRV-11).
  const placeholder = `deleted-user-${userId}`;
  for (const col of ['before_data', 'after_data'] as const) {
    const rows = await db.selectFrom('audit_log').select(['id', col]).where('actor_id', '=', userId).execute();
    for (const r of rows) {
      const v = r[col];
      if (!v) continue;
      const replaced = JSON.parse(JSON.stringify(v).split(u.email).join(placeholder).split(u.name).join(placeholder)) as unknown;
      await db.updateTable('audit_log').set({ [col]: JSON.stringify(replaced) }).where('id', '=', r.id).execute();
    }
  }
}

// ---------------------------------------------------------------- Google sign-in (R1.1)

export interface OidcProvider {
  /** Builds the authorization URL for the state, nonce and PKCE challenge. */
  authorizationUrl(p: { state: string; nonce: string; codeVerifier: string; redirectUri: string }): Promise<string>;
  /** Exchanges the callback URL for verified claims. */
  callback(p: { currentUrl: URL; state: string; nonce: string; codeVerifier: string; redirectUri: string }): Promise<{ sub: string; email: string; emailVerified: boolean; name: string }>;
}

export async function createGoogleProvider(clientId: string, clientSecret: string): Promise<OidcProvider> {
  const oidc = await import('openid-client');
  const config = await oidc.discovery(new URL('https://accounts.google.com'), clientId, clientSecret);
  return {
    async authorizationUrl(p) {
      const challenge = await oidc.calculatePKCECodeChallenge(p.codeVerifier);
      return oidc.buildAuthorizationUrl(config, { redirect_uri: p.redirectUri, scope: 'openid email profile', state: p.state, nonce: p.nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    },
    async callback(p) {
      const tokens = await oidc.authorizationCodeGrant(config, p.currentUrl, { pkceCodeVerifier: p.codeVerifier, expectedState: p.state, expectedNonce: p.nonce }, { redirect_uri: p.redirectUri });
      const c = tokens.claims()!;
      return { sub: String(c.sub), email: String(c.email ?? ''), emailVerified: Boolean(c.email_verified), name: String(c.name ?? c.email ?? 'User') };
    },
  };
}

/**
 * State, nonce and PKCE verifier live server-side in the KV store for 10 minutes (§12.4). `binding` is a random
 * value the route also puts in a host-only cookie on www: the callback must come back to the same browser (M-17).
 */
export async function startOidc(deps: Deps, provider: OidcProvider, redirectUri: string, returnHost: string, binding: string) {
  const state = newSecretToken();
  const nonce = newSecretToken();
  const codeVerifier = newSecretToken();
  await deps.kv.set(`oidc:${tokenHash(deps.config.pepper, state)}`, JSON.stringify({ nonce, codeVerifier, returnHost, binding: tokenHash(deps.config.pepper, binding) }), 600);
  return provider.authorizationUrl({ state, nonce, codeVerifier, redirectUri });
}

export type OidcResult = (SignInResult | { kind: 'link_required'; linkToken: string }) & { returnHost: string };

/**
 * Finishes Google sign-in. A Google identity already linked signs in. Otherwise a verified Google email creates a
 * new account, or — when an account with that email exists — links to it only if it has no password. An account
 * with a password must prove it is the caller's (`linkGoogleIdentity`), so someone who registered the address
 * first can never keep access to the real owner's account (M-1).
 */
export async function finishOidc(deps: Deps, provider: OidcProvider, currentUrl: URL, redirectUri: string, client: ClientInfo, binding: string | undefined): Promise<OidcResult> {
  const state = currentUrl.searchParams.get('state') ?? '';
  const raw = await deps.kv.take(`oidc:${tokenHash(deps.config.pepper, state)}`); // single use, atomically
  if (!raw) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  const saved = JSON.parse(raw) as { nonce: string; codeVerifier: string; returnHost: string; binding?: string };
  // The browser that started the sign-in must be the one finishing it (login CSRF, M-17).
  if (!binding || !saved.binding || !safeEqual(tokenHash(deps.config.pepper, binding), saved.binding)) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  const claims = await provider.callback({ currentUrl, state, nonce: saved.nonce, codeVerifier: saved.codeVerifier, redirectUri });
  const db = deps.db.platform();
  let userId = (await db.selectFrom('user_identities').select('user_id').where('provider', '=', 'google').where('subject', '=', claims.sub).executeTakeFirst())?.user_id;
  if (!userId) {
    if (!claims.emailVerified || !claims.email) throw new AppError('UNAUTHENTICATED', 'Google account email is not verified');
    const email = claims.email.toLowerCase();
    const existing = await db.selectFrom('users').select(['id', 'password_hash']).where('email', '=', email).executeTakeFirst();
    if (existing?.password_hash) {
      const linkToken = newSecretToken();
      await deps.kv.set(`oidclink:${tokenHash(deps.config.pepper, linkToken)}`, JSON.stringify({ userId: existing.id, subject: claims.sub }), 600);
      return { kind: 'link_required', linkToken, returnHost: saved.returnHost };
    }
    userId = existing?.id ?? uuidv7();
    if (!existing) await db.insertInto('users').values({ id: userId, email, name: claims.name, email_verified_at: deps.now() }).execute();
    else await db.updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', userId).where('email_verified_at', 'is', null).execute();
    await db.insertInto('user_identities').values({ id: uuidv7(), user_id: userId, provider: 'google', subject: claims.sub }).execute();
  }
  return { ...(await googleSession(deps, userId, client)), returnHost: saved.returnHost };
}

async function googleSession(deps: Deps, userId: string, client: ClientInfo): Promise<SignInResult> {
  const user = await deps.db.platform().selectFrom('users').select(['totp_secret_enc', 'disabled_at']).where('id', '=', userId).executeTakeFirstOrThrow();
  if (user.disabled_at) throw new AppError('UNAUTHENTICATED', 'This account is disabled');
  // An enrolled authenticator applies to every way of signing in, Google included (A03, FR-ADM-18, TR-AUTH-11).
  if (user.totp_secret_enc) return issueUserMfaChallenge(deps, userId, null);
  return createUserSession(deps, userId, null, client, false);
}

/**
 * Links a Google identity to an existing password account once the caller proves that account (M-1). Wrong
 * passwords count towards the sign-in lockout. Someone who does not know the password uses "forgot password",
 * which proves the mailbox and replaces the password, then links.
 */
export async function linkGoogleIdentity(deps: Deps, linkToken: string, password: string, client: ClientInfo): Promise<SignInResult> {
  const k = `oidclink:${tokenHash(deps.config.pepper, linkToken)}`;
  const raw = await deps.kv.get(k);
  if (!raw) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  const p = JSON.parse(raw) as { userId: string; subject: string };
  const db = deps.db.platform();
  const u = await db.selectFrom('users').select(['email', 'password_hash', 'disabled_at']).where('id', '=', p.userId).executeTakeFirstOrThrow();
  await checkAccountPassword(deps, u.email, u.password_hash, password, client.ip);
  if (u.disabled_at) throw new AppError('UNAUTHENTICATED', 'This account is disabled');
  if (!(await deps.kv.take(k))) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  try {
    await db.insertInto('user_identities').values({ id: uuidv7(), user_id: p.userId, provider: 'google', subject: p.subject }).execute();
  } catch (e) {
    if ((e as { code?: string }).code !== 'ER_DUP_ENTRY') throw e;
  }
  // Google has proved the mailbox and the password the account.
  await db.updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', p.userId).where('email_verified_at', 'is', null).execute();
  return googleSession(deps, p.userId, client);
}
