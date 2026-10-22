import { randomBytes, randomInt } from 'node:crypto';

// Tokens and codes (TR-URL-01, TR-URL-02, TR-ALG-07, TR-AUTH-01, TR-INT-03).

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars, no 0/O/1/I/L
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Encodes random bytes as fixed-length base62 (big-endian), left-padded with '0'. */
export function base62(bytes: Buffer, length: number): string {
  let n = BigInt(`0x${bytes.toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = BASE62[Number(n % 62n)]! + out;
    n /= 62n;
  }
  return out.padStart(length, '0').slice(-length);
}

/** 22 chars of base62 from 128 random bits; encodes nothing about tenant, venue, number or time. */
export const newTicketToken = () => base62(randomBytes(16), 22);
/** Browser client ID, same shape as ticket tokens. */
export const newClientId = () => base62(randomBytes(16), 22);
/** Staff link key: 32 base62 chars (~190 bits). */
export const newStaffKey = () => base62(randomBytes(24), 32);
/** API key: pk_live_ / pk_test_ + 32 base62 chars. */
export const newApiKey = (live: boolean) => `${live ? 'pk_live_' : 'pk_test_'}${base62(randomBytes(24), 32)}`;
/** Session / handoff / email tokens: 32 random bytes, base64url. */
export const newSecretToken = () => randomBytes(32).toString('base64url');

export function randomCode(length: number, alphabet = CODE_ALPHABET): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

export const newVenueCode = () => randomCode(6);
export const newPairingCode = () => randomCode(6, '0123456789');
export const newSupportCode = () => randomCode(8, '0123456789');

/** Check and claim codes: 4 chars each, never equal (TR-ALG-07). */
export function newTicketCodes(): { checkCode: string; claimCode: string } {
  const checkCode = randomCode(4);
  let claimCode = randomCode(4);
  while (claimCode === checkCode) claimCode = randomCode(4);
  return { checkCode, claimCode };
}

/** Codes typed by people are compared upper-case (TR-DB-12). */
export const normaliseCode = (s: string) => s.trim().toUpperCase();
