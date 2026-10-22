import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

// Hashing and envelope encryption (TR-AUTH-01, TR-DB-06).

/** SHA-256 with the session pepper, lower-case hex (TR-DB-12). Used for tokens, keys and codes. */
export function tokenHash(pepper: string, token: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// argon2id: m = 19 MiB, t = 2, p = 1 (TRD §14.1).
const ARGON = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string) => argon2.hash(plain, ARGON);

export async function verifySecret(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Constant-time dummy verify so unknown accounts take as long as known ones. */
let dummyHash: Promise<string> | null = null;
export async function dummyVerify(plain: string): Promise<void> {
  dummyHash ??= hashSecret('dummy-password-for-timing');
  await verifySecret(await dummyHash, plain);
}

/**
 * Data-key provider. Production fetches and caches a KMS data key (envelope encryption);
 * local and test environments use LOCAL_DATA_KEY.
 */
export interface KeyProvider {
  dataKey(): Promise<Buffer>;
}

export const staticKeyProvider = (base64Key: string): KeyProvider => {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('data key must be 32 bytes');
  return { dataKey: async () => key };
};

/** AES-256-GCM: version byte, 12-byte IV, 16-byte tag, ciphertext. */
export async function encrypt(keys: KeyProvider, plain: string): Promise<Buffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await keys.dataKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ct]);
}

export async function decrypt(keys: KeyProvider, blob: Buffer): Promise<string> {
  if (blob[0] !== 1) throw new Error('unknown ciphertext version');
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', await keys.dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
}
