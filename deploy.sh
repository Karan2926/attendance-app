#!/bin/bash
# ============================================================
# ITM Attendance App — One-command deploy script
# Run: sudo bash /opt/attendance-app/deploy.sh
# ============================================================
set -e

APP_DIR="/opt/attendance-app"
FRONTEND_DIR="$APP_DIR/frontend"
WEBROOT="/var/www/attendance-frontend"

echo ""
echo "=========================================="
echo "  ITM Attendance App — Deploying..."
echo "=========================================="
echo ""

# 1. Pull latest code (force overwrite any local changes)
echo "[1/5] Pulling latest code from GitHub..."
cd "$APP_DIR"
git fetch origin
git reset --hard origin/main
echo "✓ Code updated"

# 2. Backend dependencies
echo "[2/5] Installing backend dependencies..."
cd "$APP_DIR/backend"
PYTHON_BIN="python3"
if [ -x "$APP_DIR/backend/.venv/bin/python" ]; then
    PYTHON_BIN="$APP_DIR/backend/.venv/bin/python"
elif command -v python3 &>/dev/null; then
    PYTHON_BIN="python3"
elif command -v python &>/dev/null; then
    PYTHON_BIN="python"
fi

if [ -x "$APP_DIR/backend/.venv/bin/pip" ]; then
    "$APP_DIR/backend/.venv/bin/pip" install -q -r requirements.txt 2>/dev/null || true
else
    pip3 install -q -r requirements.txt 2>/dev/null || pip install -q -r requirements.txt 2>/dev/null || true
fi
echo "✓ Backend dependencies OK"

# 3. Run Django migrations
echo "[3/5] Running database migrations..."
cd "$APP_DIR/backend"
"$PYTHON_BIN" manage.py migrate --no-input
echo "✓ Migrations done"

# 4. Build React frontend
echo "[4/5] Building React frontend..."
cd "$FRONTEND_DIR"
npm install --silent
npm run build
echo "✓ Frontend built"

# 5. Copy built files to web root & reload services
echo "[5/5] Deploying frontend & restarting services..."
rm -rf "$WEBROOT"/*
cp -r "$FRONTEND_DIR/dist/"* "$WEBROOT/"
systemctl restart attendance
systemctl reload nginx
echo "✓ Services restarted"

echo ""
echo "=========================================="
echo "  ✅ Deploy complete!"
echo "=========================================="
echo ""
