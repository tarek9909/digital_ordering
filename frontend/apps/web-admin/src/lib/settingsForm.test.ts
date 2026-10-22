import { defaultVenueSettings } from '@dop/contracts';
import { describe, expect, it } from 'vitest';
import { canReach, daysUntil, homeSection } from './access';
import { formatDuration } from './format';
import {
  formatNumberList,
  formToMessages,
  formToSettings,
  parseNumberList,
  settingsToForm,
  validateMessagesForm,
  validateSettingsForm,
  type SettingsForm,
} from './settingsForm';

const base = defaultVenueSettings();

describe('number lists', () => {
  it('parses commas, spaces, ranges and Arabic digits', () => {
    expect(parseNumberList('13-19, 42 ٤٤')).toEqual([13, 14, 15, 16, 17, 18, 19, 42, 44]);
    expect(parseNumberList('')).toEqual([]);
  });
  it('marks bad tokens as NaN', () => {
    expect(parseNumberList('5, x').some(Number.isNaN)).toBe(true);
    expect(parseNumberList('9-3').some(Number.isNaN)).toBe(true);
  });
  it('formats runs as ranges', () => {
    expect(formatNumberList([19, 13, 14, 15, 16, 17, 18, 42])).toBe('13-19, 42');
    expect(formatNumberList([1, 2, 7])).toBe('1, 2, 7');
  });
});

describe('settings form ↔ JSON', () => {
  it('round-trips the defaults', () => {
    const form = settingsToForm(base);
    const r = validateSettingsForm(form, base);
    expect(r).toEqual({ ok: true, settings: base });
  });

  it('maps edits to the settings JSON and keeps hidden settings', () => {
    const custom = { ...base, claims: { mode: 'off' as const }, alerts: { ...base.alerts, chime: 'bell' } };
    const form: SettingsForm = {
      ...settingsToForm(custom),
      startStatus: 'received',
      showReceivedColumn: true,
      waitMode: 'off',
      rangeStart: '100',
      rangeEnd: '199',
      skipNumbers: '113-119',
      repeatOffsets: '60, 180',
      maxAutoAlerts: '4',
      checkCode: 'mandatory',
    };
    const s = formToSettings(form, custom);
    expect(s.ticketFlow).toEqual({ startStatus: 'received', showReceivedColumn: true });
    expect(s.wait.mode).toBe('off');
    expect(s.numbering.skipNumbers).toEqual([113, 114, 115, 116, 117, 118, 119]);
    expect(s.alerts).toMatchObject({ repeatOffsetsSec: [60, 180], maxAutoAlerts: 4, chime: 'bell' });
    expect(s.claims.mode).toBe('off');
    expect(validateSettingsForm(form, custom).ok).toBe(true);
  });

  it('reports schema errors on the matching fields', () => {
    const form: SettingsForm = { ...settingsToForm(base), rangeStart: '50', rangeEnd: '10', repeatOffsets: '300, 120', maxAutoAlerts: '9', defaultMinutes: 'abc' };
    const r = validateSettingsForm(form, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['defaultMinutes', 'maxAutoAlerts', 'rangeEnd', 'repeatOffsets']);
  });
});

describe('messages form', () => {
  it('drops empty texts and validates links', () => {
    const f = { ar: { welcome: ' أهلًا ', collection: '', cancelled: '', afterCollection: '', websiteUrl: '' } };
    expect(formToMessages(f)).toEqual({ ar: { welcome: 'أهلًا' } });
    const bad = validateMessagesForm({ en: { ...f.ar, welcome: '', websiteUrl: 'http://x.com' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors)).toEqual(['en.websiteUrl']);
  });
});

describe('access rules', () => {
  it('limits suspended tenants to billing, team, settings and account', () => {
    expect(canReach('reports', 'suspended', 'owner')).toBe(false);
    expect(canReach('billing', 'suspended', 'owner')).toBe(true);
    expect(canReach('billing', 'active', 'manager')).toBe(false);
    expect(homeSection('trial_expired', 'manager')).toBe('team');
    expect(homeSection('active', 'manager')).toBe('home');
  });
  it('counts days and formats durations', () => {
    expect(daysUntil(new Date(Date.UTC(2026, 0, 3)).toISOString(), Date.UTC(2026, 0, 1, 12))).toBe(2);
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(null)).toBe('—');
  });
});
