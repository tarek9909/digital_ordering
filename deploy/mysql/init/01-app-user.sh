#!/bin/sh
# Runs once when the MySQL volume is first created. The application account gets data access only; schema
# changes run as root through the one-shot `migrate` service (TR-DB-08).
# The root password goes through a 0600 option file, not a -p argument (L-29). Everything runs in a subshell so
# umask/trap do not leak into the image entrypoint, which sources non-executable init scripts.
set -e
(
  set -e
  umask 077
  DEFAULTS=$(mktemp)
  trap 'rm -f "$DEFAULTS"' EXIT
  {
    printf '[client]\nuser=root\npassword="'
    printf '%s' "$MYSQL_ROOT_PASSWORD" | sed -e 's/[\\"]/\\&/g'
    printf '"\n'
  } > "$DEFAULTS"
  mysql --defaults-extra-file="$DEFAULTS" <<SQL
CREATE USER IF NOT EXISTS 'app_rw'@'%' IDENTIFIED BY '${MYSQL_APP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON tanbeeh.* TO 'app_rw'@'%';
-- Partition-maintenance rights on ticket_events are granted by the migrate step, once the table exists.
FLUSH PRIVILEGES;
SQL
)
