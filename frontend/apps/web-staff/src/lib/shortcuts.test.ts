import type { StaffTicket } from '@dop/contracts';
import { describe, expect, it } from 'vitest';
import { digitOf, findTyped, reduceKey, type KeyInput } from './shortcuts';

const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  code: k.length === 1 && /[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : '',
  ctrl: false,
  meta: false,
  alt: false,
  inTextField: false,
  dialogOpen: false,
  ...over,
});

/** Feeds keys in order; returns the final buffer and all commands. */
function type(keys: KeyInput[]) {
  let buffer = '';
  const commands = [];
  for (const k of keys) {
    const r = reduceKey(buffer, k);
    buffer = r.buffer;
    if (r.command) commands.push(r.command);
  }
  return { buffer, commands };
}

describe('reduceKey', () => {
  it('digits then Enter marks Ready', () => {
    expect(type([key('2'), key('7'), key('Enter')])).toEqual({ buffer: '', commands: [{ kind: 'ready', number: '27' }] });
  });

  it('digits then C marks Collected, also on an Arabic layout (code KeyC)', () => {
    expect(type([key('1'), key('2'), key('c')]).commands).toEqual([{ kind: 'collected', number: '12' }]);
    expect(type([key('1'), key('ؤ', { code: 'KeyC' })]).commands).toEqual([{ kind: 'collected', number: '1' }]);
  });

  it('accepts Arabic-Indic digits', () => {
    expect(digitOf('٣')).toBe('3');
    expect(type([key('٤'), key('٥'), key('Enter')]).commands).toEqual([{ kind: 'ready', number: '45' }]);
  });

  it('N opens a new ticket and / focuses search, only with an empty buffer', () => {
    expect(reduceKey('', key('n')).command).toEqual({ kind: 'new' });
    expect(reduceKey('', key('/', { code: 'Slash' })).command).toEqual({ kind: 'search' });
    expect(reduceKey('5', key('n')).command).toBeNull();
  });

  it('Backspace edits and Esc clears the buffer; Esc with no buffer is a close command', () => {
    expect(reduceKey('123', key('Backspace')).buffer).toBe('12');
    expect(reduceKey('123', key('Escape'))).toEqual({ buffer: '', command: null, handled: true });
    expect(reduceKey('', key('Escape')).command).toEqual({ kind: 'escape' });
  });

  it('is off while a text field has focus, a dialog is open, or a modifier is held', () => {
    expect(reduceKey('', key('5', { inTextField: true }))).toEqual({ buffer: '', command: null, handled: false });
    expect(reduceKey('12', key('Enter', { dialogOpen: true })).command).toBeNull();
    expect(reduceKey('', key('n', { ctrl: true })).handled).toBe(false);
  });

  it('caps the buffer at 6 digits and ignores Enter with nothing typed', () => {
    expect(type('12345678'.split('').map((d) => key(d))).buffer).toBe('123456');
    expect(reduceKey('', key('Enter')).handled).toBe(false);
  });
});

describe('findTyped', () => {
  const tk = (id: string, displayNumber: string, number: number) => ({ id, displayNumber, number }) as StaffTicket;

  it('matches the display number, then the plain number', () => {
    const open = [tk('a', '27', 27), tk('b', 'B5', 5)];
    expect(findTyped(open, '27')).toBe(open[0]);
    expect(findTyped(open, '5')).toBe(open[1]);
    expect(findTyped(open, '99')).toBeNull();
  });

  it('reports the same number on two counters as ambiguous', () => {
    expect(findTyped([tk('a', 'A5', 5), tk('b', 'B5', 5)], '5')).toBe('ambiguous');
  });
});
