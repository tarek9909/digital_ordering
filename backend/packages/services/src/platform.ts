import { AppError, PLATFORM_SETTING_DEFAULTS, type PlanLimits, type PlatformSettingKey } from '@dop/contracts';
import { isFeatureEnabled, type LimitKey } from '@dop/domain';
import type { Deps } from './deps.js';
import { keys } from './kv.js';

// Platform settings (appendix 30.4), plan limits and feature flags (TR-ALG-15).

type SettingValue<K extends PlatformSettingKey> = (typeof PLATFORM_SETTING_DEFAULTS)[K];

const settingCache = new Map<string, { v: unknown; at: number }>();
const SETTING_TTL_MS = 30_000;

export async function getSetting<K extends PlatformSettingKey>(deps: Pick<Deps, 'db' | 'now'>, key: K): Promise<SettingValue<K>> {
  const hit = settingCache.get(key);
  const now = deps.now().getTime();
  if (hit && now - hit.at < SETTING_TTL_MS) return hit.v as SettingValue<K>;
  const row = await deps.db.platform().selectFrom('platform_settings').select('value').where('setting_key', '=', key).executeTakeFirst();
  const v = (row?.value ?? PLATFORM_SETTING_DEFAULTS[key]) as SettingValue<K>;
  settingCache.set(key, { v, at: now });
  return v;
}

export const clearSettingCache = () => settingCache.clear();

export interface TenantPlan {
  planId: string;
  planCode: string;
  limits: PlanLimits;
  features: string[];
}

export async function tenantPlan(deps: Pick<Deps, 'db'>, tenantId: string): Promise<TenantPlan> {
  const row = await deps.db
    .platform()
    .selectFrom('tenants')
    .innerJoin('plans', 'plans.id', 'tenants.plan_id')
    .select(['plans.id', 'plans.code', 'plans.limits', 'plans.features'])
    .where('tenants.id', '=', tenantId)
    .executeTakeFirstOrThrow();
  return { planId: row.id, planCode: row.code, limits: row.limits as unknown as PlanLimits, features: row.features as unknown as string[] };
}

/** isEnabled(tenant, flag) with a 60 s per-tenant cache (TR-ALG-15). */
export async function isEnabled(deps: Pick<Deps, 'db' | 'kv'>, tenantId: string, flag: string): Promise<boolean> {
  const cached = await deps.kv.get(keys.tenantFlags(tenantId));
  let flags: Record<string, boolean>;
  if (cached) flags = JSON.parse(cached) as Record<string, boolean>;
  else {
    const db = deps.db.platform();
    const [plan, overrides, all] = await Promise.all([
      tenantPlan(deps, tenantId),
      db.selectFrom('tenant_feature_overrides').select(['flag_key', 'enabled']).where('tenant_id', '=', tenantId).execute(),
      db.selectFrom('feature_flags').select(['flag_key', 'default_on']).execute(),
    ]);
    const ov = new Map(overrides.map((o) => [o.flag_key, Boolean(o.enabled)]));
    flags = Object.fromEntries(all.map((f) => [f.flag_key, isFeatureEnabled(ov.get(f.flag_key), plan.features, f.flag_key, Boolean(f.default_on))]));
    await deps.kv.set(keys.tenantFlags(tenantId), JSON.stringify(flags), 60);
  }
  return flags[flag] ?? false;
}

export async function requireFeature(deps: Pick<Deps, 'db' | 'kv'>, tenantId: string, flag: string): Promise<void> {
  if (!(await isEnabled(deps, tenantId, flag))) throw new AppError('FEATURE_NOT_IN_PLAN', `"${flag}" is not part of your plan`);
}

/** Checked on create; exceeding returns 403 PLAN_LIMIT (TR-ALG-15). */
export async function requireWithinLimit(deps: Pick<Deps, 'db'>, tenantId: string, key: LimitKey, currentCount: number): Promise<void> {
  const { limits } = await tenantPlan(deps, tenantId);
  if (currentCount >= limits[key]) throw new AppError('PLAN_LIMIT', `Your plan allows ${limits[key]} (${key})`, { data: { limit: key, allowed: limits[key] } });
}
