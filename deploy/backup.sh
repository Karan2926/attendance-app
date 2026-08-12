#!/usr/bin/env bash
# Nightly backup for the Attendance app.
# Backs up the irreplaceable face dataset + model + a DB dump to an off-machine
# destination. Install a cron entry (as root):
#   0 2 * * * /opt/attendance-app/deploy/backup.sh >> /var/log/attendance/backup.log 2>&1
set -euo pipefail

DATA_DIR=/var/lib/attendance
BACKUP_DIR=/var/backups/attendance          # change to a remote mount/S3/rsync target
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

# 1. Face dataset + model + train status (irreplaceable)
tar -czf "$BACKUP_DIR/dataset-$STAMP.tar.gz" \
    -C "$DATA_DIR" dataset model.pkl train_status.json 2>/dev/null || true

# 2. PostgreSQL dump (full schema + data)
pg_dump -h 127.0.0.1 -p 5433 -U attendance -d attendance \
    --no-owner --no-privileges -Fc \
    -f "$BACKUP_DIR/db-$STAMP.dump"

# 3. Prune backups older than 14 days
find "$BACKUP_DIR" -name "dataset-*.tar.gz" -mtime +14 -delete
find "$BACKUP_DIR" -name "db-*.dump"        -mtime +14 -delete

echo "Backup complete: $BACKUP_DIR ($STAMP)"
