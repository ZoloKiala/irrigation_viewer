"""
Django settings for production on Railway
----------------------------------------

- Uses django-environ for env vars
- Uses DATABASE_URL for Postgres
- Uses WhiteNoise for static files
"""

from pathlib import Path
import os
import environ

# ---------------------------------------------------------------------------
# Base paths & env
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)

# Optional: read a local .env file for local dev.
env_file = BASE_DIR / ".env"
if env_file.exists():
    environ.Env.read_env(env_file=str(env_file))

# ---------------------------------------------------------------------------
# Core settings
# ---------------------------------------------------------------------------

SECRET_KEY = env("SECRET_KEY", default="change-me-in-production")
DEBUG = env("DEBUG", default=False)

# Example env on Railway:
#   ALLOWED_HOSTS=irrigationviewer-production.up.railway.app,localhost,127.0.0.1
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"])

# Example:
#   CSRF_TRUSTED_ORIGINS=https://irrigationviewer-production.up.railway.app
CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS",
    default=[],
)

# Tell Django we’re behind a proxy that sets X-Forwarded-Proto
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

INSTALLED_APPS = [
    # Django core
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Your app
    "mapviewer",
]

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # static files in production

    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "irrigation_project.urls"
WSGI_APPLICATION = "irrigation_project.wsgi.application"

# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [
            BASE_DIR / "templates",
        ],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Database (PostgreSQL via DATABASE_URL)
# ---------------------------------------------------------------------------

# On Railway set:
#   DATABASE_URL = postgresql://USER:PASSWORD@HOST:PORT/DBNAME
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",  # fallback for local dev
    )
}

# ---------------------------------------------------------------------------
# Password validation
# ---------------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# ---------------------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Johannesburg"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static & media files
# ---------------------------------------------------------------------------

STATIC_URL = "/static/"

# Where collectstatic will put files (for WhiteNoise)
STATIC_ROOT = BASE_DIR / "staticfiles"

# Additional static dirs (optional global "static" folder)


# If you don't have a global "static" folder, use this:
STATICFILES_DIRS = []
# or completely delete the STATICFILES_DIRS setting


STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# ---------------------------------------------------------------------------
# Default primary key field type
# ---------------------------------------------------------------------------

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Security hardening
# ---------------------------------------------------------------------------

# You can override this from Railway with SECURE_SSL_REDIRECT=true if needed
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=False)

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

    # HSTS – only enable once you're sure HTTPS is working correctly
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30  # 30 days
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True

    SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
