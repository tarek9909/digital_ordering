# Deployment, dependencies, and secret exposure review — 2026-10-22

Review scope: repository dependency manifests/locks, installed runtime usage, Dockerfiles, both Compose files, Caddy, CI/release workflows, deployment and backup scripts, environment examples, current local sensitive-file inventory, and tracked Git history. Application source/configuration was not changed. Evidence files contain no credentials, tokens, or signed download URLs.

## SC01 — High: public MinIO endpoint uses a release with object-write authentication bypasses

**Classification:** affected deployment dependency with a verified public attack path; not a live exploit test.

**Locations:** `deploy/docker-compose.yml:146` pins `minio/minio:RELEASE.2025-04-22T22-12-26Z`; `deploy/Caddyfile:108-110` forwards every path/method from `files.DOMAIN` to that server. `deploy/docker-compose.yml:28-29` uses the root MinIO account for application S3 requests, and `deploy/.env.example:15` uses a predictable root access identifier. `backend/packages/services/src/aws.ts:20-23,37-38` also uses that identifier for presigned exports.

**Evidence:** the maintainer confirms [GHSA-hv4r-mvr4-25vw](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw) and [GHSA-9c4q-hq6p-c237](https://github.com/minio/minio/security/advisories/GHSA-9c4q-hq6p-c237) affect this release. Knowing a valid access identifier with write permission is sufficient to write objects without its secret. The signed-export probe using synthetic credentials confirms any recipient can recover the configured access identifier from `X-Amz-Credential`. The default identifier can also be learned from the example configuration. Ordinary S3 access identifiers are not secrets; treating them as secrets cannot fix this vulnerability.

**Impact:** an attacker using the configured identifier can overwrite other tenants' known logo keys, create arbitrary publicly served objects, modify exports at known keys, and consume storage without passing application authentication or image validation. The vulnerable storage interface is publicly exposed through the documented production proxy. Actual VPS version/state was not available, and no request was made to a live MinIO instance.

**Fix:** replace this release with a supported implementation/version containing both fixes. The advisories identify AIStor `RELEASE.2026-04-11T03-20-12Z` or later; do not assume the last community image contains those fixes. Immediately restrict the public file proxy to required read methods/paths while internal service writes continue privately. Use application credentials scoped to the required buckets and operations. Verify an unsigned write is refused on an isolated deployment. Include MinIO and other deployed images in release security scans; `.github/workflows/deploy.yml:45-47` currently scans only the API image.

## SC02 — Medium: deployment SSH/SCP skips server identity verification

**Classification:** release credential exposure under an active network/DNS interception condition.

**Locations:** `.github/workflows/deploy.yml:56-70` configures the SCP and SSH actions with a host, username, and key but no `fingerprint`. Line 74 includes `GHCR_READ_TOKEN` in the remote command stream.

**Evidence:** the exact action definitions for [scp-action v0.1.7](https://raw.githubusercontent.com/appleboy/scp-action/v0.1.7/action.yml) and [ssh-action v1.2.0](https://raw.githubusercontent.com/appleboy/ssh-action/v1.2.0/action.yml) document that an omitted host fingerprint skips verification. The action maintainer's [host verification documentation](https://github.com/appleboy/ssh-action#host-fingerprint-verification) prescribes setting the trusted fingerprint.

**Impact:** an attacker who intercepts the connection can impersonate the VPS and receive the remote script, including its registry read token, copied deployment files, and supply fabricated success output. This does not reveal the SSH private key itself. No remote deployment or interception was performed.

**Fix:** configure an independently verified VPS host fingerprint on both actions and test that a mismatched fingerprint fails closed. Review repository environment access controls separately; external GitHub settings were not available for verification.

## SC03 — Medium: local Compose exposes database, Redis, mail, and default-credential storage to every interface

**Classification:** development configuration risk; exploitation depends on host/network reachability.

**Locations:** `backend/docker-compose.yml:16,22,25,32` publishes MySQL, Redis, Mailpit SMTP/UI, and MinIO API/console without a loopback host binding. Lines 6-9 and 30-31 use documented development passwords; Redis at line 21 has no authentication.

**Evidence:** [Docker Compose documentation](https://docs.docker.com/reference/compose-file/services/#ports) confirms omitted host IP binds published ports on all interfaces. The file is explicitly a local environment, but the published ports extend beyond loopback. The production Compose file does not publish these ports and is not implicated in this finding.

**Impact:** a reachable LAN/host network peer can inspect or alter development databases and Redis sessions/jobs, read captured verification/reset mail, or control local storage with the example credentials. Exposure depends on the machine firewall and network; this audit did not scan network hosts or running containers.

**Fix:** bind these host ports to `127.0.0.1` and, where required, explicitly to loopback IPv6. Remove unneeded published ports. For intentional shared environments, use separate credentials and authenticated network access instead of local defaults.

## SC04 — Medium: every application process receives MinIO root credentials

**Classification:** privilege/blast-radius risk; requires compromise of an application process or its configuration.

**Locations:** `deploy/docker-compose.yml:28-29` inserts `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` as application storage credentials into the shared app environment inherited by API, realtime, worker, and migration processes. This contradicts the comment at line 17 that MinIO administrator credentials stay out of application containers.

**Impact:** extraction of a single app process's environment grants storage administration rather than only the bucket operations it needs. The unrestricted public storage proxy also reaches the storage service's API surface. This finding is distinct from SC01: patching MinIO does not remove excessive application privileges.

**Fix:** create an application identity limited to required bucket/object operations and use a separate identity for provisioning/backup. Keep root storage credentials in the provisioning and recovery paths. Verify the application identity cannot administer users or buckets.

## Dependency advisory results and reachability limits

`npm audit --json` and `npm audit --omit=dev --json` were run read-only in both workspaces. Package counts below are npm's package records, including transitive effects, not a count of independently exploitable application flaws.

| Workspace/scope | npm audit result |
| --- | --- |
| Backend, all dependencies | 5 affected package records: 2 high, 2 critical, 1 moderate |
| Backend, production dependencies | 2 high package records: `nodemailer` 7.0.13 and `sharp` 0.34.5 |
| Frontend, all dependencies | 3 affected package records: 2 critical, 1 moderate |
| Frontend, production dependencies | 0 reported vulnerabilities |

- **Sharp 0.34.5** (`backend/package-lock.json:6111`, `backend/packages/services/package.json:31`) is behind fixes for upstream libvips, libheif, and librsvg issues. Maintainer advisories: [libvips](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj), [libheif](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), [librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w). The currently exposed upload path requires `venue.settings`, rate limits to 10 uploads/600 seconds, limits bytes/pixels, and rejects other image magic bytes before decoding (`backend/apps/api/src/routes/admin.ts:188-206`, `backend/packages/services/src/assets.ts:18-37`). Synthetic SVG/GIF/TIFF/AVIF inputs and a malformed PNG all returned `UPLOAD_INVALID`. The documented vulnerable loaders require formats outside the accepted PNG/JPEG/WebP set. No working native crash/RCE against the current path was demonstrated. Update to a tested patched version (the audit offers 0.35.5), but do not label this proven remotely exploitable RCE.
- **Nodemailer 7.0.13** (`backend/package-lock.json:5361`, `backend/apps/worker/package.json:16`) has multiple upstream advisories; npm offers 10.2.1. The worker constructs a fixed message object with string recipients and rendered body, not arbitrary transport/message options (`backend/apps/worker/src/main.ts:29-32`). API email validation caps addresses at 254 (`backend/packages/contracts/src/api.ts:31-35`), and queued email validates `.email()` (`backend/packages/jobs/src/index.ts:14-20`). Synthetic huge/malformed recipients, structured/nested recipients, and comments were rejected by the API schema. The [raw-message file/SSRF issue](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-p6gq-j5cr-w38f) requires attacker control of options this app does not forward. The [quadratic parser DoS](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-v53p-9fqp-m79j) needs a much larger malformed address than the API accepts. A dependency upgrade remains necessary; current application reachability was not demonstrated.
- **Vitest 3.2.7, `@vitest/mocker` 3.2.7, Tinypool 1.1.1** are development dependencies in both locks. Backend production prunes dev dependencies (`backend/Dockerfile:10`), and frontend deploy serves static built output (`deploy/web.Dockerfile:13-20`). [Mocker file read](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) requires the relevant exposed dev-server plugin; the current test configuration runs Node tests without it. [Tinypool RCE](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr) requires prior prototype pollution and specific options control; no such chain was identified. These are test-toolchain update tasks, not confirmed production critical RCE findings. npm offers a major Vitest upgrade; test before adopting it.

## Secret scan and limits

- High-confidence private-key/cloud-token/payment-token signature scans found **no matching working-tree paths** and **no matches in the two tracked Git revisions**. This is a pattern scan, not proof that every possible secret format is absent.
- The local `backend/.env` exists, is Git-ignored, and primarily matches development examples. Values were not copied to evidence. `deploy/.env`, `deploy/secrets/data_key`, and `deploy/backup/rclone.conf` were not present and are ignored by the repository rules. The examples contain intentional local keys, sample credentials, and placeholders.
- Only three requirement/concept documents are currently tracked; most implementation/deployment code is untracked. The review covered the working tree, not just tracked files.
- Docker, Trivy, Gitleaks, and Semgrep are not installed in this environment. Container operating-system package vulnerabilities, actual deployed image digests, VPS configuration, GitHub branch/environment protections, and provider account settings were not validated. The known pinned MinIO version was checked against maintainer advisories directly.

## Evidence and rerun

- `supplychain-backend-audit.json`, `supplychain-frontend-audit.json`: full npm results.
- `supplychain-backend-production-audit.json`, `supplychain-frontend-production-audit.json`: runtime dependency results.
- `supplychain-probes.mjs`, `supplychain-probes-results.json`: 10 passing read-only assertions covering rejected image formats, recipient validation, and synthetic presigned access-identifier exposure. Run from `backend/`: `node --import tsx ../docs/security/2026-10-22/supplychain-probes.mjs`.
- `supplychain-secret-scan.json`: sanitized pattern-scan scope, file counts, ignored paths, and local environment value classifications.
