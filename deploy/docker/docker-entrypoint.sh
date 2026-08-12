#!/usr/bin/env bash
# Container entrypoint: collect static, run migrations, then start gunicorn.
set -e

echo "[entrypoint] Running collectstatic..."
python manage.py collectstatic --noinput

echo "[entrypoint] Applying migrations..."
python manage.py migrate --noinput

echo "[entrypoint] Starting server: $@"
exec "$@"
