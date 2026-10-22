import { PLATFORM_SETTING_DEFAULTS } from '@dop/contracts';
import { FEATURE_FLAGS, SEED_PLANS, SEED_PRICES, uuidv7 } from '@dop/domain';
import { json, type Db } from './client.js';

// Reference data needed in every environment: plans and prices (seeded by script; shown on the pricing page),
// feature flags, platform settings, launch languages and the default chime. Idempotent.

export async function seedReferenceData(db: Db): Promise<void> {
  for (const f of FEATURE_FLAGS) {
    await db.insertInto('feature_flags').values({ flag_key: f.key, description: f.description }).onDuplicateKeyUpdate({ description: f.description }).execute();
  }
  for (const p of SEED_PLANS) {
    const existing = await db.selectFrom('plans').select('id').where('code', '=', p.code).executeTakeFirst();
    const id = existing?.id ?? uuidv7();
    if (existing) {
      await db.updateTable('plans').set({ name: p.name, is_public: p.isPublic, limits: json(p.limits), features: json(p.features), sort_order: p.sortOrder }).where('id', '=', id).execute();
    } else {
      await db.insertInto('plans').values({ id, code: p.code, name: p.name, is_public: p.isPublic, limits: json(p.limits), features: json(p.features), sort_order: p.sortOrder }).execute();
    }
  }
  const plans = await db.selectFrom('plans').select(['id', 'code']).execute();
  for (const price of SEED_PRICES) {
    const planId = plans.find((p) => p.code === price.plan)!.id;
    // The one-active-price key (plan, period, currency) makes this idempotent.
    await db
      .insertInto('plan_prices')
      .values({ id: uuidv7(), plan_id: planId, period: price.period, currency: price.currency, amount_minor: price.amountMinor })
      .onDuplicateKeyUpdate({ amount_minor: price.amountMinor })
      .execute();
  }
  for (const [key, value] of Object.entries(PLATFORM_SETTING_DEFAULTS)) {
    await db.insertInto('platform_settings').values({ setting_key: key, value: json(value) }).onDuplicateKeyUpdate({ setting_key: key }).execute();
  }
  const languages = [
    { code: 'ar', name: 'العربية', direction: 'rtl' as const, customer_enabled: true, tts_lang: 'ar-SA' },
    { code: 'en', name: 'English', direction: 'ltr' as const, customer_enabled: true, tts_lang: 'en-US' },
  ];
  for (const l of languages) {
    await db.insertInto('languages').values(l).onDuplicateKeyUpdate({ name: l.name }).execute();
  }
  // Built-in chimes are synthesised by the apps (file_key `builtin/…`); uploads add MP3 chimes (FR-SA-12, W11).
  for (const c of [
    { code: 'classic', name: 'Classic', duration_ms: 2000 },
    { code: 'bell', name: 'Bell', duration_ms: 2400 },
    { code: 'soft', name: 'Soft', duration_ms: 1800 },
  ]) {
    await db
      .insertInto('chimes')
      .values({ id: uuidv7(), code: c.code, name: c.name, file_key: `builtin/${c.code}`, duration_ms: c.duration_ms, loudness_lufs: '-14.0' })
      .onDuplicateKeyUpdate({ file_key: `builtin/${c.code}` })
      .execute();
  }
}
