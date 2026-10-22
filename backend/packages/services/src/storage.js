import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
/** Some objects under a prefix could not be deleted; the caller must retry and must not report erasure done. */
export class StorageDeleteError extends Error {
    bucket;
    prefix;
    deleted;
    failed;
    constructor(bucket, prefix, deleted, failed) {
        super(`object storage kept ${failed.length} object(s) under ${bucket}:${prefix} (${[...new Set(failed.map((f) => f.code))].join(', ')})`);
        this.bucket = bucket;
        this.prefix = prefix;
        this.deleted = deleted;
        this.failed = failed;
        this.name = 'StorageDeleteError';
    }
}
/** Filesystem storage for local development and tests. */
export class LocalStorage {
    root;
    publicBase;
    constructor(root, publicBase) {
        this.root = root;
        this.publicBase = publicBase;
    }
    path(bucket, key) {
        const p = resolve(this.root, bucket, key);
        if (!p.startsWith(resolve(this.root, bucket)))
            throw new Error('invalid key');
        return p;
    }
    async put(bucket, key, body) {
        const p = this.path(bucket, key);
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, body);
    }
    async get(bucket, key) {
        try {
            return await readFile(this.path(bucket, key));
        }
        catch {
            return null;
        }
    }
    async signedUrl(bucket, key) {
        return `${this.publicBase}/${bucket}/${key}`;
    }
    /** Same contract as the S3 adapter: a folder prefix or a single object key; throws unless everything is gone (M-20). */
    async deletePrefix(bucket, prefix) {
        const p = this.path(bucket, prefix);
        let n;
        try {
            const s = await stat(p);
            n = s.isDirectory() ? (await readdir(p, { recursive: true, withFileTypes: true })).filter((e) => !e.isDirectory()).length : 1;
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return 0;
            throw e;
        }
        await rm(p, { recursive: true, force: true });
        try {
            await stat(p);
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return n;
            throw e;
        }
        throw new StorageDeleteError(bucket, prefix, 0, [{ key: prefix, code: 'StillPresent' }]);
    }
}
export const tenantPrefix = (tenantId) => join('tenants', tenantId).replace(/\\/g, '/');
