# Deploying Tanbeeh on your own VPS

Everything runs with Docker Compose on one server. Caddy is the only public service (ports 80 and 443).
The private `internal` network has the fixed subnet `172.30.0.0/24` and Caddy the fixed address `172.30.0.10`; the
API trusts `X-Forwarded-For` only from that address (`TRUST_PROXY`, M-7), and Caddy itself trusts no forwarding
headers from the internet. If that subnet clashes with something on your host, change both in `docker-compose.yml`.

```text
Internet ─▶ Caddy (TLS for every host, serves the 6 apps, routes /api and /rt)
              ├─▶ api       :4000   Express API (all /api surfaces, /v1, webhooks)
              ├─▶ realtime  :4001   Socket.IO
              └─▶ minio     :9000   files.{domain}: logos, signed export links (GET/HEAD only)
            worker   BullMQ jobs + scheduler (alerts, emails, billing, retention, reports)
            mysql    8.4 with binary logs     redis 7 (cache, presence, queues)
            backup   nightly dump + binlogs every 5 min + files → off-site (rclone)
```

## 1. Server

- **Size:** for the pilot (5–10 venues), 4 vCPU, 8 GB RAM and 80 GB SSD is comfortable. For about 100 busy venues, use 8 vCPU and 16 GB, and give MySQL more memory in `mysql/my.cnf`. Beyond that, move MySQL to its own server.
- **Location:** check with counsel which countries may hold customer data under PDPL (BRD OI-04, Implementation Plan check 0.4) before you pick the provider and region.
- **OS:** Ubuntu 24.04 or Debian 12. As root, run `scripts/server-setup.sh`. It installs Docker, opens only ports 22, 80 and 443, turns on automatic security updates and creates a `deploy` user.

## 2. DNS

Point `DOMAIN` and `*.DOMAIN` at the server with A records, plus AAAA if the server has IPv6. Caddy gets a certificate for each host the first time it is visited, and only after the API confirms the host is a platform host or an existing tenant (`/internal/tls-allowed`).

> Let's Encrypt allows 50 new certificates per week per registered domain. That is enough for the pilot and steady growth. If you will onboard many tenants at once, switch to a wildcard certificate: build Caddy with your DNS provider's plugin and use `tls { dns <provider> … }`.

## 3. First start

```bash
cd /opt/tanbeeh                     # contents of this deploy/ folder
cp .env.example .env && nano .env   # domain, passwords, SMTP, VAPID keys
./scripts/init-secrets.sh           # creates secrets/data_key and prints random passwords and MinIO keys
cp backup/rclone.conf.example backup/rclone.conf && nano backup/rclone.conf
docker compose build                # or set REGISTRY/IMAGE_TAG and `docker compose pull`
docker compose run --rm migrate     # schema + plans, flags, settings, languages
docker compose up -d
docker compose logs -f api worker
```

Create the first super admin, then sign in at `https://admin.DOMAIN` and set up the authenticator app:

```bash
docker compose run --rm -e SERVICE_ROLE=create-admin -e ADMIN_EMAIL=you@example.com   -e ADMIN_NAME="Your Name" -e ADMIN_PASSWORD='a-long-unique-passphrase' api
```

Further platform users are invited from the console. Restaurants sign up at `https://www.DOMAIN`, or you create them from the console.

**Back up `secrets/data_key` and `.env` separately and safely.** Without the data key, the encrypted staff links and two-factor secrets cannot be read.

Credentials, by design (M-11, L-27, L-30): the app containers get only `MINIO_APP_*` (object read/write/delete and
listing on `tanbeeh-assets` and `tanbeeh-exports`, no administration) and the Redis password. `MINIO_ROOT_*` is used
only by `minio` and the one-shot `minio-init`, which creates the buckets, the app identity and the read-only
`MINIO_BACKUP_*` identity on every `docker compose up`. `MYSQL_ROOT_PASSWORD` is used only by `mysql`, `migrate` and
`backup`, and the backup tools read it from a 0600 option file rather than a command-line argument (L-29).

### Upgrading an existing install to this hardening (2026-10)

Releases stop at `docker compose config` until `.env` has the new values, so nothing restarts half-configured.

1. Run `./scripts/init-secrets.sh` (it keeps the existing data key) and add to `.env` only the values you do not
   have yet: `REDIS_PASSWORD`, `MINIO_APP_ACCESS_KEY`, `MINIO_APP_SECRET_KEY`, `MINIO_BACKUP_ACCESS_KEY`,
   `MINIO_BACKUP_SECRET_KEY` and `BACKUP_PRUNE_ON_VPS=false`. Keep `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (letters
   and digits only, as init-secrets prints). Then rotate `MINIO_ROOT_PASSWORD` when convenient: the old app
   containers held it, and its access key appeared in every signed export link.
2. Add the `VPS_HOST_FINGERPRINT` secret (§4) and release as usual, or by hand:
   `docker compose pull && docker compose up -d minio && docker compose run --rm minio-init && docker compose run --rm migrate && docker compose up -d --remove-orphans`.
   The `internal` network now has a fixed subnet; if Compose reports that the existing `tanbeeh_internal` network
   differs, run `docker compose down` (volumes are kept) and `docker compose up -d` again.
3. Check: `docker compose logs minio-init` ends with "users are in place"; a venue logo upload and an export
   download work; `docker compose exec redis redis-cli ping` answers PONG (the container supplies the password);
   `curl -X PUT https://files.DOMAIN/tanbeeh-assets/x` returns 405.
4. Whenever you change a MinIO key in `.env`, run `docker compose run --rm minio-init`, then `docker compose up -d`
   so the app and backup containers pick it up.

## 4. Releases

GitHub Actions → **deploy** → Run workflow. It builds the images, copies this folder to `/opt/tanbeeh`, runs migrations, then restarts the services.

Before the first release, set up the `production` environment (Settings → Environments):

- **Required reviewers** (someone other than the person starting the run, with "Prevent self-review") and
  **Deployment branches and tags** limited to `main` and release tags, so `workflow_dispatch` cannot ship any ref.
- **Environment secrets** `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `GHCR_READ_TOKEN` and **`VPS_HOST_FINGERPRINT`**
  (M-21). The release refuses to run without the fingerprint, and the SSH/SCP steps abort on a mismatch, so a
  network attacker cannot impersonate the server. Obtain it **out of band**, never from a first network connection:
  open the provider's web/serial console (or read the end of `scripts/server-setup.sh`'s output) and run
  `for k in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$k"; done`. The value is the second field:
  `SHA256:` followed by 43 characters. The deploy actions use Go's SSH client, which prefers the **ECDSA** host key
  when the server has one (stock Ubuntu/Debian do), so use the ECDSA line; if the deploy reports a fingerprint
  mismatch, use the Ed25519 line instead. Update the secret whenever the server is rebuilt or its host keys change.

To deploy by hand:

```bash
export REGISTRY=ghcr.io/<you>/tanbeeh IMAGE_TAG=<tag>
docker compose pull && docker compose run --rm migrate && docker compose up -d
```

To roll back, run the same commands with the previous `IMAGE_TAG`. Migrations are backward compatible (expand, then contract, TR-DB-07).

## 5. Backups and restore

- **Dumps:** a consistent daily dump at 00:15 UTC, plus binary logs every 5 minutes, so at most 5 minutes of data can be lost. Uploaded files are copied nightly with a read-only MinIO identity (`rclone copy`, so a file deleted on the server is never deleted off-site). Everything is encrypted by rclone (`crypt`) before it goes to `BACKUP_REMOTE`. Keep the two crypt passphrases off the server, next to the data key.
- **The server can add backups but not destroy them (M-14).** A compromised VPS holds the backup key, so that key must be upload-only and the bucket must enforce retention itself. Use a bucket with **versioning and object lock** (retention at least `BACKUP_RETENTION_DAYS`) and a key that can list/read/write but **not delete**; `backup/rclone.conf.example` lists the permissions per provider and a test. Keep `BACKUP_PRUNE_ON_VPS=false` (the default), so the server never runs `rclone delete`.
- **Pruning** runs from a separate trusted machine (an admin workstation or another server) with its own delete-capable key and its own `rclone.conf` (same crypt passphrases), for example monthly:

  ```bash
  rclone delete offsite:tanbeeh/dumps/   --min-age 30d
  rclone delete offsite:tanbeeh/binlogs/ --min-age 30d
  # files/ holds the current uploads: expire only noncurrent versions there, with a provider lifecycle rule.
  ```

  With object lock the provider refuses deletions until retention expires. A bucket lifecycle rule ("delete objects older than N days") is an alternative that needs no deletion key anywhere.
- **Restore** to a point in time: `./scripts/restore.sh tanbeeh-YYYYMMDDTHHMMSSZ.sql.gz "2026-10-22 12:00:00"`. It only reads from the remote, so the upload-only key is enough.
- **Restore uploaded files.** The backup identity is read-only, so use the MinIO root identity for this one-off:

  ```bash
  # Name-only -e passes the values from this shell, so the secret is not on the docker command line.
  export RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="$(grep '^MINIO_ROOT_USER=' .env | cut -d= -f2-)"
  export RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="$(grep '^MINIO_ROOT_PASSWORD=' .env | cut -d= -f2-)"
  docker compose run --rm --entrypoint sh \
    -e RCLONE_CONFIG_MINIO_TYPE=s3 -e RCLONE_CONFIG_MINIO_PROVIDER=Minio -e RCLONE_CONFIG_MINIO_ENDPOINT=http://minio:9000 \
    -e RCLONE_CONFIG_MINIO_ACCESS_KEY_ID -e RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY \
    backup -c 'rclone copy "$BACKUP_REMOTE/files/tanbeeh-assets" minio:tanbeeh-assets'
  unset RCLONE_CONFIG_MINIO_ACCESS_KEY_ID RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY
  ```
- **Rehearse a restore** on a spare server before the pilot, and record the timings in `docs/runbooks/README.md` (Phase 5 gate).

## 6. Monitoring

- Use an external uptime monitor on `https://api.DOMAIN/readyz` and on a tenant board URL every minute, for example Better Stack, UptimeRobot or Uptime Kuma on another machine.
- Follow the logs with `docker compose logs`. Lines with `"security":true` are security events (TR-SEC-14), and `"job dead-lettered"` means a job failed after all its retries.
- To report errors to Sentry, set `SENTRY_DSN`.

## 7. Known issue: MinIO write-authentication advisories (H-3)

The pinned MinIO community release is affected by GHSA-hv4r-mvr4-25vw and GHSA-9c4q-hq6p-c237, which have no
community fix. Until storage is migrated, Caddy makes `files.DOMAIN` read-only (GET/HEAD on the two buckets only,
unsigned-trailer streaming requests refused, `/minio/*` not exposed); the app writes over the private network.
The residual risk and the migration plan are in [docs/runbooks/storage-migration.md](../docs/runbooks/storage-migration.md).
