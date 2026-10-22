import { authenticator } from 'otplib';
// TOTP for tenant users (optional) and platform users (mandatory) (TR-AUTH-11, FR-SA-02).
authenticator.options = { window: 1, step: 30, digits: 6 };
export const newTotpSecret = () => authenticator.generateSecret(20);
export const totpUri = (secret, account, issuer) => authenticator.keyuri(account, issuer, secret);
export const verifyTotp = (secret, code) => authenticator.check(code, secret);
/**
 * The 30-second time step the code belongs to, or null when it is wrong. Callers keep the last accepted step so a
 * code can be used once (L-1, RFC 6238 §5.2).
 */
export function totpStepOf(secret, code, nowMs = Date.now()) {
    if (!/^\d{6}$/.test(code))
        return null;
    const delta = authenticator.clone({ epoch: nowMs }).checkDelta(code, secret);
    return delta === null ? null : Math.floor(nowMs / 30_000) + delta;
}
/** `stepOffset` (−1 / +1, inside the accepted window) gives tests a second, unused code within the same 30 s. */
export const currentTotp = (secret, stepOffset = 0) => authenticator.clone({ epoch: Date.now() + stepOffset * 30_000 }).generate(secret);
