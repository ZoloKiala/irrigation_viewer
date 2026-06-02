# Irrigation Viewer

A Django web application for exploring irrigation, crop‑water‑use (WaPOR), and
administrative/homeland boundaries over Southern Africa on an interactive map.
Raster layers are served from Google Earth Engine and local GeoTIFFs; the
front‑end is a MapLibre GL map with vanilla JS/HTML/CSS (no build step).

## Tech stack

- **Backend:** Django 5.2 (Python 3.12)
- **Geospatial:** Earth Engine (`earthengine-api`), `rasterio`, `rio-tiler`, `shapely`, `numpy`, `Pillow`
- **Front‑end:** MapLibre GL + Turf.js (loaded via CDN) — static JS/CSS under `mapviewer/static/`
- **Serving:** `gunicorn` + `whitenoise` (static files), SQLite by default

## Prerequisites

- Python **3.12** (see `runtime.txt`)
- A Google **Earth Engine service‑account** key (JSON) with access to the
  `tethys-app-1` project. **Never commit this file** — it's covered by
  `.gitignore`.

## Setup

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 3. Provide the Earth Engine service‑account key (choose ONE):
#    a) Point an env var at the JSON file:
export GEE_SERVICE_ACCOUNT_JSON=/path/to/your-ee-service-account.json
#    b) …or paste the JSON content directly into that env var, or
#    c) drop the key file in the project root (it is gitignored).

# 4. Initialise the database
python manage.py migrate
```

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Django secret key | `dev-secret-key-change-me` (override in prod) |
| `DJANGO_DEBUG` | `true`/`false` — debug mode | `false` |
| `GEE_SERVICE_ACCOUNT_JSON` | Path to **or** content of the EE service‑account key | _(falls back to a key file in the project root)_ |
| `PORT` | Port for gunicorn (deployment) | platform‑provided |

> Use placeholder values in any committed `.env.example`; keep real secrets in
> a local, untracked `.env` (gitignored).

## Run (development)

```bash
# DJANGO_DEBUG=true makes Django serve static files live from source
# (no collectstatic needed while iterating on JS/CSS).
DJANGO_DEBUG=true python manage.py runserver 127.0.0.1:8000
```

Open http://127.0.0.1:8000/.

With `DJANGO_DEBUG` unset/false, static files are served by WhiteNoise from
`STATIC_ROOT` (`staticfiles/`), so you must run `collectstatic` after any
JS/CSS change:

```bash
python manage.py collectstatic --noinput
```

## Test / checks

There is no `pytest` suite yet. The available check is Django's built‑in system
check, which CI also runs:

```bash
python manage.py check
```

If you add tests, place them under `tests/` or as `test_*.py` — CI will pick
them up automatically (see below).

## Deployment

The repo is configured for a Heroku‑style buildpack deploy (`Procfile` +
`runtime.txt`):

```
release: python manage.py collectstatic --noinput --clear
web: gunicorn irrigation_project.wsgi:application --bind 0.0.0.0:$PORT
```

Set `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, and `GEE_SERVICE_ACCOUNT_JSON`
(as the key **content**, since the file isn't deployed) as platform config /
secrets.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes/PRs to `main`:

- installs Python deps from `requirements.txt`,
- runs `python manage.py check`,
- runs `pytest` **if** any tests exist,
- runs Node steps **only if** a `package.json` is ever added.

Dependency updates are automated via `.github/dependabot.yml` (pip +
GitHub Actions, weekly).

## Project layout

```
irrigation_project/   Django project (settings, urls, wsgi)
mapviewer/            Main app: views (EE/tile APIs), templates, static JS/CSS
manage.py             Django management entry point
Procfile, runtime.txt Deployment config
requirements.txt      Python dependencies
```
