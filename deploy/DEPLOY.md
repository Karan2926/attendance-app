# Deployment Guide — Attendance App (Django + React + PostgreSQL)

This guide deploys the app on a **Linux VPS** (Ubuntu 22.04/24.04 recommended).
Recommended server: **4 vCPU / 8 GB RAM, 80+ GB disk** (Hetzner CX32 / DigitalOcean Basic 6).

Everything runs on ONE server:
- **PostgreSQL** for the DB
- **gunicorn** serving the Django API
- **nginx** serving the built React SPA + proxying `/api` and `/admin` to Django
- **certbot** for HTTPS (required for the webcam / face capture)

---

## 1. Install system packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-venv python3-pip build-essential \
    postgresql postgresql-contrib libpq-dev nginx certbot python3-certbot-nginx \
    git curl
```

> `libpq-dev` (or `libpq` headers) are needed to compile/build psycopg if the
> binary wheel isn't picked up. `build-essential` is a fallback for native deps.

---

## 2. Create the app user and directory layout

```bash
sudo useradd -r -s /bin/false attendance
sudo mkdir -p /opt/attendance-app
sudo mkdir -p /var/lib/attendance
sudo mkdir -p /var/log/attendance
sudo chown -R attendance:attendance /opt/attendance-app /var/lib/attendance /var/log/attendance
```

Upload the project (scp/rsync or `git clone`) into `/opt/attendance-app` so that the
layout is:

```
/opt/attendance-app/
├── backend/
└── frontend/
```

---

## 3. Set up PostgreSQL

```bash
sudo -u postgres psql
```
```sql
CREATE USER attendance WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE attendance OWNER attendance;
\q
```

On this machine we bind Postgres to `127.0.0.1`. Set the port to `5433` to match the
app default (or change the app URL to `5432` — either is fine). To use 5433, edit
`/etc/postgresql/*/main/postgresql.conf` and set `port = 5433`, then:
```bash
sudo systemctl restart postgresql
```

---

## 4. Backend — venv + install

```bash
cd /opt/attendance-app/backend

# Create venv as the attendance user
sudo -u attendance python3 -m venv .venv
sudo -u attendance .venv/bin/pip install --upgrade pip
sudo -u attendance .venv/bin/pip install -r requirements.txt
```

**Important — the face model (large, ~340 MB) + your data must be copied.**

The backend needs the **InsightFace `buffalo_l` model**, which on your Mac lives at
`~/.insightface/models/buffalo_l/`. On the server it must go to the
**`attendance` user's home** so InsightFace finds it:

```bash
sudo -u attendance mkhomedir_helper attendance 2>/dev/null || true
sudo mkdir -p /home/attendance/.insightface/models
# Copy from your Mac (run locally):
#   scp -r ~/.insightface/models/buffalo_l user@SERVER:/tmp/buffalo_l
sudo mv /tmp/buffalo_l /home/attendance/.insightface/models/
sudo chown -R attendance:attendance /home/attendance/.insightface/models
```

If you'd rather not store it in the home dir, set `INSIGHTFACE_HOME=/var/lib/attendance`
in the `.env` and copy it to `/var/lib/attendance/.insightface/models/buffalo_l`.

---

## 5. Backend — config

```bash
sudo -u attendance cp /opt/attendance-app/deploy/.env.production.example \
    /opt/attendance-app/backend/.env
# Edit, at minimum:
#   DJANGO_ALLOWED_HOSTS, DJANGO_DATABASE_URL, DJANGO_SECRET_KEY
sudo -u attendance editor /opt/attendance-app/backend/.env
```

Generate the secret key on the server:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## 6. Copy your DATA and MODEL to the server

Your face dataset and trained model live on your Mac. Move them to the server so
recognition still works.

```bash
# ---- From your Mac ----
cd /Users/karanbhadouriya/Documents/attendance-app/backend
scp -r dataset user@SERVER:/var/lib/attendance/
scp model.pkl       user@SERVER:/var/lib/attendance/
mkdir -p /tmp/attendance-backup && scp -r dataset user@SERVER:/tmp/attendance/
```

Then on the server:
```bash
sudo mv /tmp/attendance/dataset /var/lib/attendance/
sudo mv /tmp/attendance/model.pkl /var/lib/attendance/
sudo chown -R attendance:attendance /var/lib/attendance
```

> The `.env` already points `DATASET_DIR`, `MODEL_PATH`, `TRAIN_STATUS_FILE` at
> `/var/lib/attendance/...`, so make sure both the files **and** the `.env` agree.

---

## 7. Migrate the DATABASE to the server

Because your current data lives in a **local PostgreSQL** (`127.0.0.1:5433/attendance`)
with a **different cluster**, use a `pg_dump`/`pg_restore`:

```bash
# ---- On your Mac (dump the current data) ----
pg_dump -h 127.0.0.1 -p 5433 -U attendance -d attendance \
    --no-owner --no-privileges -Fc -f /tmp/attendance_dump.dump
scp /tmp/attendance_dump.dump user@SERVER:/tmp/

# ---- On the server (restore into the new empty DB) ----
sudo -u postgres pg_restore --no-owner --no-privileges \
    -h 127.0.0.1 -p 5433 -U attendance -d attendance \
    --clean --if-exists /tmp/attendance_dump.dump
```

> Migration order matters: **run Django's migrations FIRST**, then restore. But since
> your local DB is already fully migrated (same Django schema), a straight dump/restore
> is fine. If you prefer, do it cleanly:
> 1. `python manage.py migrate` on a fresh DB
> 2. `pg_restore --data-only` the dump

---

## 8. Frontend — build

```bash
cd /opt/attendance-app/frontend
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g npm

sudo -u attendance npm install
# UI lives at /var/www/attendance-frontend
sudo mkdir -p /var/www/attendance-frontend
# Leave VITE_API_BASE empty so nginx proxies /api on the same origin
sudo -u attendance npm run build
sudo cp -r dist/* /var/www/attendance-frontend/
sudo chown -R www-data:www-data /var/www/attendance-frontend
```

---

## 9. Collect static files (Django admin)

```bash
cd /opt/attendance-app/backend
sudo -u attendance .venv/bin/python manage.py collectstatic --noinput
sudo -u attendance .venv/bin/python manage.py migrate
```

---

## 10. systemd service

```bash
sudo cp /opt/attendance-app/deploy/attendance.service /etc/systemd/system/attendance.service
sudo systemctl daemon-reload
sudo systemctl enable --now attendance
sudo systemctl status attendance
```

Tune the gunicorn `--workers` in `attendance.service`. Each worker holds a copy of the
face model in RAM, so keep an eye on memory:
- 4 GB VPS → 2–3 workers
- 8 GB VPS → 4 workers
- 16 GB VPS → 6–8 workers

---

## 11. Nginx

```bash
sudo cp /opt/attendance-app/deploy/nginx-attendance.conf \
    /etc/nginx/sites-available/attendance
sudo ln -sf /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance
# Edit yourdomain.com / server IP in the conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## 12. HTTPS (REQUIRED for webcam)

The browser blocks `getUserMedia` (camera) on non-localhost insecure origins, so HTTPS
is mandatory for face capture.

```bash
# First point your domain's DNS A record at the server IP.
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```
certbot will obtain the cert and add the ssl lines to the nginx site automatically.

---

## 13. Verify

```bash
curl -I https://yourdomain.com/            # expect 200, HTML
curl -s https://yourdomain.com/api/auth/login -X POST \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"YOURPW"}'   # expect {"user":{...}}
# Auth is an HttpOnly cookie now — a successful login also sets the
# `attendance_token` cookie on the response (visible with curl -i).
curl -i https://yourdomain.com/api/auth/login -X POST \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"YOURPW"}' | grep -i set-cookie
sudo journalctl -u attendance -f          # live backend logs
```

Log in via the browser, go to Dashboard, and re-train the model once on the server
(if `model.pkl` wasn't uploaded, or to rebuild embeddings against the new DB):
```bash
cd /opt/attendance-app/backend && sudo -u attendance .venv/bin/python manage.py shell -c "
import django, os
django.setup()
from core import recognition
recognition.train_model_background(recognition.DATASET_DIR)
"
```

---

## 14. Backups & monitoring (automated)

The `deploy/` folder ships two automation units. Enable them once, on the
server, and they keep running forever:

```bash
# --- Nightly backup (02:00) of face data + model + a Postgres dump ---
sudo cp /opt/attendance-app/deploy/attendance-backup.service /etc/systemd/system/
sudo cp /opt/attendance-app/deploy/attendance-backup.timer    /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now attendance-backup.timer

# --- Health probe every 5 min (emails on failure via mailx) ---
sudo cp /opt/attendance-app/deploy/attendance-healthcheck.service /etc/systemd/system/
sudo cp /opt/attendance-app/deploy/attendance-healthcheck.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now attendance-healthcheck.timer
```

Backups go to `/var/backups/attendance` (dataset + `db-*.dump`), keeping the
last 14 days. To send them off-machine (recommended), mount an S3 bucket /
external drive there or point `ATTENDANCE_BACKUP_DIR` at a synced path.

The probe hits the public health endpoint `GET /api/health` — install
`mailx` (`sudo apt install -y mailutils`) or set `HEALTHCHECK_NOTIFY` and
`HEALTHCHECK_URL` in `/opt/attendance-app/backend/.env`:

```
HEALTHCHECK_URL=https://yourdomain.com/api/health
HEALTHCHECK_NOTIFY=you@example.com
```

Inspect results any time:

```bash
sudo systemctl list-timers | grep attendance
journalctl -u attendance-backup -e      # last backup log
tail -f /var/log/attendance/healthcheck.log
```

### External uptime monitoring (free, optional)

The built-in probe emails you when the site is down, but it can only tell you
after the fact and only while the server itself is reachable. For watchdog
monitoring from outside (catches full outages, network partitions, reboot hang),
create a free account at **uptimerobot.com** and add a monitor:

- **Monitor type**: HTTPS
- **URL**: `https://yourdomain.com/api/health`
- **Keyword**: type `"status"` (HTTP 200 is expected — this confirms the body too)
- **Interval**: every 5 minutes → free email alerts, or push to a Slack/Discord webhook

---

## Real-world challenges to expect (vs localhost)

1. **Memory spikes on training** — InsightFace loads ~340 MB of ONNX per worker. Run
   training as a maintenance task (fewer workers or a separate one-off command), not
   during peak API traffic.
2. **CPU-bound face inference** — batch classroom marking is heavy. Single requests are
   fine, but avoid `max-requests` forcing a worker to reload in the middle of a batch.
3. **Webcam blocked without HTTPS** — already handled by certbot.
4. **File permissions** — everything in `/var/lib/attendance` and `/opt/attendance-app`
   must be owned by `attendance` (gunicorn writes `train_status.json`, `model.pkl`, and
   capture images there). www-data only owns the frontend `dist`.
5. **Backups** — the `dataset/` + `model.pkl` are irreplaceable (photos can't be
   regenerated). Enabled in one step via section 14 (`attendance-backup.timer`),
   which archives the dataset + a `pg_dump` nightly and keeps 14 days.
6. **`DJANGO_ALLOWED_HOSTS`** — a `Bad Request (400)` after deploy almost always means
   your domain isn't listed here or DEBUG is on.
7. **22-year timescale note** — this schema uses TEXT timestamps; be consistent with
   `TIME_ZONE=UTC` on the server to match local output.
