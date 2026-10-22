import { expect, it } from 'vitest';
import { agedWait } from './wait';

// A22: the estimate ages from when the projection arrived.
const T0 = 1_000_000;
it('counts down from the projection time', () => {
  expect(agedWait(5, false, T0, T0)).toEqual({ late: false, minutes: 5 });
  expect(agedWait(5, false, T0, T0 + 2 * 60_000 + 1)).toEqual({ late: false, minutes: 3 });
  expect(agedWait(5, false, T0, T0 + 4 * 60_000 + 59_000)).toEqual({ late: false, minutes: 1 });
});
it('turns overdue once the deadline passes, or when the server says so', () => {
  expect(agedWait(5, false, T0, T0 + 5 * 60_000)).toEqual({ late: true, minutes: 0 });
  expect(agedWait(5, false, T0, T0 + 3600_000)?.late).toBe(true);
  expect(agedWait(5, true, T0, T0)?.late).toBe(true);
});
it('shows nothing without an estimate', () => {
  expect(agedWait(null, false, T0, T0)).toBeNull();
});
