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

# ------------------------------------------------------------------------------
# Base paths & env
# ------------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)

# Optional: read a local .env file (useful for local dev).
# In Railway, env vars are injected directly, so this is harmless.
env_file = BASE_DIR / ".env"
if env_file.exists():
    environ.Env.read_env(env_file=str(env_file))

# ------------------------------------------------------------------------------
# Core settings
# ------------------------------------------------------------------------------

SECRET_KEY = env("SECRET_KEY", default="change-me-in-production")
DEBUG = env("DEBUG", default=False)

# Example: ALLOWED_HOSTS=irrigation-viewer.up.railway.app,localhost
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"])

# Example: CSRF_TRUSTED_ORIGINS=https://irrigation-viewer.up.railway.app
CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS",
    default=[],
)

# ------------------------------------------------------------------------------
# Applications
# ------------------------------------------------------------------------------

INSTALLED_APPS = [
    # Django core
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Your apps
    "mapviewer",
]

# ------------------------------------------------------------------------------
# Middleware
# ------------------------------------------------------------------------------

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

ROOT_URLCONF = "config.urls"  # change `config` if your project folder has another name

# ------------------------------------------------------------------------------
# Templates
# ------------------------------------------------------------------------------

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

WSGI_APPLICATION = "config.wsgi.application"  # change `config` if needed

# ------------------------------------------------------------------------------
# Database (PostgreSQL via DATABASE_URL)
# ------------------------------------------------------------------------------

# On Railway you set:
#   DATABASE_URL = postgresql://USER:PASSWORD@HOST:PORT/DBNAME
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",  # fallback for local dev
    )
}

# ------------------------------------------------------------------------------
# Password validation
# ------------------------------------------------------------------------------

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

# ------------------------------------------------------------------------------
# Internationalization
# ------------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Johannesburg"
USE_I18N = True
USE_TZ = True

# ------------------------------------------------------------------------------
# Static & media files
# ------------------------------------------------------------------------------

# Static files (CSS, JS, images)
STATIC_URL = "/static/"

# Where collectstatic will put files (for WhiteNoise)
STATIC_ROOT = BASE_DIR / "staticfiles"

# Additional static dirs (if you have a global static/ folder)
STATICFILES_DIRS = [
    BASE_DIR / "static",
]

# WhiteNoise storage
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# Media (if you ever use file uploads)
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# ------------------------------------------------------------------------------
# Default primary key field type
# ------------------------------------------------------------------------------

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ------------------------------------------------------------------------------
# Security hardening (good defaults for production)
# ------------------------------------------------------------------------------

if not DEBUG:
    # Forces HTTPS (make sure Railway is terminating SSL in front)
    SECURE_SSL_REDIRECT = True

    # Cookie security
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

    # HSTS (only enable after you’re sure HTTPS works)
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30  # 30 days
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True

    # Optional: Referrer policy
    SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
