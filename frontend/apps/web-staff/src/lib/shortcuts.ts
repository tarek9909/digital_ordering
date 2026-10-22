import type { StaffTicket } from '@dop/contracts';

// Keyboard shortcuts on PCs (FR-STF-12, TR-FE-16). Pure: the board hook feeds key presses in and acts on the
// returned command, so the rules can be unit-tested without a DOM.

export const MAX_BUFFER = 6;
/** The typed number is dropped after this long without a key press. */
export const BUFFER_IDLE_MS = 4_000;

export interface KeyInput {
  /** `KeyboardEvent.key` */
  key: string;
  /** `KeyboardEvent.code` (layout-independent: an Arabic keyboard still sends `KeyC` for C). */
  code: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  /** A text field, select or editable element has focus: shortcuts are off. */
  inTextField: boolean;
  /** A dialog is open: it handles its own keys (Esc closes it). */
  dialogOpen: boolean;
}

export type ShortcutCommand =
  | { kind: 'ready'; number: string }
  | { kind: 'collected'; number: string }
  | { kind: 'new' }
  | { kind: 'search' }
  | { kind: 'escape' };

export interface KeyResult {
  buffer: string;
  command: ShortcutCommand | null;
  /** True when the key was used (the caller then calls preventDefault). */
  handled: boolean;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EXT_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** '7' → '7'; Arabic-Indic digits map to ASCII; anything else → null. */
export function digitOf(key: string): string | null {
  if (/^[0-9]$/.test(key)) return key;
  const a = ARABIC_DIGITS.indexOf(key);
  if (a >= 0) return String(a);
  const e = EXT_ARABIC_DIGITS.indexOf(key);
  return e >= 0 ? String(e) : null;
}

const ignore = (buffer: string): KeyResult => ({ buffer, command: null, handled: false });

export function reduceKey(buffer: string, k: KeyInput): KeyResult {
  if (k.inTextField || k.dialogOpen || k.ctrl || k.meta || k.alt) return ignore(buffer);

  const digit = digitOf(k.key);
  if (digit !== null) return { buffer: (buffer + digit).slice(0, MAX_BUFFER), command: null, handled: true };

  if (k.key === 'Backspace') return buffer ? { buffer: buffer.slice(0, -1), command: null, handled: true } : ignore(buffer);
  if (k.key === 'Escape') return buffer ? { buffer: '', command: null, handled: true } : { buffer: '', command: { kind: 'escape' }, handled: false };

  if (buffer) {
    if (k.key === 'Enter') return { buffer: '', command: { kind: 'ready', number: buffer }, handled: true };
    if (k.code === 'KeyC' || k.key === 'c' || k.key === 'C') return { buffer: '', command: { kind: 'collected', number: buffer }, handled: true };
    return ignore(buffer);
  }

  if (k.code === 'KeyN' || k.key === 'n' || k.key === 'N') return { buffer: '', command: { kind: 'new' }, handled: true };
  if (k.key === '/' || k.code === 'Slash') return { buffer: '', command: { kind: 'search' }, handled: true };
  return ignore(buffer);
}

/**
 * The open ticket the typed number means: an exact display number ("27", or "A27" typed as digits only when it is
 * the only ticket with that number). Several tickets with the same number on different counters → 'ambiguous'.
 */
export function findTyped(open: readonly StaffTicket[], typed: string): StaffTicket | 'ambiguous' | null {
  const exact = open.filter((t) => t.displayNumber === typed);
  if (exact.length === 1) return exact[0]!;
  const n = Number(typed);
  const byNumber = open.filter((t) => t.number === n);
  if (byNumber.length === 1) return byNumber[0]!;
  return byNumber.length > 1 || exact.length > 1 ? 'ambiguous' : null;
}

/** True when the focused element takes text, so typing must not trigger shortcuts. */
export function isTextTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}
