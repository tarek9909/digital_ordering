#!/bin/sh
# Nightly copy of uploaded files (logos, legal documents). Exports are temporary and not backed up.
# Reads MinIO with the read-only backup identity (L-30) and uses `copy`, not `sync`: objects deleted or emptied on
# the VPS are never deleted off-site (M-14). Changed objects are re-uploaded; keep bucket versioning on so an
# overwrite does not destroy the earlier copy.
set -eu
: "${MINIO_BACKUP_ACCESS_KEY:?}" "${MINIO_BACKUP_SECRET_KEY:?}"
# An rclone remote named `minio`, defined through the environment (no secret in arguments or files).
export RCLONE_CONFIG_MINIO_TYPE=s3
export RCLONE_CONFIG_MINIO_PROVIDER=Minio
export RCLONE_CONFIG_MINIO_ENDPOINT=http://minio:9000
export RCLONE_CONFIG_MINIO_REGION=us-east-1
export RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="$MINIO_BACKUP_ACCESS_KEY"
export RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="$MINIO_BACKUP_SECRET_KEY"
rclone copy minio:tanbeeh-assets "$BACKUP_REMOTE/files/tanbeeh-assets"
echo "$(date -u +%FT%TZ) files ok"
