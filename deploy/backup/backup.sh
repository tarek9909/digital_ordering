#!/bin/sh
# Nightly consistent dump (InnoDB snapshot, no locks), compressed, copied off-site.
# Off-site pruning is NOT done here by default (M-14): the VPS key should be upload-only and the bucket should
# enforce versioning/object lock; retention is pruned from a separate trusted machine (deploy/README.md §5).
set -eu
. /usr/local/bin/mysql-client.sh
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE=/backups/tanbeeh-$TS.sql.gz
mysqldump --defaults-extra-file="$MYSQL_DEFAULTS" --single-transaction --quick --routines --triggers --events \
  --source-data=2 --flush-logs --set-gtid-purged=OFF --databases tanbeeh | gzip -6 > "$FILE"
rclone copy "$FILE" "$BACKUP_REMOTE/dumps/" --no-traverse
find /backups -name 'tanbeeh-*.sql.gz' -mtime +2 -delete
if [ "${BACKUP_PRUNE_ON_VPS:-false}" = "true" ]; then
  # Opt-in only: needs a delete-capable key on the VPS, which a compromised server could then use.
  rclone delete "$BACKUP_REMOTE/dumps/" --min-age "${BACKUP_RETENTION_DAYS:-30}d"
fi
echo "$(date -u +%FT%TZ) dump ok $FILE ($(du -h "$FILE" | cut -f1))"
