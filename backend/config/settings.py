"""
Django settings for the Digital Attendance rewrite.

Backend: PostgreSQL (default) or SQLite (dev escape hatch).
Frontend: React SPA served by Vite (dev) → talks to this API over CORS.
"""

from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Environment (works like the Flask .env loader — no dotenv dependency)
# ---------------------------------------------------------------------------
def _load_dotenv(path=None):
    env_path = path or (BASE_DIR.parent / ".env")
    if not os.path.isfile(env_path):
        env_path = BASE_DIR / ".env"
    if not os.path.isfile(env_path):
        return
    try:
        with open(env_path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
    except OSError:
        pass


_load_dotenv()

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY", "django-insecure-dev-key-change-in-production"
)

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0").split(",")
    if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "core",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ---------------------------------------------------------------------------
# Database — PostgreSQL permanent; SQLite only with USE_SQLITE=1
# ---------------------------------------------------------------------------
USE_SQLITE = os.environ.get("USE_SQLITE", "0") == "1"

if USE_SQLITE:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
else:
    _DEFAULT_DATABASE_URL = "postgresql://attendance:attendance@127.0.0.1:5433/attendance_django"
    db_url = os.environ.get("DJANGO_DATABASE_URL", "").strip() or _DEFAULT_DATABASE_URL
    db_url = db_url.replace("postgres://", "postgresql://")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "attendance_django",
            "USER": "attendance",
            "PASSWORD": "attendance",
            "HOST": "127.0.0.1",
            "PORT": "5433",
        }
    }
    if "postgresql://" in db_url:
        from urllib.parse import urlsplit

        parts = urlsplit(db_url)
        DATABASES["default"].update(
            {
                "NAME": parts.path.strip("/") or "attendance_django",
                "USER": parts.username or "attendance",
                "PASSWORD": parts.password or "attendance",
                "HOST": parts.hostname or "127.0.0.1",
                "PORT": parts.port or "5433",
            }
        )

AUTH_USER_MODEL = "core.RoleUser"

# Accept legacy werkzeug-format hashes so imported Flask accounts still work
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "core.werkzeug_hasher.WerkzeugPasswordHasher",
]

# ---------------------------------------------------------------------------
# Auth / DRF
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "EXCEPTION_HANDLER": "core.exceptions.custom_exception_handler",
}

CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = True

# Session auth for dev/browsable API only (SPA uses tokens)
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE

# ---------------------------------------------------------------------------
# App storage
# ---------------------------------------------------------------------------
DATASET_DIR = os.environ.get("DATASET_DIR", str(BASE_DIR / "dataset"))
MODEL_PATH = os.environ.get("MODEL_PATH", str(BASE_DIR / "model.pkl"))
TRAIN_STATUS_FILE = os.environ.get("TRAIN_STATUS_FILE", str(BASE_DIR / "train_status.json"))
ALLOW_PUBLIC_REGISTER = os.environ.get("ALLOW_PUBLIC_REGISTER", "0") == "1"
REGISTER_INVITE_CODE = os.environ.get("REGISTER_INVITE_CODE", "").strip()
KEEP_CAPTURE_IMAGES = os.environ.get("KEEP_CAPTURE_IMAGES", "0") == "1"
MAX_CAPTURE_IMAGES = int(os.environ.get("MAX_CAPTURE_IMAGES", "48"))
MAX_CONTENT_LENGTH_MB = int(os.environ.get("MAX_CONTENT_LENGTH_MB", "20"))
# Image upload hardening (see core/image_security.py)
MAX_IMAGE_UPLOAD_MB = int(os.environ.get("MAX_IMAGE_UPLOAD_MB", "10"))
MAX_IMAGE_PIXELS = int(os.environ.get("MAX_IMAGE_PIXELS", "30000000"))
MAX_IMAGE_SIDE = int(os.environ.get("MAX_IMAGE_SIDE", "9000"))

# Django hard request-body limit (nginx also caps at 30m). Postgres-side DoS
# guard: anything over this is rejected before the view runs.
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("DATA_UPLOAD_MAX_MEMORY_SIZE", str(25 * 1024 * 1024)))

PORTAL_API_KEY = os.environ.get("PORTAL_API_KEY", "").strip()
PORTAL_PUSH_URL = os.environ.get("PORTAL_PUSH_URL", "").strip()
PORTAL_PUSH_TOKEN = os.environ.get("PORTAL_PUSH_TOKEN", "").strip()

# ---------------------------------------------------------------------------
# i18n / static
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
