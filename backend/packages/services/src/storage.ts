import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// Object storage (S3 + CloudFront in AWS; MinIO or a local folder in development). Tenant objects live under
// `tenants/{tenantId}/` and `exports/{tenantId}/` so deletion can remove a whole prefix (TR-PRV-08).

export interface ObjectStorage {
  put(bucket: 'assets' | 'exports', key: string, body: Buffer, contentType: string): Promise<void>;
  get(bucket: 'assets' | 'exports', key: string): Promise<Buffer | null>;
  /** Signed download URL (exports: 15 minutes, TR-PRV-07). */
  signedUrl(bucket: 'assets' | 'exports', key: string, ttlSec: number): Promise<string>;
  /**
   * Deletes every object under the prefix and returns the number of objects the store acknowledged as deleted.
   * Throws (StorageDeleteError or the underlying error) unless every object is confirmed gone, so callers can keep
   * their retry state (M-20). Deleting an empty or missing prefix returns 0.
   */
  deletePrefix(bucket: 'assets' | 'exports', prefix: string): Promise<number>;
}

/** Some objects under a prefix could not be deleted; the caller must retry and must not report erasure done. */
export class StorageDeleteError extends Error {
  constructor(
    readonly bucket: string,
    readonly prefix: string,
    readonly deleted: number,
    readonly failed: ReadonlyArray<{ key: string; code: string }>,
  ) {
    super(`object storage kept ${failed.length} object(s) under ${bucket}:${prefix} (${[...new Set(failed.map((f) => f.code))].join(', ')})`);
    this.name = 'StorageDeleteError';
  }
}

/** Filesystem storage for local development and tests. */
export class LocalStorage implements ObjectStorage {
  constructor(
    private readonly root: string,
    private readonly publicBase: string,
  ) {}

  private path(bucket: string, key: string) {
    const p = resolve(this.root, bucket, key);
    if (!p.startsWith(resolve(this.root, bucket))) throw new Error('invalid key');
    return p;
  }

  async put(bucket: 'assets' | 'exports', key: string, body: Buffer) {
    const p = this.path(bucket, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(bucket: 'assets' | 'exports', key: string) {
    try {
      return await readFile(this.path(bucket, key));
    } catch {
      return null;
    }
  }

  async signedUrl(bucket: 'assets' | 'exports', key: string) {
    return `${this.publicBase}/${bucket}/${key}`;
  }

  /** Same contract as the S3 adapter: a folder prefix or a single object key; throws unless everything is gone (M-20). */
  async deletePrefix(bucket: 'assets' | 'exports', prefix: string) {
    const p = this.path(bucket, prefix);
    let n: number;
    try {
      const s = await stat(p);
      n = s.isDirectory() ? (await readdir(p, { recursive: true, withFileTypes: true })).filter((e) => !e.isDirectory()).length : 1;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw e;
    }
    await rm(p, { recursive: true, force: true });
    try {
      await stat(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return n;
      throw e;
    }
    throw new StorageDeleteError(bucket, prefix, 0, [{ key: prefix, code: 'StillPresent' }]);
  }
}

export const tenantPrefix = (tenantId: string) => join('tenants', tenantId).replace(/\\/g, '/');
