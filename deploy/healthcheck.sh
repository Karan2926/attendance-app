#!/usr/bin/env bash
# Monitoring probe for the Attendance app.
# Hits the public /api/health endpoint; logs the result and emails on failure.
# Scheduled by deploy/attendance-healthcheck.timer (systemd).
set -uo pipefail

URL=${HEALTHCHECK_URL:-https://yourdomain.com/api/health}
LOG=${HEALTHCHECK_LOG:-/var/log/attendance/healthcheck.log}
NOTIFY=${HEALTHCHECK_NOTIFY:-root@localhost}

mkdir -p "$(dirname "$LOG")"

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL" 2>/dev/null || echo 000)

if [ "$status" = "200" ]; then
  echo "$(date '+%F %T') OK" >> "$LOG"
  exit 0
fi

echo "$(date '+%F %T') DOWN (http $status)" >> "$LOG"

if command -v mailx >/dev/null 2>&1; then
  printf 'Attendance health check failed: HTTP %s at %s\n' "$status" "$URL" \
    | mailx -s "[attendance] site DOWN" "$NOTIFY" || true
else
  echo "mailx not installed — site is DOWN, manual check needed: $URL"
fi
exit 1