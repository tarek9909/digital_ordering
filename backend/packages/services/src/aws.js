import { StorageDeleteError } from './storage.js';
// S3-compatible object storage (MinIO on the VPS, or any S3 API) and the optional AWS KMS data key
// (TR-DB-06). Loaded lazily so local development and tests never need the SDK.
export async function createS3Storage(opts) {
    const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const credentials = opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined;
    const client = (endpoint) => new S3Client({ region: opts.region, ...(credentials && { credentials }), ...(endpoint && { endpoint, forcePathStyle: true }) });
    const s3 = client(opts.endpoint);
    const signer = client(opts.publicEndpoint ?? opts.endpoint);
    const bucket = (b) => (b === 'assets' ? opts.assetsBucket : opts.exportsBucket);
    return {
        async put(b, key, body, contentType) {
            await s3.send(new PutObjectCommand({ Bucket: bucket(b), Key: key, Body: body, ContentType: contentType, CacheControl: b === 'assets' ? 'public, max-age=31536000, immutable' : 'no-store' }));
        },
        async get(b, key) {
            try {
                const r = await s3.send(new GetObjectCommand({ Bucket: bucket(b), Key: key }));
                return Buffer.from(await r.Body.transformToByteArray());
            }
            catch {
                return null;
            }
        },
        async signedUrl(b, key, ttlSec) {
            return getSignedUrl(signer, new GetObjectCommand({ Bucket: bucket(b), Key: key }), { expiresIn: ttlSec });
        },
        // M-20: a 200 DeleteObjects response can still carry per-key `Errors`. Only keys the store acknowledges in
        // `Deleted` count; any error or unacknowledged key, or anything still listed afterwards, throws so the caller
        // (tenant purge, export retention) keeps its pointers and retries. Versioned buckets are not purged of old
        // versions here: the deployment's buckets are unversioned (see deploy/), which this adapter relies on.
        async deletePrefix(b, prefix) {
            let deleted = 0;
            const failed = [];
            let token;
            do {
                const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket(b), Prefix: prefix, ContinuationToken: token }));
                const keys = (list.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : []));
                for (let i = 0; i < keys.length; i += 1000) {
                    const chunk = keys.slice(i, i + 1000);
                    const r = await s3.send(new DeleteObjectsCommand({ Bucket: bucket(b), Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: false } }));
                    const acked = new Set((r.Deleted ?? []).flatMap((d) => (d.Key ? [d.Key] : [])));
                    for (const e of r.Errors ?? [])
                        failed.push({ key: e.Key ?? '?', code: e.Code ?? 'Unknown' });
                    const errored = new Set((r.Errors ?? []).map((e) => e.Key));
                    for (const k of chunk) {
                        if (acked.has(k))
                            deleted++;
                        else if (!errored.has(k))
                            failed.push({ key: k, code: 'NotAcknowledged' });
                    }
                }
                token = list.IsTruncated ? list.NextContinuationToken : undefined;
            } while (token);
            if (failed.length === 0) {
                const left = await s3.send(new ListObjectsV2Command({ Bucket: bucket(b), Prefix: prefix, MaxKeys: 1 }));
                if ((left.KeyCount ?? left.Contents?.length ?? 0) > 0)
                    failed.push({ key: left.Contents?.[0]?.Key ?? '?', code: 'StillPresent' });
            }
            if (failed.length)
                throw new StorageDeleteError(b, prefix, deleted, failed);
            return deleted;
        },
    };
}
/**
 * Envelope encryption: the data key is stored encrypted (DATA_KEY_ENC, from `aws kms generate-data-key`) and
 * decrypted once with KMS at start-up; the plaintext key stays in memory only.
 */
export async function kmsKeyProvider(region, encryptedKeyB64) {
    const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
    const kms = new KMSClient({ region });
    let key = null;
    return {
        async dataKey() {
            if (!key) {
                const r = await kms.send(new DecryptCommand({ CiphertextBlob: Buffer.from(encryptedKeyB64, 'base64') }));
                key = Buffer.from(r.Plaintext);
                if (key.length !== 32)
                    throw new Error('KMS data key must be 256 bits');
            }
            return key;
        },
    };
}
