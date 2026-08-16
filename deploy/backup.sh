#!/usr/bin/env bash
# Nightly backup for the Attendance app.
# Backs up the irreplaceable face dataset + model + a DB dump to a local archive
# directory. Scheduled by deploy/attendance-backup.timer (systemd).
set -euo pipefail

DATA_DIR=${ATTENDANCE_DATA_DIR:-/var/lib/attendance}
BACKUP_DIR=${ATTENDANCE_BACKUP_DIR:-/var/backups/attendance}
DB_URL=${DJANGO_DATABASE_URL:-postgresql://attendance:attendance@127.0.0.1:5433/attendance}
KEEP_DAYS=${ATTENDANCE_BACKUP_KEEP_DAYS:-14}
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# Parse the DB URL so pg_dump can authenticate non-interactively.
#   Format: postgresql://user:pass@host:port/dbname
BASE="${DB_URL#postgresql://}"
BASE="${BASE#postgres://}"
AUTH="${BASE%%@*}"; REST="${BASE#*@}"
DB_USER="${AUTH%%:*}"
DB_PASS="${AUTH#*:}"
DB_HOST="${REST%%:*}"
DB_PORT="$(printf '%s' "${REST#*:}" | cut -d/ -f1)"
DB_NAME="${REST##*/}"

DB_USER=${DB_USER:-attendance}
DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-5433}
DB_NAME=${DB_NAME:-attendance}

# 1. Face dataset + model + train status (irreplaceable — photos).
if [ -d "$DATA_DIR/dataset" ]; then
  tar -czf "$BACKUP_DIR/dataset-$STAMP.tar.gz" \
      -C "$DATA_DIR" dataset model.pkl train_status.json 2>/dev/null || true
fi

# 2. PostgreSQL dump (full schema + data).
export PGPASSWORD="$DB_PASS"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges -Fc \
    -f "$BACKUP_DIR/db-$STAMP.dump"
unset PGPASSWORD

# 3. Prune backups older than the retention window.
find "$BACKUP_DIR" -name "dataset-*.tar.gz" -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name "db-*.dump"        -mtime "+$KEEP_DAYS" -delete

echo "Backup complete: $BACKUP_DIR ($STAMP)"