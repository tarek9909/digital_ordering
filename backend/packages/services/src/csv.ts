// Spreadsheet-safe CSV (M-8, OWASP CSV injection). One encoder for every CSV the platform produces (tenant export
// ZIP and the report export), so untrusted text — customer rating comments, receipt references, notes, venue
// names — can never become a live formula when an owner opens the file in a spreadsheet.
//
// Policy:
// - Typed numbers, bigints and booleans are written as-is (they are server-produced and cannot carry a formula).
// - Strings that are a plain numeric literal ("-5", "12.50", MySQL DECIMAL values) are written as-is.
// - Any other string whose first non-blank character is a formula trigger (= + - @, or the full-width forms
//   U+FF1D U+FF0B U+FF0D U+FF20), or which starts with a tab, CR or LF, gets a leading apostrophe. Spreadsheets
//   show the text unchanged; the apostrophe only stops formula interpretation. The original text follows it.
//   "Blank" covers ASCII control characters and spaces, Unicode whitespace (incl. NBSP and ideographic space).
// - Cells containing a quote, comma, CR or LF are quoted, with quotes doubled (RFC 4180).
// - Files are UTF-8 with BOM (CSV_BOM), as before.

export const CSV_BOM = String.fromCharCode(0xfeff);

const NUMERIC = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRIGGERS = new Set(['=', '+', '-', '@', ...[0xff1d, 0xff0b, 0xff0d, 0xff20].map((c) => String.fromCharCode(c))]);
const NEEDS_QUOTES = /[",\r\n]/;

const isBlank = (ch: string) => ch.charCodeAt(0) <= 0x20 || /\s/u.test(ch);

/** Whether a text cell would be read as a formula (or starts with a control character spreadsheets act on). */
export function isFormulaLike(s: string): boolean {
  if (s === '' || NUMERIC.test(s)) return false;
  if (s[0] === '\t' || s[0] === '\r' || s[0] === '\n') return true;
  for (const ch of s) {
    if (isBlank(ch)) continue;
    return TRIGGERS.has(ch);
  }
  return false;
}

/** Encodes one CSV cell. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (isFormulaLike(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Encodes one CSV line (no line terminator). */
export function csvLine(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** A whole CSV document from rows of objects: BOM, header from the first row's keys, LF line endings. */
export function csvDocument(rows: ReadonlyArray<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]!);
  return `${CSV_BOM}${csvLine(cols)}\n${rows.map((r) => csvLine(cols.map((c) => r[c]))).join('\n')}\n`;
}
