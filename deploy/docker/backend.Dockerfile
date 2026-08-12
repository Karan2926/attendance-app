# Attendance backend — Django + insightface + onnxruntime + opencv
# Multi-stage: build stage compiles/native deps, runtime stage stays lean.

FROM python:3.13-slim AS runtime

# System libs: opencv, psycopg, onnxruntime, and insightface need these.
# netcat for the compose healthcheck option.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libpq5 \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (caching layer — build only when requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Application code
COPY . .

# Runtime user (non-root) — owns the data volume too
RUN useradd -m -u 1000 -s /bin/false appuser \
    && mkdir -p /data /home/appuser/.insightface/models \
    && chown -R appuser:appuser /data /home/appuser

# InsightFace resolves the model dir via os.path.expanduser(root) with
# root defaulting to '~/.insightface' (FaceAnalysis("buffalo_l") in
# recognition.py uses that default). So the model must live at:
#     /home/appuser/.insightface/models/buffalo_l
# The docker-compose mount puts the model there from the data volume.
ENV HOME=/home/appuser \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings

# gunicorn is available; entrypoint runs migrations + server.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER appuser
EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4", "--threads", "2", "--timeout", "120", "--max-requests", "1000", "--max-requests-jitter", "100"]
