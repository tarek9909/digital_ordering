#!/bin/sh
# Sourced by the backup scripts and restore.sh. Writes the MySQL root password into a 0600 client option file and
# sets MYSQL_DEFAULTS to its path, so mysql/mysqldump/mysqladmin get it through --defaults-extra-file instead of a
# `-p<password>` argument that process listings could show (L-29). MYSQL_PWD is deliberately not used (MySQL
# discourages it). The password is passed to sed on stdin, never as an argument.
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is not set}"
MYSQL_DEFAULTS=${MYSQL_DEFAULTS:-/run/tanbeeh/mysql-client.cnf}
# Rewritten on every use, so a rotated password takes effect without stale files. Inside an option file a quoted
# value treats \ as an escape, so backslashes and double quotes are escaped.
(
  set -e
  umask 077
  mkdir -p "$(dirname "$MYSQL_DEFAULTS")"
  {
    printf '[client]\nuser=root\nhost=mysql\npassword="'
    printf '%s' "$MYSQL_ROOT_PASSWORD" | sed -e 's/[\\"]/\\&/g'
    printf '"\n'
  } > "$MYSQL_DEFAULTS.tmp"
  mv "$MYSQL_DEFAULTS.tmp" "$MYSQL_DEFAULTS"
) || { echo "could not write the MySQL option file $MYSQL_DEFAULTS" >&2; exit 1; }
export MYSQL_DEFAULTS
