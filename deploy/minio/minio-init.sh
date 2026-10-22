#!/bin/sh
# One-shot MinIO provisioning, run by the `minio-init` service (docker compose run --rm minio-init). Idempotent:
# safe to run on every start and again after changing keys.
#   - buckets: tanbeeh-assets (anonymous download, logos), tanbeeh-exports (private, 7-day expiry, signed links)
#   - tanbeeh-app policy + MINIO_APP_ACCESS_KEY user: object read/write/delete and listing on both buckets, no admin
#     (M-11). This is what S3_ACCESS_KEY / S3_SECRET_KEY in the app containers use.
#   - tanbeeh-backup-ro policy + MINIO_BACKUP_ACCESS_KEY user: read and list tanbeeh-assets only (L-30).
# Only this script and the minio server itself use the root credentials.
set -eu

: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}"
: "${MINIO_APP_ACCESS_KEY:?}" "${MINIO_APP_SECRET_KEY:?}"
: "${MINIO_BACKUP_ACCESS_KEY:?}" "${MINIO_BACKUP_SECRET_KEY:?}"

for k in "$MINIO_APP_ACCESS_KEY" "$MINIO_BACKUP_ACCESS_KEY"; do
  if [ "$k" = "$MINIO_ROOT_USER" ]; then
    echo "minio-init: the app/backup access keys must differ from MINIO_ROOT_USER" >&2
    exit 1
  fi
done
if [ "$MINIO_APP_ACCESS_KEY" = "$MINIO_BACKUP_ACCESS_KEY" ]; then
  echo "minio-init: MINIO_APP_ACCESS_KEY and MINIO_BACKUP_ACCESS_KEY must differ" >&2
  exit 1
fi

# The root credentials reach mc through the MC_HOST_<alias> environment variable (not arguments, not a config file),
# which needs URL-safe values: scripts/init-secrets.sh prints letters and digits only.
case "$MINIO_ROOT_USER$MINIO_ROOT_PASSWORD" in
  *[!A-Za-z0-9._~-]*)
    echo "minio-init: MINIO_ROOT_USER/MINIO_ROOT_PASSWORD may only contain letters, digits and . _ ~ -" >&2
    exit 1 ;;
esac
umask 077
# Only shell built-ins and mc below: the minio/mc image is minimal (no grep/mktemp guaranteed).
MC_CONFIG_DIR=/tmp/tanbeeh-mc.$$
mkdir "$MC_CONFIG_DIR"
export MC_CONFIG_DIR
trap 'rm -rf "$MC_CONFIG_DIR"' EXIT INT TERM
POLICIES="$MC_CONFIG_DIR/policies"
mkdir -p "$POLICIES"
MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@minio:9000"
export MC_HOST_local

mc mb --ignore-existing local/tanbeeh-assets local/tanbeeh-exports
mc anonymous set download local/tanbeeh-assets
# Add the expiry rule only when the bucket has no lifecycle configuration yet (`ilm rule add` would add a duplicate
# rule on every run; `ilm rule ls` fails when no configuration exists).
if ! mc ilm rule ls local/tanbeeh-exports >/dev/null 2>&1; then
  mc ilm rule add --expire-days 7 local/tanbeeh-exports
fi

cat > "$POLICIES/tanbeeh-app.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::tanbeeh-assets", "arn:aws:s3:::tanbeeh-exports"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::tanbeeh-assets/*", "arn:aws:s3:::tanbeeh-exports/*"]
    }
  ]
}
JSON

cat > "$POLICIES/tanbeeh-backup-ro.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::tanbeeh-assets"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::tanbeeh-assets/*"]
    }
  ]
}
JSON

# `policy create` replaces an existing policy of the same name, so edits above take effect on the next run.
mc admin policy create local tanbeeh-app "$POLICIES/tanbeeh-app.json" >/dev/null
mc admin policy create local tanbeeh-backup-ro "$POLICIES/tanbeeh-backup-ro.json" >/dev/null

# ensure_user <access-key> <secret-key> <policy>: creates the user or resets its secret, then attaches the policy.
has_policy() { # has_policy <access-key> <policy>
  case "$(mc admin user info local "$1" 2>/dev/null)" in *"$2"*) return 0 ;; *) return 1 ;; esac
}
ensure_user() {
  # `mc admin user add` takes the secret as an argument; it runs only inside this one-shot container.
  mc admin user add local "$1" "$2" >/dev/null
  has_policy "$1" "$3" || mc admin policy attach local "$3" --user "$1" >/dev/null
  has_policy "$1" "$3" || { echo "minio-init: policy $3 not attached to $1" >&2; exit 1; }
}
ensure_user "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY" tanbeeh-app
ensure_user "$MINIO_BACKUP_ACCESS_KEY" "$MINIO_BACKUP_SECRET_KEY" tanbeeh-backup-ro

echo "minio-init: buckets, tanbeeh-app and tanbeeh-backup-ro users are in place"
