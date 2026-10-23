import { ApiError } from '@dop/client-sdk';
import { defaultVenueSettings, displaySettingsSchema } from '@dop/contracts';
import { describe, expect, it } from 'vitest';
import { canManage, canReach } from './access';
import { pickMessage, readDismissed, visibleAnnouncements, writeDismissed } from './announcements';
import { excessFromError, excessLines } from './billing';
import { displayToForm, formToDisplayPatch, validateDisplayForm } from './displayForm';
import { activeHours, csvQuery, delta, heatLevel, heatmapMax, heatmapRows, hourLabel, reportQuery } from './reports';
import { formToSettings, settingsToForm, validateSettingsForm } from './settingsForm';
import { isSupportMode, setSupportMode } from './support';
import { readStoredVenueId, resolveVenueId, storeVenueId, VENUE_KEY } from './venue';

/** In-memory Storage stand-in; `broken` throws like a blocked storage. */
function memory(broken = false) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (broken) throw new Error('blocked');
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error('blocked');
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

const problem = (code: string, data?: unknown) => new ApiError(409, code as never, { type: 'about:blank', title: code, status: 409, code: code as never, data });

describe('plan downgrade excess', () => {
  it('reads problem.data.excess and formats lines', () => {
    const e = problem('PLAN_DOWNGRADE_BLOCKED', {
      excess: [
        { limit: 'maxCountersPerVenue', current: 5, allowed: 1 },
        { limit: 'maxVenues', current: 3, allowed: 1 },
        { limit: 'somethingNew', current: 2, allowed: 1 },
        { bad: true },
      ],
    });
    expect(excessLines(excessFromError(e))).toEqual([
      { key: 'billing.excess.maxCountersPerVenue', current: 5, allowed: 1, count: 4 },
      { key: 'billing.excess.maxVenues', current: 3, allowed: 1, count: 2 },
      { key: 'billing.excess.other', current: 2, allowed: 1, count: 1 },
    ]);
  });
  it('ignores other errors and malformed data', () => {
    expect(excessFromError(problem('PLAN_LIMIT', { excess: [] }))).toEqual([]);
    expect(excessFromError(problem('PLAN_DOWNGRADE_BLOCKED', { excess: 'x' }))).toEqual([]);
    expect(excessFromError(new Error('x'))).toEqual([]);
    expect(excessLines([{ limit: 'maxVenues', current: 1, allowed: 1 }])).toEqual([]);
  });
});

describe('heatmap', () => {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  grid[0]![12] = 10; // Sunday noon
  grid[5]![20] = 4; // Friday 20:00
  grid[6]![12] = 2; // Saturday noon

  it('orders rows Saturday first with totals', () => {
    const rows = heatmapRows(grid);
    expect(rows.map((r) => r.weekday)).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({ weekday: 6, total: 2 });
    expect(rows[1]!.cells[12]).toBe(10);
    expect(rows.every((r) => r.cells.length === 24)).toBe(true);
  });
  it('keeps only hours with tickets for the table fallback', () => {
    expect(activeHours(heatmapRows(grid))).toEqual([12, 20]);
    expect(hourLabel(7)).toBe('07:00');
  });
  it('tolerates short or missing rows', () => {
    const rows = heatmapRows([[1, 2]]);
    expect(rows.find((r) => r.weekday === 0)!.total).toBe(3);
    expect(rows.find((r) => r.weekday === 3)!.total).toBe(0);
  });
  it('maps values to 0–5 levels', () => {
    const max = heatmapMax(heatmapRows(grid));
    expect(max).toBe(10);
    expect(heatLevel(0, max)).toBe(0);
    expect(heatLevel(1, max)).toBe(1);
    expect(heatLevel(10, max)).toBe(5);
    expect(heatLevel(5, 0)).toBe(0);
  });
});

describe('trends and report filters', () => {
  it('computes deltas', () => {
    expect(delta(12, 10)).toEqual({ diff: 2, direction: 'up' });
    expect(delta(4.2, 4.5)).toEqual({ diff: -0.3, direction: 'down' });
    expect(delta(5, 5)).toEqual({ diff: 0, direction: 'same' });
    expect(delta(null, 5).direction).toBe('none');
  });
  it('omits venueId for all venues and counters without a venue', () => {
    expect(reportQuery({ venueId: 'all', counterId: 'c1', from: '2026-01-01', to: '2026-01-07' })).toEqual({ from: '2026-01-01', to: '2026-01-07' });
    expect(reportQuery({ venueId: 'v1', counterId: 'c1', from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b', venueId: 'v1', counterId: 'c1' });
    expect(csvQuery({ venueId: '', counterId: '', from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b', venueId: 'all' });
    // W03: the counter filter reaches the export, as it does the on-screen report.
    expect(csvQuery({ venueId: 'v1', counterId: 'c1', from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b', venueId: 'v1', counterId: 'c1' });
    expect(csvQuery({ venueId: 'all', counterId: 'c1', from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b', venueId: 'all' });
  });
});

describe('display form', () => {
  const base = displaySettingsSchema.parse({});
  const item = { name: 'TV 1', counterIds: null, settings: base };

  it('maps defaults and back without changes', () => {
    const f = displayToForm(item, ['ar', 'en']);
    expect(f).toMatchObject({ allCounters: true, languages: ['ar'], quietHours: [], promoEnabled: false, promoText: { ar: '', en: '' } });
    const r = validateDisplayForm(f, base);
    expect(r.ok && r.body).toEqual({ name: 'TV 1', counterIds: null, settings: base });
  });
  it('maps counters, quiet hours and promo', () => {
    const f = { ...displayToForm(item, ['ar', 'en']), allCounters: false, counterIds: ['0190c3a0-0000-7000-8000-000000000001'], languages: ['ar', 'en'], quietHours: [{ from: '23:00', to: '06:00' }], promoEnabled: true, promoText: { ar: ' عرض ', en: '' }, promoImageUrl: '' };
    const body = formToDisplayPatch(f, base);
    expect(body.counterIds).toEqual(['0190c3a0-0000-7000-8000-000000000001']);
    expect(body.settings.announce).toEqual({ enabled: true, languages: ['ar', 'en'], quietHours: [{ from: '23:00', to: '06:00' }] });
    expect(body.settings.promo).toEqual({ text: { ar: 'عرض' }, imageUrl: null });
    expect(validateDisplayForm(f, base).ok).toBe(true);
    // Round trip keeps the promo and quiet hours.
    expect(displayToForm({ name: 'TV 1', counterIds: body.counterIds, settings: body.settings }, ['ar'])).toMatchObject({ promoEnabled: true, promoText: { ar: 'عرض' }, quietHours: [{ from: '23:00', to: '06:00' }] });
  });
  it('flags invalid input on the matching fields', () => {
    const f = { ...displayToForm(item, ['ar']), languages: ['ar', 'en', 'fr'], quietHours: [{ from: '10:00', to: '10:00' }], promoEnabled: true, promoImageUrl: 'http://x.com/a.png' };
    const r = validateDisplayForm(f, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['languages', 'promoImageUrl', 'quietHours']);
  });
});

describe('venue switcher persistence', () => {
  const id = '0190c3a0-0000-7000-8000-00000000000a';
  it('stores and reads a venue id', () => {
    const s = memory();
    storeVenueId(id, s);
    expect(s.m.get(VENUE_KEY)).toBe(id);
    expect(readStoredVenueId(s)).toBe(id);
  });
  it('ignores junk and blocked storage', () => {
    const s = memory();
    s.setItem(VENUE_KEY, 'not-a-uuid');
    expect(readStoredVenueId(s)).toBeNull();
    expect(readStoredVenueId(memory(true))).toBeNull();
    expect(() => storeVenueId(id, memory(true))).not.toThrow();
    expect(readStoredVenueId(null)).toBeNull();
  });
  it('falls back to the first venue when the stored one is gone', () => {
    expect(resolveVenueId(id, [{ id: 'a' }, { id }])).toBe(id);
    expect(resolveVenueId(id, [{ id: 'a' }])).toBe('a');
    expect(resolveVenueId(null, [])).toBeNull();
  });
});

describe('announcements', () => {
  it('picks the UI language, then English, then Arabic', () => {
    expect(pickMessage({ ar: 'مرحبا', en: 'Hello' }, 'ar')).toBe('مرحبا');
    expect(pickMessage({ ar: 'مرحبا', en: 'Hello' }, 'fr')).toBe('Hello');
    expect(pickMessage({ ar: 'مرحبا' }, 'en')).toBe('مرحبا');
  });
  it('remembers dismissals per session; critical ones stay', () => {
    const s = memory();
    writeDismissed(['a', 'a', 'c'], s);
    expect(readDismissed(s)).toEqual(['a', 'c']);
    const items = [
      { id: 'a', message: {}, severity: 'info' as const },
      { id: 'b', message: {}, severity: 'warning' as const },
      { id: 'c', message: {}, severity: 'critical' as const },
    ];
    expect(visibleAnnouncements(items, readDismissed(s)).map((a) => a.id)).toEqual(['b', 'c']);
    expect(readDismissed(memory(true))).toEqual([]);
  });
});

describe('roles', () => {
  it('owner-only billing; support sees billing read-only and never team', () => {
    expect(canReach('billing', 'active', 'manager')).toBe(false);
    expect(canReach('billing', 'active', 'owner')).toBe(true);
    expect(canReach('billing', 'active', 'support')).toBe(true);
    expect(canManage('billing', 'support')).toBe(false);
    expect(canManage('venue', 'support')).toBe(true);
    expect(canReach('team', 'active', 'support')).toBe(false);
    expect(canReach('team', 'suspended', 'manager')).toBe(true);
  });
  it('support mode flag survives blocked storage', () => {
    const s = memory();
    setSupportMode(true, s);
    expect(isSupportMode(s)).toBe(true);
    setSupportMode(false, s);
    expect(isSupportMode(s)).toBe(false);
    expect(isSupportMode(memory(true))).toBe(false);
  });
});

describe('ticket flow settings (R1.1/R2)', () => {
  const base = defaultVenueSettings();
  it('maps claims, prefixes, review link, powered-by, API sound and calculated wait', () => {
    const f = { ...settingsToForm(base), waitMode: 'auto' as const, claimsMode: 'staff_approval' as const, prefixesEnabled: true, reviewLinkUrl: ' https://g.page/r/x ', showPoweredBy: false, soundOnApiTicket: true };
    const s = formToSettings(f, base);
    expect(s.wait.mode).toBe('auto');
    expect(s.claims.mode).toBe('staff_approval');
    expect(s.numbering.prefixesEnabled).toBe(true);
    expect(s.customer).toEqual({ showPoweredBy: false, reviewLinkUrl: 'https://g.page/r/x' });
    expect(s.staff.soundOnApiTicket).toBe(true);
    expect(validateSettingsForm(f, base).ok).toBe(true);
  });
  it('rejects a non-https review link on its field', () => {
    const r = validateSettingsForm({ ...settingsToForm(base), reviewLinkUrl: 'http://x.com' }, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(['reviewLinkUrl']);
  });
});
