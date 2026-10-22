# Storage: H-3 containment, residual risk and migration off the affected MinIO release

**Update (2026-10-22, later): fixed.** The upstream `minio/minio` and `minio/mc` images were withdrawn, so
`deploy/docker-compose.yml` now runs Pigsty's community fork, `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` and
`pgsty/mc:RELEASE.2026-09-16T00-00-00Z`. The fork fixes both advisories from `RELEASE.2026-04-17T00-00-00Z`. Verified
on the server: an unsigned-trailer PUT with only a key ID is rejected, and `minio-init.sh` and the app's
identities behave as before. The Caddy containment below stays as defence in depth. The rest of this page is the
earlier record.

Status (2026-10-22): **contained, not fixed.** The decision is containment now and a storage swap later. This
runbook records what is in place, what risk remains, and a reversible migration plan. Commands run in
`/opt/tanbeeh` on the server. Rehearse the migration on staging first.

## 1. The problem

`deploy/docker-compose.yml` runs `minio/minio:RELEASE.2025-04-22T22-12-26Z`. The maintainer's advisories
[GHSA-hv4r-mvr4-25vw](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw) (unsigned-trailer
streaming upload) and [GHSA-9c4q-hq6p-c237](https://github.com/minio/minio/security/advisories/GHSA-9c4q-hq6p-c237)
(auto-extract upload) let a client that knows a **write-capable access key ID** (not its secret) write objects.
Both are fixed only in AIStor `RELEASE.2026-04-11T03-20-12Z` or later; there is no community fix, and no older or
newer community tag helps. Access key IDs are not secrets: the app's key ID appears in every signed export link
(`X-Amz-Credential`). The advisories do not give unauthorised reads.

## 2. Containment in place

| Control | Where | Effect |
| --- | --- | --- |
| `files.{DOMAIN}` is read-only | `deploy/Caddyfile` (`@files` block, inside `route` so the order holds) | Anything but GET/HEAD gets 405 before reaching MinIO, so internet clients cannot upload, start multipart uploads, call STS or the admin API. |
| Advisory workaround | same | Any request with `X-Amz-Content-Sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER` (any letter case) gets 403. |
| Only object paths | same | Only `/tanbeeh-assets/*` and `/tanbeeh-exports/*` are proxied; `/minio/*` (admin, health, metrics), the service root and bucket listings get 404. |
| Least-privilege identities (M-11, L-30) | `deploy/minio/minio-init.sh` | The app uses `MINIO_APP_*`, limited to object get/put/delete and list on the two buckets; backups use read-only `MINIO_BACKUP_*`. Root is only in `minio`/`minio-init`, and its key ID no longer appears in signed links. |
| Image scanned on every release | `.github/workflows/deploy.yml` | Trivy reports MinIO/mc findings (report-only: the advisories cannot be fixed by a rebuild). |

Still working: anonymous logo GETs, presigned export GETs (Caddy keeps the Host header, so SigV4 signatures match),
and every app write, which goes over the private network to `http://minio:9000`.

Check after each deploy (expect 405, 403, 404 and 200/404 from MinIO):

```bash
D=$(grep ^DOMAIN= .env | cut -d= -f2)
curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data x "https://files.$D/tanbeeh-assets/containment-test"
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Amz-Content-Sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER' "https://files.$D/tanbeeh-assets/x"
curl -s -o /dev/null -w '%{http_code}\n' "https://files.$D/minio/health/live"
curl -s -o /dev/null -w '%{http_code}\n' "https://files.$D/tanbeeh-assets/<a known logo key>"
```

## 3. Residual risk (accepted until migration)

- **Internal-network writers can still use the bypass.** Any process that can reach `minio:9000` on the `internal`
  Docker network (a compromised api/realtime/worker/backup/caddy container, or anything else attached to that
  network) can write objects with nothing but a key ID:
  - with the **app key ID** (public, from export links): write/overwrite objects in `tanbeeh-assets` and
    `tanbeeh-exports` (tenant logos, legal documents, exports at known keys), bypassing app auth and image
    validation;
  - with the **root key ID** (`MINIO_ROOT_USER`, if guessed or leaked): write to any bucket. Use a random,
    non-obvious `MINIO_ROOT_USER` for new installs and never put it in links, logs or tickets.
  A compromised app container already holds the app *secret*, so the extra exposure is mainly from containers that
  should not be able to write at all (caddy, backup) and from the root key ID.
- **Detection:** look for writes that did not come from the app. `docker compose exec minio mc admin trace -v local`
  (with an admin alias) during an investigation; compare object `LastModified` times in `tanbeeh-assets` against
  the app's audit log of logo/legal uploads. The nightly off-site copy (versioned bucket, M-14) keeps earlier
  versions of overwritten files.
- **Optional extra containment:** put `minio`/`minio-init` on a separate `storage` network that only `api`,
  `worker`, `realtime`, `migrate`, `backup` and `caddy` join, so `mysql`/`redis` cannot reach it. This shrinks, not
  removes, the internal attack surface.

Close this risk by migrating (below). Target: before onboarding tenants beyond the pilot.

## 4. Options

| Option | Licence | Notes |
| --- | --- | --- |
| **A. MinIO AIStor** `RELEASE.2026-04-11T03-20-12Z` or later | Commercial (subscription/licence from MinIO; check current terms) | Contains both fixes. Same S3 and `mc admin` APIs, so `minio-init.sh` and the app need no changes. Pay for the licence and track AIStor releases. |
| **B. An Apache-2.0 S3 server** (for example SeaweedFS or RustFS) | Apache-2.0 | No licence fee; check each feature below on staging, because behaviour (IAM policies, anonymous bucket read, lifecycle expiry, SigV4 presign with a custom Host) differs between products. `minio-init.sh` is replaced by that server's provisioning. |
| **C. Managed object storage** (AWS S3, Cloudflare R2, Backblaze B2, …) | Service | Removes self-hosted storage. Check the data-residency answer first (PDPL, BRD OI-04). `S3_ENDPOINT`/`S3_PUBLIC_ENDPOINT`/`CDN_BASE_URL` change; the Caddy `files` block becomes a proxy to the provider or is dropped. |

Whatever you pick, it must support everything the platform uses:

- SigV4 auth with path-style URLs (`forcePathStyle`), region `us-east-1` (or the region the app is configured with);
- `PutObject` with `Content-Type` and `Cache-Control`, `GetObject`, `ListObjectsV2`, `DeleteObjects` (batch);
- presigned GET URLs that verify when requested through `https://files.{DOMAIN}` (Host header preserved);
- anonymous read (download) on `tanbeeh-assets` only; `tanbeeh-exports` private;
- a 7-day expiry on `tanbeeh-exports` (lifecycle rule, or a TTL/cron equivalent);
- per-identity policies: app = object get/put/delete + list on both buckets; backup = read + list on assets;
- a published fix for the two advisories (or not being MinIO-derived), and a security-advisory process.

## 5. Migration plan (reversible)

The old MinIO volume is never modified during the migration, so rollback is always "point back at it".

### 5.1 Prepare (no downtime)

1. Choose the target on staging, run the feature checklist above, and run Trivy on its image.
2. Add the new server to `docker-compose.yml` as a **separate service** (for example `storage-next`) with its own
   volume, on the `internal` network, **not** referenced by Caddy or the app yet. Pin the image by exact version.
3. Provision it: buckets `tanbeeh-assets` (anonymous download) and `tanbeeh-exports` (private, 7-day expiry), and
   the app and backup identities **with the same key IDs and secrets as `MINIO_APP_*` / `MINIO_BACKUP_*`**, so
   `.env` and in-flight signed export links keep working after cutover.

### 5.2 Initial copy and verification (no downtime)

The backup container has rclone and sits on the internal network. Remotes are defined through environment
variables; name-only `-e` passes them in without putting secrets on the command line. Use the old **root** identity
for reading (the backup identity cannot read exports) and the new server's admin identity for writing.

```bash
export RCLONE_CONFIG_OLD_ACCESS_KEY_ID="$(grep '^MINIO_ROOT_USER=' .env | cut -d= -f2-)"
export RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY="$(grep '^MINIO_ROOT_PASSWORD=' .env | cut -d= -f2-)"
export RCLONE_CONFIG_NEW_ACCESS_KEY_ID='<new admin key id>'
read -rs RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY; export RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY
migrate() {
  docker compose run --rm --no-deps --entrypoint sh \
    -e RCLONE_CONFIG_OLD_TYPE=s3 -e RCLONE_CONFIG_OLD_PROVIDER=Minio -e RCLONE_CONFIG_OLD_ENDPOINT=http://minio:9000 \
    -e RCLONE_CONFIG_OLD_ACCESS_KEY_ID -e RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_NEW_TYPE=s3 -e RCLONE_CONFIG_NEW_PROVIDER=Other -e RCLONE_CONFIG_NEW_ENDPOINT=http://storage-next:9000 \
    -e RCLONE_CONFIG_NEW_ACCESS_KEY_ID -e RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY \
    backup -c "$1"
}
# Copy (never sync) with metadata, so Content-Type and Cache-Control survive.
migrate 'rclone copy -M old:tanbeeh-assets  new:tanbeeh-assets  --checkers 8 --transfers 8'
migrate 'rclone copy -M old:tanbeeh-exports new:tanbeeh-exports --checkers 8 --transfers 8'
# Verify: every source object exists on the target with the same size and hash.
migrate 'rclone check old:tanbeeh-assets  new:tanbeeh-assets  --one-way'
migrate 'rclone check old:tanbeeh-exports new:tanbeeh-exports --one-way'
migrate 'rclone size old:tanbeeh-assets; rclone size new:tanbeeh-assets'
```

If `rclone check` reports hash differences only for multipart-uploaded objects (ETags differ by design), re-run
that check with `--download`. Spot-check headers: `curl -sI http://storage-next:9000/tanbeeh-assets/<key>` from a
container on the network should show the same `Content-Type` and `Cache-Control` as the old server.

### 5.3 Cutover (a few minutes of write freeze)

1. Note the time `T` (UTC). Stop writers: `docker compose stop api worker realtime` (Caddy holds requests for 15 s,
   then returns errors; announce a short maintenance window).
2. Delta copy and check again (same `migrate` commands as 5.2; only objects changed since the first copy move).
3. Switch: in `docker-compose.yml`, make the new server answer as `minio` (rename the services, or give
   `storage-next` the network alias `minio` and remove the alias/service from the old one). `S3_ENDPOINT`, Caddy's
   `reverse_proxy minio:9000`, `files.sh` and `.env` stay unchanged. Keep the old service definition commented out
   with its volume (`minio_data`) for rollback; do not run `docker volume rm`.
4. Keep the Caddy `files` restrictions (GET/HEAD, no admin paths) permanently as defence in depth.
5. `docker compose up -d`, then verify: venue logo upload and anonymous logo GET; generate an export and download
   it through its signed link; a tenant erasure (object deletion); `docker compose exec backup files.sh`; the
   containment checks in §2.

### 5.4 Rollback (any time within the retention window)

1. `docker compose stop api worker realtime`.
2. Copy back what was written after `T`: the same `migrate` helper with the remotes swapped,
   `rclone copy -M new:tanbeeh-assets old:tanbeeh-assets --max-age <minutes since T>m` (and exports).
3. Restore the old `minio` service definition (its volume is untouched), `docker compose up -d`, re-run the checks.

### 5.5 Finish

- After 14 days without rollback: take a final off-site copy of the old volume, then remove the old service and
  `minio_data`.
- Update `deploy/docker-compose.yml` comments, `.github/workflows/deploy.yml`'s scan list, `backend/docker-compose.yml`
  (local dev image), `deploy/README.md` §7 and this runbook's status line. Mark H-3 fixed in the security audit only
  after the containment checks and an isolated unsigned-write test against the new server are refused.
- Rotate `MINIO_APP_*` once the old server is gone (signed links older than their TTL are no longer needed).
