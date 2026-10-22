# Runbooks

These are the first runbooks required before the pilot (Implementation Plan Phase 5, TR-OBS-07). Production runs on one VPS with Docker Compose ([ADR 0007](../adr/0007-self-hosted-vps.md), [deploy/README.md](../../deploy/README.md)). Commands below run in `/opt/tanbeeh` on the server. Rehearse each one on staging before go-live.

Separate runbooks: [storage-migration.md](storage-migration.md) (H-3: MinIO containment, residual risk, migration and rollback).

## Real-time overload (many staff boards Offline, `realtime` CPU high)

1. Run `docker stats` and check the `realtime` and `api` CPU and memory, and the server load (`uptime`).
2. Socket.IO uses the Redis adapter, so you can run more realtime containers: `docker compose up -d --scale realtime=2`. Caddy finds every realtime container through Docker DNS and keeps long-polling clients on one container with the `rt_lb` cookie.
3. If the whole server is saturated, resize the VPS with the provider (a short outage), or move MySQL to its own server (TR-NFR-08).
4. Customers keep their alerts: Web Push is sent by the worker, not over sockets. The staff board shows Offline until it reconnects.

## Redis or MySQL recovery

- **Redis (cache, presence, pub/sub in database 0; queues in database 1):** if the container restarts, it reloads from its AOF file. Presence keys may be lost, so alert levels can drop to "closed" for up to 60 s until `presence.reconcile` corrects them. Boards resync on reconnect (TR-RT-05). Repeat alerts survive a lost queue because `alert.reconcile` re-enqueues missing repeats every minute (TR-JOB-05).
- **MySQL container crash:** Docker restarts it and InnoDB recovers by itself. The API returns 503 while MySQL is down. Clients retry, and staff see Offline. Check `docker compose logs mysql`.
- **MySQL data corrupted or deleted:** restore to a point in time (see Restore below).
- **Disk full:** run `df -h` and `docker system df`. Remove old images with `docker image prune -a`. Binary logs expire after 8 days (`mysql/my.cnf`).

## Push provider outage (many 5xx from FCM or APNs in the worker logs)

1. Look up the failures in the logs by `push_service`.
2. Live pages and the display still alert, so tell pilot venues to watch the alert-level icons and call out numbers.
3. Do not revoke subscriptions. The worker revokes only after 5 consecutive failures (TR-ALR-09).

## Stuck outbox (unpublished `outbox` rows older than 1 minute)

1. Run `SELECT COUNT(*), MIN(created_at) FROM outbox WHERE published_at IS NULL;`.
2. Check the worker leader: `docker compose exec redis redis-cli exists scheduler:leader` must return 1. If it does not, run `docker compose restart worker`.
3. The relay processes rows in order. Duplicate processing is safe because jobs use deterministic IDs.

## Data breach response

1. Open an incident and page the security owner.
2. Contain the breach: rotate `SESSION_PEPPER` (this signs everyone out), Stripe keys, database, `REDIS_PASSWORD` and the MinIO root, app and backup keys (`MINIO_*` in `.env`, then `docker compose run --rm minio-init` and `docker compose up -d`), and the server's SSH keys (then update the `VPS_HOST_FINGERPRINT` deploy secret). Rotate the VAPID keys only if they leaked, since that invalidates every subscription (TR-SEC-08).
3. Work out the scope from the `audit_log` and the security logs (`security=true`).
4. Notify the affected tenants as data controllers, and the authority within the PDPL deadline, with counsel (BRD OI-04).

## Restore (NFR-REC-01, TR-INF-06, TR-INF-08)

Backups: a nightly dump and binary logs every 5 minutes, encrypted to the off-site remote ([deploy/README.md](../../deploy/README.md) §5).

- **Bad data or a deleted table, server still fine:** stop writes with `docker compose stop api worker realtime`. Then run `./scripts/restore.sh <dump> "<UTC time just before the mistake>"` and `docker compose up -d`.
- **Server lost (hardware, provider data centre):** set up a new server with `scripts/server-setup.sh`. Copy `.env`, `secrets/data_key` and `backup/rclone.conf` from your safe copy, start MySQL and Redis, run `restore.sh` with the latest dump and no end time to replay every copied binary log, then `docker compose up -d`. Point DNS at the new IP; keep the TTL at 300 s so the change spreads quickly. At most 5 minutes of data are lost. Back within 1 hour if a server is already prepared, which is the NFR-REC-01 target.
- **Provider or region lost:** do the same with a different provider. Target: within 8 hours (TR-INF-08).
- Record each rehearsal's timings in this file.

| Date | Scenario | Data lost | Time to service | Notes |
| --- | --- | --- | --- | --- |
