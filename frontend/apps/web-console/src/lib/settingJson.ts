// JSON editor helpers for platform settings (appendix 30.4). The server requires the same JSON shape as the
// default (number stays number, array stays array, object stays object); we check that before sending.

export type JsonKind = 'array' | 'object' | 'null' | 'string' | 'number' | 'boolean';

export function jsonKind(v: unknown): JsonKind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const k = typeof v;
  return k === 'string' || k === 'number' || k === 'boolean' ? k : 'object';
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: 'syntax' | 'shape'; expected?: JsonKind; detail?: string };

export function parseSettingJson(text: string, current: unknown): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'syntax', detail: e instanceof Error ? e.message : undefined };
  }
  const expected = jsonKind(current);
  // `null` defaults (e.g. maintenance.until) sit inside objects; at the top level shapes must match.
  if (expected !== 'null' && jsonKind(value) !== expected) return { ok: false, error: 'shape', expected };
  return { ok: true, value };
}

export const prettyJson = (v: unknown) => JSON.stringify(v, null, 2);
