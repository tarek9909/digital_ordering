import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createS3Storage } from '../src/aws.js';
import { LocalStorage, StorageDeleteError } from '../src/storage.js';
function stubS3(objects, opts = {}) {
    const calls = [];
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd) => {
        if (cmd instanceof ListObjectsV2Command) {
            calls.push('list');
            const { Prefix = '', ContinuationToken, MaxKeys } = cmd.input;
            const keys = [...objects.keys()].filter((k) => k.startsWith(Prefix)).sort();
            const start = ContinuationToken ? keys.findIndex((k) => k > ContinuationToken) : 0;
            const size = Math.min(MaxKeys ?? 1000, opts.pageSize ?? 1000);
            const page = start < 0 ? [] : keys.slice(start, start + size);
            const truncated = start >= 0 && start + size < keys.length;
            return { Contents: page.map((Key) => ({ Key })), KeyCount: page.length, IsTruncated: truncated, NextContinuationToken: truncated ? page[page.length - 1] : undefined };
        }
        if (cmd instanceof DeleteObjectsCommand) {
            calls.push('delete');
            const Deleted = [];
            const Errors = [];
            for (const { Key } of cmd.input.Delete.Objects) {
                if (opts.deny?.has(Key))
                    Errors.push({ Key: Key, Code: 'AccessDenied', Message: 'Access Denied' });
                else {
                    objects.delete(Key);
                    if (!opts.omit?.has(Key))
                        Deleted.push({ Key: Key });
                }
            }
            return { Deleted, Errors: Errors.length ? Errors : undefined };
        }
        throw new Error(`unexpected command ${String(cmd)}`);
    });
    return calls;
}
const storage = () => createS3Storage({ region: 'us-east-1', assetsBucket: 'a', exportsBucket: 'e', endpoint: 'http://127.0.0.1:1', accessKeyId: 'k', secretAccessKey: 's', cdnBaseUrl: 'https://cdn' });
afterEach(() => vi.restoreAllMocks());
describe('S3 deletePrefix (M-20)', () => {
    it('throws on a mixed Deleted/Errors response and counts only acknowledged keys', async () => {
        const objects = new Map([['exports/t1/a.zip', true], ['exports/t1/b.zip', true], ['exports/t1/c.zip', true]]);
        stubS3(objects, { deny: new Set(['exports/t1/b.zip']) });
        const s = await storage();
        const err = await s.deletePrefix('exports', 'exports/t1').catch((e) => e);
        expect(err).toBeInstanceOf(StorageDeleteError);
        expect(err.deleted).toBe(2);
        expect(err.failed).toEqual([{ key: 'exports/t1/b.zip', code: 'AccessDenied' }]);
        expect([...objects.keys()]).toEqual(['exports/t1/b.zip']);
    });
    it('treats a key that is neither deleted nor errored as a failure', async () => {
        const objects = new Map([['tenants/t1/logo.png', true]]);
        stubS3(objects, { omit: new Set(['tenants/t1/logo.png']) });
        await expect((await storage()).deletePrefix('assets', 'tenants/t1')).rejects.toMatchObject({ failed: [{ key: 'tenants/t1/logo.png', code: 'NotAcknowledged' }] });
    });
    it('paginates, verifies the prefix is empty and returns the acknowledged count', async () => {
        const objects = new Map(Array.from({ length: 7 }, (_, i) => [`exports/t2/${i}.zip`, true]));
        objects.set('exports/t3/keep.zip', true);
        const calls = stubS3(objects, { pageSize: 3 });
        expect(await (await storage()).deletePrefix('exports', 'exports/t2')).toBe(7);
        expect([...objects.keys()]).toEqual(['exports/t3/keep.zip']);
        expect(calls.filter((c) => c === 'delete')).toHaveLength(3);
        expect(calls[calls.length - 1]).toBe('list'); // final emptiness check
    });
    it('returns 0 for an empty prefix', async () => {
        stubS3(new Map());
        expect(await (await storage()).deletePrefix('assets', 'tenants/none')).toBe(0);
    });
});
describe('LocalStorage deletePrefix (M-20 contract)', () => {
    it('deletes a folder prefix or a single key and counts files', async () => {
        const root = mkdtempSync(join(tmpdir(), 'dop-local-'));
        const s = new LocalStorage(root, 'https://cdn');
        await s.put('exports', 'exports/t1/a.zip', Buffer.from('a'));
        await s.put('exports', 'exports/t1/sub/b.zip', Buffer.from('b'));
        await s.put('exports', 'exports/t2/c.zip', Buffer.from('c'));
        expect(await s.deletePrefix('exports', 'exports/t1')).toBe(2);
        expect(await s.get('exports', 'exports/t1/a.zip')).toBeNull();
        expect(await s.deletePrefix('exports', 'exports/t2/c.zip')).toBe(1);
        expect(await s.get('exports', 'exports/t2/c.zip')).toBeNull();
        expect(await s.deletePrefix('exports', 'exports/missing')).toBe(0);
        await mkdir(join(root, 'assets', 'tenants', 'x'), { recursive: true });
        await writeFile(join(root, 'assets', 'tenants', 'x', 'l.png'), 'l');
        expect(await s.deletePrefix('assets', 'tenants/x')).toBe(1);
    });
});
