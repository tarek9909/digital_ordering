import { ApiError } from '@dop/client-sdk';
import { describe, expect, it } from 'vitest';
import { activeMember, beforeWrite, isPinRequired, MEMBER_IDLE_MS, memberHeaders, msUntilIdle, touchMember, type MemberSession } from './memberSession';

const T0 = 1_000_000;
const s: MemberSession = { token: 'tok', name: 'Sara', lastUsedAt: T0 };

describe('member session idle handling', () => {
  it('is active for 2 minutes after the last use', () => {
    expect(activeMember(s, T0 + MEMBER_IDLE_MS - 1)).toBe(s);
    expect(activeMember(s, T0 + MEMBER_IDLE_MS)).toBeNull();
    expect(activeMember(null, T0)).toBeNull();
  });

  it('each use extends the window; an expired session cannot be revived', () => {
    const t1 = touchMember(s, T0 + 90_000);
    expect(t1?.lastUsedAt).toBe(T0 + 90_000);
    expect(activeMember(t1, T0 + 200_000)).not.toBeNull();
    expect(touchMember(s, T0 + MEMBER_IDLE_MS + 1)).toBeNull();
  });

  it('reports the time left', () => {
    expect(msUntilIdle(s, T0 + 30_000)).toBe(90_000);
    expect(msUntilIdle(s, T0 + 999_999)).toBe(0);
  });

  it('sends the X-Staff-Member header only while active', () => {
    expect(memberHeaders(s, T0)).toEqual({ 'X-Staff-Member': 'tok' });
    expect(memberHeaders(s, T0 + MEMBER_IDLE_MS)).toBeUndefined();
  });

  it('asks before a write once named staff are known and nobody is signed in', () => {
    expect(beforeWrite(false, null, T0)).toBe('send');
    expect(beforeWrite(true, s, T0)).toBe('send');
    expect(beforeWrite(true, s, T0 + MEMBER_IDLE_MS)).toBe('ask');
  });

  it('recognises the personal-PIN refusal', () => {
    const problem = { type: 'about:blank', title: 'Forbidden', status: 403, code: 'FORBIDDEN' as const, detail: 'Enter your personal PIN' };
    expect(isPinRequired(new ApiError(403, 'FORBIDDEN', problem))).toBe(true);
    expect(isPinRequired(new ApiError(403, 'FORBIDDEN', { ...problem, detail: 'Nope' }))).toBe(false);
    expect(isPinRequired(new Error('Enter your personal PIN'))).toBe(false);
  });
});
