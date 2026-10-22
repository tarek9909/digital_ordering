#!/bin/sh
# Restore runbook helper (NFR-REC-01). Usage on the VPS, from /opt/tanbeeh:
#   ./scripts/restore.sh <dump-file-name> [stop-datetime "YYYY-MM-DD HH:MM:SS" UTC]
# 1. stops the app services, 2. loads the dump, 3. replays binlogs written after it up to the stop time,
# 4. starts the services. Rehearse on a spare server and record the timings in docs/runbooks.
# Only reads from BACKUP_REMOTE, so the VPS's upload-only (no-delete) backup key is enough (M-14).
# The MySQL root password is passed through a 0600 option file, never as -p (L-29).
set -eu
DUMP=${1:?dump file name, e.g. tanbeeh-20261022T001500Z.sql.gz}
STOP=${2:-}
case "$DUMP" in
  *[!A-Za-z0-9._-]*) echo "unexpected characters in dump file name: $DUMP" >&2; exit 1 ;;
esac
case "$STOP" in
  *[!0-9:\ -]*) echo "stop time must look like 'YYYY-MM-DD HH:MM:SS'" >&2; exit 1 ;;
esac
docker compose stop api realtime worker
docker compose run --rm --entrypoint sh backup -c "
  set -e
  . /usr/local/bin/mysql-client.sh
  rclone copy \"\$BACKUP_REMOTE/dumps/$DUMP\" /backups/restore/
  rclone copy \"\$BACKUP_REMOTE/binlogs/\" /backups/restore/binlogs/
  gunzip -c /backups/restore/$DUMP | mysql --defaults-extra-file=\"\$MYSQL_DEFAULTS\"
  START=\$(gunzip -c /backups/restore/$DUMP | grep -m1 -oE \"(SOURCE|MASTER)_LOG_FILE='[^']*'\" | cut -d\\' -f2)
  FILES=\$(ls /backups/restore/binlogs/binlog.[0-9]* | sort | awk -v s=\"/backups/restore/binlogs/\$START\" '\$0 >= s')
  mysqlbinlog ${STOP:+--stop-datetime=\"$STOP\"} \$FILES | mysql --defaults-extra-file=\"\$MYSQL_DEFAULTS\"
  rm -rf /backups/restore
"
docker compose up -d api realtime worker
echo "restore finished; check /readyz and the admin Today screen"
