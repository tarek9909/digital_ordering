# 0007 — Self-hosted on one VPS with Docker Compose instead of AWS

**Context.** TRD §24.1 describes an AWS deployment: CloudFront, WAF, ALB, ECS Fargate, RDS Multi-AZ, ElastiCache, MemoryDB, S3, SES, Secrets Manager and KMS, built with Terraform. The owner wants to run the platform on their own VPS instead.

**Decision.** Production runs from `deploy/docker-compose.yml` on one VPS:

| TRD (AWS) | Self-hosted replacement |
| --- | --- |
| CloudFront, WAF, ALB, ACM | Caddy 2: serves the six apps, routes `/api`, `/m` and `/rt`, issues certificates on demand. A host gets a certificate only if `GET /internal/tls-allowed` on the API accepts it. |
| ECS Fargate services | `api`, `realtime` and `worker` containers from the same image (`SERVICE_ROLE`); `migrate` and `create-admin` run as one-off containers |
| RDS MySQL 8.4 (Multi-AZ, PITR) | MySQL 8.4 container with row-based binary logs; nightly `mysqldump` plus binary logs copied every 5 minutes to off-site storage (rclone) |
| ElastiCache + MemoryDB | One Redis 7 container with AOF and `noeviction`. Database 0 holds cache, presence and pub/sub; database 1 holds queues. |
| S3 + CloudFront for files | MinIO at `files.{domain}`: a public-read assets bucket, plus a private exports bucket with presigned links |
| SES | Any SMTP provider through `SMTP_URL` |
| Secrets Manager + KMS | `deploy/.env` (mode 600), plus the data key in the Docker secret `secrets/data_key` (`DATA_KEY_FILE`). The KMS key provider is still in the code for a later move. |
| Terraform | `deploy/scripts/server-setup.sh`, and the `deploy` GitHub workflow (GHCR images, SSH, migrate, `up -d`) |
| CloudWatch alarms | An external uptime monitor on `/readyz`, plus Sentry and JSON logs |

**Consequences.**

- There is no automatic failover. A server failure means restoring onto a new server from off-site backups with `deploy/scripts/restore.sh`. At most 5 minutes of data are lost (binary logs every 5 minutes). Service is back as soon as a server is ready and the restore has run: about 1 hour with a server prepared in advance, so NFR-REC-01 holds only if a spare server or snapshot is kept ready. Region loss is handled the same way from the off-site copy, which covers TR-INF-08.
- One server limits scale. The sizing in `deploy/README.md` covers the pilot and early growth. The next steps are to move MySQL to its own server, then run more `realtime` containers; Socket.IO already uses the Redis adapter.
- Let's Encrypt allows 50 new certificates per week per domain. Above that, use a wildcard certificate with a DNS-provider plugin for Caddy.
- The hosting provider and the server's country become processors in the data inventory. Under PDPL, choose the server location after counsel's answer (BRD OI-04, check 0.4).
- The application code does not depend on AWS. Storage is S3-compatible through `S3_ENDPOINT`, and email goes through SMTP. A later move to AWS or another cloud needs only deployment changes.
