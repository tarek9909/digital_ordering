#!/bin/sh
# Schedules (UTC): full dump daily 00:15, binlogs every 5 minutes, files daily 00:45.
set -e
: "${BACKUP_REMOTE:?Set BACKUP_REMOTE, e.g. offsite:tanbeeh (see rclone.conf)}"
umask 077
# 0600: holds the MySQL root password and the read-only MinIO backup secret for the cron jobs.
env | grep -E '^(MYSQL_ROOT_PASSWORD|BACKUP_REMOTE|BACKUP_RETENTION_DAYS|BACKUP_PRUNE_ON_VPS|MINIO_BACKUP_ACCESS_KEY|MINIO_BACKUP_SECRET_KEY|RCLONE_CONFIG)=' | sed 's/^/export /' > /etc/backup.env
. /usr/local/bin/mysql-client.sh
cat > /etc/crontab <<'CRON'
SHELL=/bin/sh
15 0 * * * root . /etc/backup.env && /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1
*/5 * * * * root . /etc/backup.env && /usr/local/bin/binlogs.sh >> /proc/1/fd/1 2>&1
45 0 * * * root . /etc/backup.env && /usr/local/bin/files.sh >> /proc/1/fd/1 2>&1
CRON
echo "backup scheduler started; remote=${BACKUP_REMOTE}; off-site pruning on this server: ${BACKUP_PRUNE_ON_VPS:-false}"
exec crond -n
