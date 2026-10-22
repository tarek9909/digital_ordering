export * from './crypto.js';
export * from './passwords.js';
export * from './totp.js';
export * from './context.js';
export * from './permissions.js';
/** Session lifetimes (TRD §14.1). */
export const SESSION_TTL = {
    userIdleMs: 7 * 86_400_000,
    userAbsoluteMs: 30 * 86_400_000,
    platformIdleMs: 30 * 60_000,
    platformAbsoluteMs: 12 * 3_600_000,
    deviceSlidingMs: 30 * 86_400_000,
    displaySlidingMs: 365 * 86_400_000,
    handoffMs: 60_000,
    mfaTokenMs: 5 * 60_000,
    verifyEmailMs: 24 * 3_600_000,
    resetPasswordMs: 3_600_000,
    invitationMs: 7 * 86_400_000,
};
/** Cookie names (TRD §14.1). `__Host-` cookies are host-only, Secure, Path=/. */
export const COOKIES = { user: 'sid', platform: 'psid', support: 'sup', device: 'dev', display: 'dsp' };
