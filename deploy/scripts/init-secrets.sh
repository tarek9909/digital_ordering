#!/bin/sh
# Creates the data-encryption key (Docker secret) once, and prints random values for .env.
# Back up secrets/data_key separately and safely: without it, encrypted staff keys and TOTP secrets are lost.
# Printed values are letters and digits only, so they are safe inside the Redis URL and MinIO's MC_HOST alias.
set -eu
cd "$(dirname "$0")/.."
mkdir -p secrets && chmod 700 secrets
if [ ! -f secrets/data_key ]; then
  head -c 32 /dev/urandom | base64 > secrets/data_key
  chmod 600 secrets/data_key
  echo "created secrets/data_key"
else
  echo "secrets/data_key exists, kept"
fi
rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-"$1"; }
echo
echo "Suggested values for .env (only set the ones you do not have yet; changing an existing one needs the"
echo "rotation steps in deploy/README.md):"
for k in MYSQL_ROOT_PASSWORD MYSQL_APP_PASSWORD MINIO_ROOT_PASSWORD REDIS_PASSWORD SESSION_PEPPER; do
  echo "$k=$(rand 40)"
done
# MinIO access keys: 3-20 characters; secret keys: 8-40 characters. A non-obvious root key ID matters while the
# H-3 write bypass is unpatched (docs/runbooks/storage-migration.md); set it only on a NEW install.
echo "# new installs only:"
echo "MINIO_ROOT_USER=admin-$(rand 14)"
echo "MINIO_APP_ACCESS_KEY=tanbeeh-app-$(rand 8)"
echo "MINIO_APP_SECRET_KEY=$(rand 40)"
echo "MINIO_BACKUP_ACCESS_KEY=tanbeeh-bak-$(rand 8)"
echo "MINIO_BACKUP_SECRET_KEY=$(rand 40)"
