#!/bin/sh
# Every 5 minutes: rotate the binary log and copy closed binlogs off-site. Restoring = last dump + these
# binlogs up to the chosen time, so at most ~5 minutes of data can be lost (NFR-REC-01, RPO ≤ 5 min).
# Upload only; off-site pruning is opt-in (BACKUP_PRUNE_ON_VPS, M-14).
set -eu
. /usr/local/bin/mysql-client.sh
mysql --defaults-extra-file="$MYSQL_DEFAULTS" -e 'FLUSH BINARY LOGS'
CURRENT=$(mysql --defaults-extra-file="$MYSQL_DEFAULTS" -N -e 'SHOW BINARY LOG STATUS' | awk '{print $1}')
rclone copy /var/lib/mysql "$BACKUP_REMOTE/binlogs/" --include 'binlog.[0-9]*' --exclude "$CURRENT" --no-traverse
if [ "${BACKUP_PRUNE_ON_VPS:-false}" = "true" ]; then
  rclone delete "$BACKUP_REMOTE/binlogs/" --min-age "${BACKUP_RETENTION_DAYS:-30}d"
fi
