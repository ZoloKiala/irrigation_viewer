# mapviewer/views.py
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

import rasterio  # used by the WaPOR local-tile endpoint



# ----------------------------------------------------------------------
# Sidebar layers shown in the template
# ----------------------------------------------------------------------
# `label` is the English fallback rendered server-side; `label_key` is looked up
# client-side in IV_TRANSLATIONS (mapviewer/static/mapviewer/ui.js) for live i18n.
# `country` is the dropdown value the layer belongs to — used to filter the
# sidebar tree when the user changes country.
LAYERS: List[Dict[str, str]] = [
    # Irrigation suitability (assets) — Zimbabwe
    {
        "id": "ASSET_MANICALAND",
        "label": "Manicaland — suitability",
        "label_key": "layer_asset_manicaland",
        "dataset": "projects/tethys-app-1/assets/Manicaland",
        "country": "Zimbabwe",
    },
    {
        "id": "ASSET_MAT_NORTH",
        "label": "Matabeleland North — suitability",
        "label_key": "layer_asset_mat_north",
        "dataset": "projects/tethys-app-1/assets/Matebeleland_North",
        "country": "Zimbabwe",
    },
    {
        "id": "ASSET_MAT_SOUTH",
        "label": "Matabeleland South — suitability",
        "label_key": "layer_asset_mat_south",
        "dataset": "projects/tethys-app-1/assets/Mat_south",
        "country": "Zimbabwe",
    },
    {
        "id": "ASSET_MASVINGO",
        "label": "Masvingo — suitability",
        "label_key": "layer_asset_masvingo",
        "dataset": "projects/tethys-app-1/assets/Masvingo",
        "country": "Zimbabwe",
    },
    # Admin boundaries — Zimbabwe
    {
        "id": "ZWE_L1",
        "label": "Zimbabwe — Admin Level 1 (Provinces)",
        "label_key": "layer_zwe_l1",
        "dataset": "BOUNDARY_ZWE_L1",
        "country": "Zimbabwe",
    },
    {
        "id": "ZWE_L2",
        "label": "Zimbabwe — Admin Level 2 (Districts)",
        "label_key": "layer_zwe_l2",
        "dataset": "BOUNDARY_ZWE_L2",
        "country": "Zimbabwe",
    },
    {
        "id": "ZWE_L3",
        "label": "Zimbabwe — Admin Level 3 (Wards)",
        "label_key": "layer_zwe_l3",
        "dataset": "BOUNDARY_ZWE_L3",
        "country": "Zimbabwe",
    },
    # Admin boundaries — South Africa (FAO/GAUL/2015 levels 1 & 2)
    {
        "id": "ZAF_L1",
        "label": "South Africa — Admin Level 1 (Provinces)",
        "label_key": "layer_zaf_l1",
        "dataset": "BOUNDARY_ZAF_L1",
        "country": "South Africa",
    },
    {
        "id": "ZAF_L2",
        "label": "South Africa — Admin Level 2 (Districts)",
        "label_key": "layer_zaf_l2",
        "dataset": "BOUNDARY_ZAF_L2",
        "country": "South Africa",
    },
    {
        "id": "ZAF_HOMELANDS",
        "label": "South Africa — Homelands (pre-1994)",
        "label_key": "layer_zaf_homelands",
        "dataset": "BOUNDARY_ZAF_L4",
        "country": "South Africa",
    },
    # Irrigation maps — backed by an EE ImageCollection. has_date_picker
    # tells the frontend to render a month + band selector inline with the
    # checkbox; the dataset value is rebuilt as "IRR_SA_<iso>?<band>" each
    # time the picker changes.
    {
        "id": "ZAF_IRRIGATION_MONTHLY",
        "label": "South Africa — Irrigation (monthly)",
        "label_key": "layer_zaf_irrigation_monthly",
        "dataset": "IRR_SA_2025-07?filtered",
        "country": "South Africa",
        "has_date_picker": True,
        "ic_kind": "irrigation",
    },
    {
        "id": "ZAF_WAPOR_DEKADAL",
        "label": "South Africa — Crop water use (dekadal)",
        "label_key": "layer_zaf_wapor_dekadal",
        "dataset": "WAPOR_SA_2025-07?D2",
        "country": "South Africa",
        "has_date_picker": True,
        "ic_kind": "wapor",
    },
]



# ----------------------------------------------------------------------
# Earth Engine init (service account or default)
# ----------------------------------------------------------------------
_EE_INIT_DONE: bool = False
_EE_INIT_ERROR: Optional[str] = None


def _init_ee() -> bool:
    """
    Initialize Earth Engine using (1) env var path to key, (2) settings path,
    (3) default JSON at BASE_DIR, or (4) default credentials.
    """
    global _EE_INIT_DONE, _EE_INIT_ERROR
    if _EE_INIT_DONE:
        return True
    try:
        import ee  # type: ignore
    except Exception:
        _EE_INIT_ERROR = "Earth Engine SDK not installed."
        return False

    key_path: Optional[Path] = None
    key_data: Optional[str] = None  # raw JSON string (e.g. Railway env var)

    # 1) Env var — accepts either a file path OR the raw JSON content
    env_value = os.environ.get("GEE_SERVICE_ACCOUNT_JSON")
    if env_value:
        stripped = env_value.strip()
        if stripped.startswith("{"):
            key_data = stripped
        else:
            p = Path(env_value)
            if p.exists():
                key_path = p

    # 2) settings
    if key_path is None and key_data is None:
        cfg_path = getattr(settings, "GEE_SERVICE_ACCOUNT_JSON", None)
        if cfg_path:
            p = Path(cfg_path)
            if p.exists():
                key_path = p

    # 3) default filename at BASE_DIR — keep both the current key and any
    # previously-rotated keys so a stale .json in the working tree never
    # silently masks the real one. First match wins.
    if key_path is None:
        base = Path(getattr(settings, "BASE_DIR", "."))
        for candidate in (
            "tethys-app-1-087d23478872.json",  # active key
            "tethys-app-1-acc3960d3dd6.json",  # previous (revoked)
        ):
            p = base / candidate
            if p.exists():
                key_path = p
                break

    try:
        import ee  # type: ignore

        # Pin compute to the service-account's own project so that EE runs
        # under `tethys-app-1` (not the default `earthengine-legacy`).
        # Without this, tiles built from per-homeland uploaded assets (which
        # live under `projects/tethys-app-1/assets/`) come back blank even
        # though the image computation succeeds -- different project context
        # routes the tile-fetch through a path that masks the result.
        if key_data:
            data = json.loads(key_data)
            service_account = data.get("client_email")
            project_id = data.get("project_id") or "tethys-app-1"
            if not service_account:
                raise RuntimeError("client_email missing in service account JSON")
            creds = ee.ServiceAccountCredentials(service_account, key_data=key_data)
            ee.Initialize(creds, project=project_id)
        elif key_path and key_path.exists():
            with key_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            service_account = data.get("client_email")
            project_id = data.get("project_id") or "tethys-app-1"
            if not service_account:
                raise RuntimeError("client_email missing in service account JSON")
            creds = ee.ServiceAccountCredentials(service_account, str(key_path))
            ee.Initialize(creds, project=project_id)
        else:
            ee.Initialize()
        _EE_INIT_DONE = True
        _EE_INIT_ERROR = None
        return True
    except Exception as e:  # environment-dependent
        _EE_INIT_ERROR = f"Earth Engine initialization failed: {e}"
        return False


# ----------------------------------------------------------------------
# Template view
# ----------------------------------------------------------------------
def index(request: HttpRequest) -> HttpResponse:
    """Landing page — showcases the app's use cases."""
    suit = [l for l in LAYERS if l["dataset"].startswith("projects/")
            and not l["id"].startswith("SOC_")
            and l.get("country", "Zimbabwe") == "Zimbabwe"]
    irrigation = [l for l in LAYERS if l.get("ic_kind") == "irrigation"]

    groups = [
        {
            "id": "zwe-suitability",
            "icon": "bi-droplet-half",
            "title": "Zimbabwe — irrigation suitability",
            "desc": (
                "Multi-criteria N / S1 / S2 / S3 rasters across Zimbabwean "
                "provinces. Combine with admin boundaries to target investments."
            ),
            "countries": ["Zimbabwe"],
            "sample": [l["label"] for l in suit][:4],
            "count": len(suit),
            "coming_soon": False,
        },
        {
            "id": "zaf-irrigation",
            "icon": "bi-calendar3",
            "title": "South Africa — monthly irrigation in former homelands",
            "desc": (
                "Sentinel-2 + Dynamic World irrigation masks across pre-1994 "
                "homeland boundaries. Track seasonal change district-by-district."
            ),
            "countries": ["South Africa"],
            "sample": ["Filtered band", "Probability band", "Raw band", "Homeland boundaries"],
            "count": len(irrigation),
            "coming_soon": False,
        },
        {
            "id": "ago-coming",
            "icon": "bi-hourglass-split",
            "title": "Angola — coming soon",
            "desc": (
                "Layer suite under construction. Admin boundaries and irrigation "
                "suitability will follow the Zimbabwe template."
            ),
            "countries": ["Angola"],
            "sample": [],
            "count": 0,
            "coming_soon": True,
        },
    ]

    return render(request, "mapviewer/landing.html", {"groups": groups})


def map_view(request: HttpRequest) -> HttpResponse:
    """The map application itself."""
    return render(request, "mapviewer/index.html", {"layers": LAYERS})


# ----------------------------------------------------------------------
# GAUL / boundary helpers
# ----------------------------------------------------------------------
# Sentinel format: "BOUNDARY_<ISO>_L<level>"  e.g. "BOUNDARY_ZAF_L1".
# Per-country path maps lets us mix shared FAO/GAUL paths with custom assets
# (e.g. ZWE level 3 uses a custom wards collection that ZAF doesn't have).
_GAUL_PATHS_BY_COUNTRY: Dict[str, Dict[int, str]] = {
    "ZWE": {
        1: "FAO/GAUL/2015/level1",
        2: "FAO/GAUL/2015/level2",
        3: "projects/tethys-app-1/assets/ZWE_ADM3_wards_2025",
    },
    "ZAF": {
        1: "FAO/GAUL/2015/level1",
        2: "FAO/GAUL/2015/level2",
        # No level-3 asset for South Africa (yet) — wards equivalent not configured.
        # Level 4 is a custom asset of the pre-1994 homeland / Bantustan boundaries.
        4: "projects/tethys-app-1/assets/homeland_boundary",
    },
}

_BOUNDARY_COUNTRY_NAME: Dict[str, str] = {
    "ZWE": "Zimbabwe",
    "ZAF": "South Africa",
}

# Suitability raster palettes, keyed by name. The frontend Tweaks panel
# sends ?palette=<name> on /api/gee/map/ to repaint the EE tile.
# Order: [N, S1, S2, S3] — class indices 0..3.
_SUITABILITY_PALETTES: Dict[str, List[str]] = {
    "verdant": ["#f1e5cd", "#166534", "#22c55e", "#fde047"],
    "heatmap": ["#1e3a8a", "#b91c1c", "#f97316", "#facc15"],
    "earthen": ["#c4b59c", "#134e4a", "#0f766e", "#d97706"],
}

# South Africa monthly irrigation ImageCollection. Built by
# notebooks/monthly_irrigation_ic.ipynb. Three bands: raw, probability, filtered.
_SA_IRRIGATION_IC = "projects/tethys-app-1/assets/sa_irrigation_monthly"
_SA_IRRIGATION_BANDS = {"raw", "probability", "filtered"}

# Per-homeland chunked exports from extract_homeland_chunked.py. Each folder
# contains many `chunk_NNNN_<band>` images that together cover one homeland.
# Mosaicked server-side into the SA-Irrigation map so partial homeland
# coverage shows up even though those images aren't members of
# `sa_irrigation_monthly`.
_HOMELAND_CHUNK_PARENT = "projects/tethys-app-1/assets"
# Empty: `irrigated_kwandebele` was deleted on 2026-05-21 to free EE asset
# storage (it had 1,258 chunked images eating ~tens of GiB of the 250 GiB
# noncommercial quota). The consolidated `<slug>_<period>_10m_<band>`
# uploads handled by `_homeland_uploaded_mosaic` replace them.
_HOMELAND_CHUNK_FOLDERS: List[str] = []


def _homeland_chunk_mosaic_for_band(band: str):
    """Return an `ee.Image` that mosaics every `chunk_*_<band>` asset across
    all configured homeland folders, or None if nothing is available.

    Listing is cached for 5 minutes so the viewer's gee_map endpoint doesn't
    do an EE listAssets call per page load.
    """
    import ee  # noqa: F401 -- imported per-function elsewhere in this module
    if band not in _SA_IRRIGATION_BANDS:
        return None
    cache_key = f"iv:homeland_chunks:{band}"
    asset_ids = cache.get(cache_key)
    if asset_ids is None:
        asset_ids = []
        for folder in _HOMELAND_CHUNK_FOLDERS:
            try:
                listing = ee.data.listAssets({"parent": folder})
                items = listing.get("assets", [])
                while listing.get("nextPageToken"):
                    listing = ee.data.listAssets(
                        {"parent": folder, "pageToken": listing["nextPageToken"]}
                    )
                    items.extend(listing.get("assets", []))
            except Exception:
                continue
            for a in items:
                name = a["name"]
                if name.endswith(f"_{band}"):
                    asset_ids.append(name)
        cache.set(cache_key, asset_ids, timeout=300)
    if not asset_ids:
        return None
    # Rename each chunk's lone band to the target band name so this mosaic
    # composes cleanly with the SA IC (whose images have named bands
    # raw/filtered/probability) and the uploaded-homeland mosaic (also
    # renamed). Without this rename the resulting image has both a `b1`
    # band and a `<band>` band; EE's default visualize falls through to
    # the alphabetically-first band (`b1`), which is masked outside the
    # chunked-job's footprint -- the bug that caused blank tiles over
    # CISKEI when chunks + uploaded were both in the layer chain.
    images = [ee.Image(a).rename(band) for a in asset_ids]
    return ee.ImageCollection.fromImages(images).mosaic()


# Per-homeland uploaded assets from scripts/port/port_irrigation.py outputs
# (manually ingested via the EE Code Editor). Asset name convention:
#   projects/tethys-app-1/assets/<slug>_<YYYY-MM>_10m_<band>
# where <band> is one of raw / filtered / probability. Each asset is a single-
# band image whose lone band is named `b1` (the EE upload default).
_HOMELAND_SLUGS = [
    "kwandebele", "qwaqwa", "ciskei", "kangwana", "venda",
    "gazankulu", "lebowa", "transkei", "kwazulu", "bophuthatswana",
]


def _homeland_uploaded_mosaic(iso_period: str, band: str):
    """Mosaic of per-homeland uploaded assets for the given period+band, or
    None if no such assets exist yet.

    Each uploaded image has a single band named `b1`; we rename it to
    `band` so it composes cleanly with the SA IC's named bands.

    The earlier implementation issued one `ee.data.getAsset` per homeland
    slug per cache-miss (10 sequential API calls) which trips EE's
    request-rate limit while the project is in restricted-quota mode.
    Replaced with a single paginated `listAssets` of the project's asset
    root, then a local name-match against the slug set. Cached for 5 min.
    """
    import time
    import ee
    if band not in _SA_IRRIGATION_BANDS:
        return None
    cache_key = f"iv:homeland_uploaded:{iso_period}:{band}"
    asset_ids = cache.get(cache_key)
    if asset_ids is None:
        wanted_suffixes = {
            f"{slug}_{iso_period}_10m_{band}" for slug in _HOMELAND_SLUGS
        }
        # One listAssets call (paginated) instead of N getAsset calls.
        # Backoff retry: EE in restricted mode 429s aggressively; one
        # extra attempt with a short pause clears most transient bursts.
        parent = "projects/tethys-app-1/assets"
        items: List[Dict[str, Any]] = []
        for attempt in (1, 2, 3):
            try:
                listing = ee.data.listAssets({"parent": parent})
                items = listing.get("assets", [])
                while listing.get("nextPageToken"):
                    listing = ee.data.listAssets(
                        {"parent": parent, "pageToken": listing["nextPageToken"]}
                    )
                    items.extend(listing.get("assets", []))
                break
            except Exception:
                if attempt == 3:
                    # Cache an empty result briefly so we don't hammer the
                    # rate-limited backend; let it heal naturally.
                    cache.set(cache_key, [], timeout=60)
                    return None
                time.sleep(2 * attempt)

        asset_ids = []
        for a in items:
            name = a.get("name", "")
            short = name.rsplit("/", 1)[-1]
            if short in wanted_suffixes and a.get("type") == "IMAGE":
                asset_ids.append(name)
        cache.set(cache_key, asset_ids, timeout=300)
    if not asset_ids:
        return None
    images = [ee.Image(a).rename(band) for a in asset_ids]
    return ee.ImageCollection.fromImages(images).mosaic()

# Crop water use (WaPOR 20 m downscaled). One local GeoTIFF per dekad; tiles
# are produced on demand by ``wapor_tile`` using rio-tiler. The "dekad" key
# matches the suffix sent in the dataset string ``WAPOR_SA_2025-07?D2``.
_WAPOR_LOCAL_ROOT = Path(__file__).resolve().parent.parent.parent / "out" / "wapor"
_WAPOR_DEKAD_TO_DATE = {
    "D1": "2025-07-01",
    "D2": "2025-07-11",
    "D3": "2025-07-21",
}
_WAPOR_PERIOD_LABELS = {"2025-07": "July 2025"}

# WaPOR is served from EE assets ingested from the merged mosaics
# (projects/tethys-app-1/assets/wapor_<dekad_date>), so the DEPLOYED app can
# display it without the local out/wapor/*.tif files being present on the
# server. (The local rio-tiler endpoint `wapor_tile` is kept for direct/dev
# use but is no longer what gee_map points the viewer at.)
_WAPOR_ASSET_PREFIX = "projects/tethys-app-1/assets/wapor_"
# Discrete approximation of matplotlib 'turbo' (the local renderer's colormap)
# so the EE-served layer looks consistent with the legend.
_WAPOR_PALETTE = [
    "30123b", "4145ab", "4675ed", "39a2fc", "1bcfd4", "24eca6",
    "61fc6c", "a4fc3b", "d1e834", "f3c63a", "fe9b2d", "f36315",
    "cb2a04", "7a0403",
]
# Per-dekad linear stretch (p2..p98 measured from the ingested mosaics). The
# EE project is compute-throttled, so these are hardcoded rather than computed
# via reduceRegion on every request.
_WAPOR_STRETCH = {
    "2025-07-01": (9.8, 23.9),
    "2025-07-11": (8.9, 19.2),
    "2025-07-21": (10.4, 21.4),
}


def _wapor_rescale_for(tif_path: Path) -> tuple[float, float]:
    """Return (vmin, vmax) at p2 / p98 of the mosaic, for legend display only.

    The tile renderer uses quantile stretching (_wapor_quantile_lut), so the
    rescale here is just what we expose on the legend axis to give a viewer
    an honest idea of the data range. Cached for 24 h.
    """
    key = f"iv:wapor_rescale_v3:{tif_path.name}"
    cached = cache.get(key)
    if cached:
        return cached
    try:
        import numpy as np
        with rasterio.open(tif_path) as src:
            a = src.read(1)
            valid = a[(a != src.nodata) & np.isfinite(a)]
            if valid.size == 0:
                return (0.0, 30.0)
            lo, hi = float(np.percentile(valid, 2)), float(np.percentile(valid, 98))
            if hi - lo < 1e-3:
                hi = lo + 1.0
    except Exception:
        return (0.0, 30.0)
    cache.set(key, (lo, hi), timeout=24 * 60 * 60)
    return (lo, hi)


def _wapor_quantile_lut(tif_path: Path):
    """Return a sorted sample of valid mosaic values for quantile lookup.

    Used by ``wapor_tile`` to remap each tile pixel to its quantile in the
    full-mosaic distribution, so adjacent fields with similar ETa values get
    distinguishable colors regardless of how tightly the data clusters.
    """
    key = f"iv:wapor_quantile_lut_v1:{tif_path.name}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    import numpy as np
    with rasterio.open(tif_path) as src:
        a = src.read(1)
        valid = a[(a != src.nodata) & np.isfinite(a)]
    if valid.size > 20000:
        rng = np.random.default_rng(0)
        valid = rng.choice(valid, 20000, replace=False)
    sorted_vals = np.sort(valid).astype("float32")
    cache.set(key, sorted_vals, timeout=24 * 60 * 60)
    return sorted_vals


def _parse_irrigation_dataset(dataset: str):
    """Parse 'IRR_SA_2024-06?filtered' -> ('2024-06', 'filtered'). Returns
    None for non-irrigation inputs."""
    if not dataset or not dataset.startswith("IRR_SA_"):
        return None
    rest = dataset[len("IRR_SA_"):]
    iso, _, band = rest.partition("?")
    band = band or "filtered"
    if band not in _SA_IRRIGATION_BANDS:
        return None
    if not iso:
        return None
    return iso, band


def _parse_wapor_dataset(dataset: str):
    """Parse 'WAPOR_SA_2025-07?D2' -> ('2025-07', 'D2', '2025-07-11')."""
    if not dataset or not dataset.startswith("WAPOR_SA_"):
        return None
    rest = dataset[len("WAPOR_SA_"):]
    iso, _, dekad = rest.partition("?")
    dekad = (dekad or "D2").upper()
    if dekad not in _WAPOR_DEKAD_TO_DATE:
        return None
    return iso, dekad, _WAPOR_DEKAD_TO_DATE[dekad]


def _parse_boundary_dataset(dataset: str):
    """Parse 'BOUNDARY_ZAF_L1' -> ('ZAF', 1) or None for non-boundary inputs."""
    if not dataset or not dataset.startswith("BOUNDARY_"):
        return None
    rest = dataset[len("BOUNDARY_"):]  # e.g. "ZAF_L1"
    if "_L" not in rest:
        return None
    iso, _, lvl = rest.partition("_L")
    try:
        return iso, int(lvl)
    except ValueError:
        return None


# Back-compat alias kept in case any caller still imports it.
_GAUL_PATHS: Dict[int, str] = _GAUL_PATHS_BY_COUNTRY["ZWE"]

# If your ward asset uses different field names, update the level-3 entries.
_GAUL_NAME: Dict[int, str] = {
    1: "ADM1_NAME",
    2: "ADM2_NAME",
    3: "ADM3_NAME",
    # Custom homeland_boundary asset (ZAF level 4) — its name field is "NAME"
    4: "NAME",
}
_GAUL_CODE: Dict[int, str] = {
    1: "ADM1_CODE",
    2: "ADM2_CODE",
    3: "ADM3_CODE",
    # homeland_boundary asset has no separate code field — fall back to NAME
    # so click-to-analyze still has something stable to key off.
    4: "NAME",
}


def _ee_geom_from_geojson(geo: Dict[str, Any]):
    import ee  # type: ignore
    # Let Earth Engine handle defaults; no manual geodesic/maxError here
    return ee.Geometry(geo)


def _bounds_from_ee_geometry(geometry) -> Optional[Dict[str, float]]:
    """Return a small south/west/north/east dict for an EE geometry."""
    try:
        ring = geometry.bounds().coordinates().getInfo()[0]
        lons = [pt[0] for pt in ring]
        lats = [pt[1] for pt in ring]
        return {
            "south": min(lats),
            "west": min(lons),
            "north": max(lats),
            "east": max(lons),
        }
    except Exception:
        return None



def _label_for_class(v: int) -> str:
    # Adjust for your class encoding if needed
    return {0: "N", 1: "S1", 2: "S2", 3: "S3"}.get(int(v), str(v))


# ----------------------------------------------------------------------
# /api/gee/map/  -> EE tile for dataset (assets or GAUL vector style)
# ----------------------------------------------------------------------
# --------------------------------------------------------------------------
# /api/gee/map/  -> EE tile for dataset (images, GAUL boundaries, socio FCs)
# --------------------------------------------------------------------------
SOCIO_FC_LAYERS = {
    "projects/tethys-app-1/assets/masvingo_irrigation_schemes",
    "projects/tethys-app-1/assets/solar_pump_providers",
    "projects/tethys-app-1/assets/matebeland_south_irrigation_schemes",
    "projects/tethys-app-1/assets/mashonaland_central_irrigation_schemes",
}


def gee_map(request: HttpRequest) -> JsonResponse:
    dataset = request.GET.get("dataset") or request.POST.get("dataset")
    if not dataset:
        return JsonResponse({"error": "Missing 'dataset' parameter"}, status=400)

    # Suitability palette name (verdant/heatmap/earthen). Falls back to
    # verdant for unknown values so a stale client never breaks the tile.
    palette_name = (request.GET.get("palette") or "verdant").lower()
    palette_colors = _SUITABILITY_PALETTES.get(
        palette_name, _SUITABILITY_PALETTES["verdant"]
    )

    if not _init_ee():
        return JsonResponse(
            {
                "dataset": dataset,
                "configured": False,
                "message": _EE_INIT_ERROR or "Earth Engine not initialized",
                "tile_url": None,
            }
        )

    try:
        import ee  # type: ignore

        image = None
        vis: Dict[str, Any] = {}
        bounds: Optional[Dict[str, float]] = None

        # --------------------------------------------------------------
        # 1) GAUL boundaries via FAO/GAUL (styled black line)
        # --------------------------------------------------------------
        parsed = _parse_boundary_dataset(dataset)
        if parsed:
            iso, level = parsed
            country_name = _BOUNDARY_COUNTRY_NAME.get(iso)
            if not country_name:
                return JsonResponse(
                    {
                        "configured": True,
                        "message": f"Unsupported boundary country code: {iso}",
                        "tile_url": None,
                    },
                    status=400,
                )

            path = _GAUL_PATHS_BY_COUNTRY.get(iso, {}).get(level)
            if not path:
                return JsonResponse(
                    {
                        "configured": True,
                        "message": f"Unsupported level {level} for {country_name}",
                        "tile_url": None,
                    },
                    status=400,
                )

            try:
                fc = ee.FeatureCollection(path).filter(
                    ee.Filter.eq("ADM0_NAME", country_name)
                )
            except Exception as e:
                return JsonResponse(
                    {
                        "configured": False,
                        "message": f"Failed to load GAUL L{level} for {country_name}: {e}",
                        "tile_url": None,
                    },
                    status=200,
                )

            # black outlines, transparent fill
            image = fc.style(
                color="#000000",  # black boundary
                width=2,
                fillColor="00000000",
            )
            vis = {}

            # Country bounds for nice zoom
            country = ee.FeatureCollection("FAO/GAUL/2015/level0").filter(
                ee.Filter.eq("ADM0_NAME", country_name)
            )
            bounds = _bounds_from_ee_geometry(country.geometry())

        # --------------------------------------------------------------
        # 2c) South Africa WaPOR dekadal crop water use (EE asset)
        # --------------------------------------------------------------
        elif _parse_wapor_dataset(dataset):
            iso, dekad, dekad_date = _parse_wapor_dataset(dataset)
            asset_id = f"{_WAPOR_ASSET_PREFIX}{dekad_date}"
            try:
                # Single-band (b1) ETa mosaic. Mask NoData (-9999) and any
                # non-positive values so they render transparent.
                wimg = ee.Image(asset_id).select(0)
                wimg = wimg.updateMask(wimg.neq(-9999).And(wimg.gt(0)))
                # The asset is in EPSG:4326; tiles are reprojected to
                # web-mercator. With the default 'nearest' resampling that
                # reprojection shows blocky per-tile seams (the "tiled
                # effect"). Resample bilinearly AFTER masking (so -9999 never
                # interpolates across the NoData edge) to render smoothly.
                wimg = wimg.resample("bilinear")
                image = wimg
                bounds = _bounds_from_ee_geometry(ee.Image(asset_id).geometry())
            except Exception as e:
                return JsonResponse(
                    {
                        "dataset": dataset,
                        "configured": False,
                        "message": (
                            f"WaPOR asset not available for {dekad_date} "
                            f"({asset_id}): {e}"
                        ),
                        "tile_url": None,
                    },
                    status=200,
                )
            lo, hi = _WAPOR_STRETCH.get(dekad_date, (9.0, 23.0))
            vis = {"min": lo, "max": hi, "palette": _WAPOR_PALETTE}
            # image / vis / bounds are set above; fall through to the shared
            # getMapId tile-URL builder + JSON payload below.

        # --------------------------------------------------------------
        # 2b) South Africa monthly irrigation ImageCollection
        # --------------------------------------------------------------
        elif _parse_irrigation_dataset(dataset):
            iso, band = _parse_irrigation_dataset(dataset)
            try:
                ic = ee.ImageCollection(_SA_IRRIGATION_IC)
                # `.mosaic()` instead of `.first()`: if more than one image
                # exists for this iso_period (e.g. SA-wide IC image plus a
                # later-ingested homeland tile), they're merged. Also
                # tolerates an empty match -- `mosaic` of an empty IC is an
                # all-masked image, which then gets layered under the
                # homeland chunks below.
                sa_image = (
                    ic.filter(ee.Filter.eq("iso_period", iso))
                      .select(band)
                      .mosaic()
                )
                # Layer per-homeland uploaded outputs on top (these are the
                # locally-classified rasters ingested via Code Editor as
                # `<slug>_<iso>_10m_<band>` assets). Falls back to the
                # older `irrigated_<slug>/chunk_*` folders if uploaded
                # assets don't exist yet for this period+band.
                uploaded = _homeland_uploaded_mosaic(iso, band)
                chunks = _homeland_chunk_mosaic_for_band(band)
                layers = [sa_image]
                if uploaded is not None:
                    layers.append(uploaded)
                if chunks is not None:
                    layers.append(chunks)
                image = (
                    ee.ImageCollection(layers).mosaic()
                    if len(layers) > 1 else sa_image
                )
            except Exception as e:
                return JsonResponse(
                    {
                        "dataset": dataset,
                        "configured": False,
                        "message": f"Irrigation period not available: {iso} ({e})",
                        "tile_url": None,
                    },
                    status=200,
                )

            if band == "probability":
                vis = {"min": 0, "max": 1,
                       "palette": ["#ffffff", "#00ffff", "#0000fa"]}
            else:
                # raw / filtered: any non-zero pixel is irrigated. Tolerate both
                # the {0,1} raw encoding and the {0,1,2} post-mode filtered
                # encoding by collapsing to a binary mask before rendering.
                image = image.gt(0).selfMask()
                vis = {"min": 1, "max": 1, "palette": ["#1a9641"]}

            # We mosaic across the SA IC + any homeland chunks, so bounds are
            # always SA-wide. Frontend's fitBounds for IRR_SA_ will zoom to
            # the country extent.
            country = ee.FeatureCollection("FAO/GAUL/2015/level0").filter(
                ee.Filter.eq("ADM0_NAME", "South Africa")
            )
            bounds = _bounds_from_ee_geometry(country.geometry())

        # --------------------------------------------------------------
        # 2) Socio-economic layers – known FeatureCollections
        # --------------------------------------------------------------
        elif dataset in SOCIO_FC_LAYERS:
            try:
                fc = ee.FeatureCollection(dataset)
            except Exception as e:
                return JsonResponse(
                    {
                        "dataset": dataset,
                        "configured": False,
                        "message": f"Unsupported or inaccessible socio asset: {e}",
                        "tile_url": None,
                    },
                    status=200,
                )

            # Style as overlay: bright cyan points/lines/polygons, no fill
            image = fc.style(
                color="#22d3ee",
                width=2,
                pointSize=6,
                pointShape="circle",
                fillColor="00000000",
            )
            vis = {}

            # Try to compute bounds of the layer
            bounds = _bounds_from_ee_geometry(fc.geometry())

        # --------------------------------------------------------------
        # 3) Default: try as Image, fallback to generic FC style
        # --------------------------------------------------------------
        else:
            try:
                # Try as image (e.g. suitability rasters)
                img = ee.Image(dataset)
                _ = img.bandNames()  # forces Image.load / will throw if not image
                image = img
                # Suitability palette (verdant / heatmap / earthen) selected
                # by the Tweaks panel; harmless for other rasters too.
                vis = {
                    "min": 0,
                    "max": 3,
                    "palette": palette_colors,
                }
                bounds = _bounds_from_ee_geometry(img.geometry())
            except Exception:
                # Not an image → try FeatureCollection and style it
                try:
                    fc = ee.FeatureCollection(dataset)
                    image = fc.style(
                        color="#22c55e",
                        width=2,
                        pointSize=5,
                        fillColor="00000000",
                    )
                    vis = {}
                    bounds = _bounds_from_ee_geometry(fc.geometry())
                except Exception as e:
                    return JsonResponse(
                        {
                            "dataset": dataset,
                            "configured": False,
                            "message": f"Unsupported or inaccessible asset: {e}",
                            "tile_url": None,
                        },
                        status=200,
                    )
        # --------------------------------------------------------------
        # Build tile URL
        # --------------------------------------------------------------
        if image is None:
            return JsonResponse(
                {
                    "dataset": dataset,
                    "configured": False,
                    "message": "No image could be created for this dataset.",
                    "tile_url": None,
                },
                status=200,
            )

        md = image.getMapId(vis)
        tile_url = None
        try:
            fetcher = md.get("tile_fetcher")
            if fetcher is not None:
                tile_url = getattr(fetcher, "url_format", None)
        except Exception:
            tile_url = None

        if not tile_url:
            mapid = md.get("mapid")
            token = md.get("token")
            tile_url = (
                f"https://earthengine.googleapis.com/v1/projects/earthengine-legacy"
                f"/maps/{mapid}/tiles/{{z}}/{{x}}/{{y}}?token={token}"
            )

        payload: Dict[str, Any] = {
            "dataset": dataset,
            "configured": True,
            "tile_url": tile_url,
            "attribution": "Map data © Google Earth Engine",
        }
        if bounds:
            payload["bounds"] = bounds

        # Never let the browser cache this response: the tile_url embeds a
        # short-lived EE mapid, and a stale cached response makes the viewer
        # keep requesting old/again-different tiles (seen as a "tiled"/stale
        # overlay even after a reload).
        resp = JsonResponse(payload)
        resp["Cache-Control"] = "no-store"
        return resp

    except Exception as e:
        return JsonResponse(
            {
                "dataset": dataset,
                "configured": False,
                "message": f"Unhandled error in gee_map: {e}",
                "tile_url": None,
            },
            status=200,
        )


# ----------------------------------------------------------------------
# /api/gee/thumbnail/  -> static PNG thumbnail of a dataset
# ----------------------------------------------------------------------
# Used by the landing-page carousel. Resolved EE thumb URLs are cached
# server-side for 6 h so each landing-page hit doesn't pay an EE round-trip.
@require_GET
def gee_thumbnail(request: HttpRequest):
    dataset = (request.GET.get("dataset") or "").strip()
    if not dataset:
        return JsonResponse({"error": "Missing 'dataset' parameter"}, status=400)

    try:
        dim = max(200, min(1024, int(request.GET.get("dim", 600))))
    except ValueError:
        dim = 600

    palette_name = (request.GET.get("palette") or "verdant").lower()
    palette_colors = _SUITABILITY_PALETTES.get(
        palette_name, _SUITABILITY_PALETTES["verdant"]
    )

    # Static fallback served when EE/getThumbURL fails — guarantees the
    # carousel never shows a broken image even if the EE round-trip fails
    # (auth, asset unavailable, network blip, cold start, token rejected,
    # ...). We proxy the PNG bytes server-side so a 401 from EE is caught
    # here and replaced with the fallback, instead of being shown to the
    # browser as a broken image.
    from django.templatetags.static import static
    fallback_url = static("mapviewer/irrigation_hero.jpg")

    def _fallback(reason: str) -> HttpResponse:
        resp = HttpResponseRedirect(fallback_url)
        resp["X-Thumb-Fallback-Reason"] = reason[:250]
        return resp

    # Cache the PNG bytes (not the EE URL). EE thumbnail tokens are
    # short-lived and sometimes rejected even right after generation,
    # so once we have valid bytes, hold onto them for 6 h.
    cache_key = "iv:thumb_png:" + hashlib.sha1(
        f"{dataset}|{palette_name}|{dim}".encode("utf-8")
    ).hexdigest()
    cached_bytes = cache.get(cache_key)
    if cached_bytes:
        return HttpResponse(cached_bytes, content_type="image/png")

    if not _init_ee():
        return _fallback(_EE_INIT_ERROR or "Earth Engine not initialized")

    try:
        import ee  # type: ignore

        image = None
        thumb_params: Dict[str, Any] = {"dimensions": dim, "format": "png"}

        irr = _parse_irrigation_dataset(dataset)
        if irr:
            iso, band = irr
            ic = ee.ImageCollection(_SA_IRRIGATION_IC)
            img = ic.filter(ee.Filter.eq("iso_period", iso)).first()
            _ = img.bandNames().getInfo()  # raises if period missing
            image = ee.Image(img).select(band)
            if band == "probability":
                thumb_params.update(
                    {"min": 0, "max": 1, "palette": ["#ffffff", "#00ffff", "#0000fa"]}
                )
            else:
                # See gee_map() — collapse to binary so {0,1,2} also renders.
                image = image.gt(0).selfMask()
                thumb_params.update({"min": 1, "max": 1, "palette": ["#1a9641"]})
            country = ee.FeatureCollection("FAO/GAUL/2015/level0").filter(
                ee.Filter.eq("ADM0_NAME", "South Africa")
            )
            thumb_params["region"] = country.geometry().bounds()

        else:
            try:
                img = ee.Image(dataset)
                _ = img.bandNames()  # touches the asset
                image = img
                thumb_params.update(
                    {"min": 0, "max": 3, "palette": palette_colors}
                )
                thumb_params["region"] = img.geometry().bounds()
            except Exception as e:
                return _fallback(f"Unsupported dataset: {dataset} ({e})")

        url = image.getThumbURL(thumb_params)
    except Exception as e:
        return _fallback(f"getThumbURL failed: {e}")

    # Proxy the bytes through Django so the browser never sees the EE
    # URL — sidesteps client-side token-validation issues.
    import urllib.request
    import urllib.error
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "irrigation-viewer/1.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            ctype = r.headers.get("Content-Type", "image/png")
        if not ctype.startswith("image/"):
            # EE returned JSON (typically an error envelope). Fall back.
            return _fallback(
                f"EE returned non-image ({ctype}, {len(body)} bytes)"
            )
        cache.set(cache_key, body, timeout=6 * 60 * 60)
        resp = HttpResponse(body, content_type=ctype)
        resp["Cache-Control"] = "public, max-age=21600"  # 6 h
        return resp
    except urllib.error.HTTPError as e:
        return _fallback(f"EE thumb fetch HTTP {e.code}")
    except Exception as e:
        return _fallback(f"EE thumb fetch failed: {e}")


# ----------------------------------------------------------------------
# /api/gee/boundaries/  -> list admin units (name, code, bounds)
# ----------------------------------------------------------------------
def gee_boundaries(request: HttpRequest) -> JsonResponse:
    level_param = request.GET.get("level", "1")
    try:
        level = int(level_param)
    except Exception:
        level = 1

    if not _init_ee():
        return JsonResponse(
            {
                "configured": False,
                "level": level,
                "features": [],
                "message": _EE_INIT_ERROR or "Earth Engine not initialized",
            }
        )

    iso = (request.GET.get("country_iso") or "ZWE").upper()
    country_name = _BOUNDARY_COUNTRY_NAME.get(iso)

    try:
        import ee  # type: ignore

        path = _GAUL_PATHS_BY_COUNTRY.get(iso, {}).get(level)
        if not path or not country_name:
            return JsonResponse(
                {
                    "configured": True,
                    "level": level,
                    "features": [],
                    "message": f"Unsupported level {level} for {iso}",
                }
            )

        fc = ee.FeatureCollection(path)
        # GAUL levels are global, so always filter by country.
        # Custom assets (level 3 ZWE wards) are already country-specific.
        if path.startswith("FAO/GAUL/"):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", country_name))

        name_field = _GAUL_NAME.get(level, "ADM1_NAME")
        code_field = _GAUL_CODE.get(level, "ADM1_CODE")

        fc2 = fc.map(
            lambda f: f.set(
                {
                    "name": f.get(name_field),
                    "code": f.get(code_field),
                    "bounds": f.geometry().bounds().coordinates(),
                }
            )
        )

        names = fc2.aggregate_array("name").getInfo()
        codes = fc2.aggregate_array("code").getInfo()
        boxes = fc2.aggregate_array("bounds").getInfo()

        features: List[Dict[str, Any]] = []
        for i in range(min(len(names or []), len(boxes or []))):
            name = names[i]
            code = (codes[i] if codes and i < len(codes) else None) or name
            try:
                ring = boxes[i][0]  # [[w,s],[e,s],[e,n],[w,n],[w,s]]
                lons = [pt[0] for pt in ring]
                lats = [pt[1] for pt in ring]
                b = {
                    "south": min(lats),
                    "west": min(lons),
                    "north": max(lats),
                    "east": max(lons),
                }
            except Exception:
                b = None
            features.append({"name": name, "code": code, "bounds": b})

        features.sort(key=lambda x: (x["name"] or ""))
        return JsonResponse({"configured": True, "level": level, "features": features})

    except Exception as e:
        return JsonResponse(
            {
                "configured": False,
                "level": level,
                "features": [],
                "message": f"EE GAUL read failed (L{level}): {e}",
            }
        )


# ----------------------------------------------------------------------
# /api/gee/health/  -> quick EE check + sample tile url
# ----------------------------------------------------------------------
def gee_health(request: HttpRequest) -> JsonResponse:
    ok = _init_ee()
    info: Dict[str, Any] = {"initialized": ok}
    if not ok:
        info["error"] = _EE_INIT_ERROR
        env_value = os.environ.get("GEE_SERVICE_ACCOUNT_JSON")
        if env_value is None:
            info["env_diag"] = "GEE_SERVICE_ACCOUNT_JSON not set"
        else:
            stripped = env_value.strip()
            head = stripped[:5]
            tail = stripped[-5:] if len(stripped) > 5 else ""
            info["env_diag"] = {
                "len": len(env_value),
                "starts_with_brace": stripped.startswith("{"),
                "head": head,
                "tail": tail,
                "json_parses": False,
                "has_client_email": False,
                "has_private_key": False,
            }
            try:
                parsed = json.loads(stripped)
                info["env_diag"]["json_parses"] = True
                info["env_diag"]["has_client_email"] = bool(parsed.get("client_email"))
                info["env_diag"]["has_private_key"] = bool(parsed.get("private_key"))
            except Exception as e:
                info["env_diag"]["json_error"] = str(e)
        return JsonResponse(info, status=200)

    try:
        import ee  # type: ignore

        image = ee.Image.constant(1)
        md = image.getMapId({})

        tile_url = None
        fetcher = md.get("tile_fetcher")
        if fetcher is not None:
            tile_url = getattr(fetcher, "url_format", None)

        if not tile_url:
            mapid = md.get("mapid")
            token = md.get("token")
            if mapid and token:
                tile_url = (
                    f"https://earthengine.googleapis.com/map/{mapid}/{{z}}/{{x}}/{{y}}?token={token}"
                )

        if not tile_url:
            info["configured"] = False
            info["error"] = "EE did not provide a usable tile URL."
            info["raw"] = {k: str(v) for k, v in md.items()}
            return JsonResponse(info, status=200)

        info["sample_tile_url"] = tile_url
        info["configured"] = True
        return JsonResponse(info)
    except Exception as e:
        return JsonResponse(
            {
                "initialized": True,
                "configured": False,
                "error": f"Tile generation failed: {e}",
            },
            status=200,
        )


# ----------------------------------------------------------------------
# /api/gee/boundary-geom/  POST {level, unit_code, unit_name}
# ----------------------------------------------------------------------
@csrf_exempt
def gee_boundary_geom(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        body = {}

    # Level
    try:
        level = int(body.get("level", 1))
    except Exception:
        level = 1

    # Handle unit_code / unit_name as int or str safely
    raw_code = body.get("unit_code")
    raw_name = body.get("unit_name")

    if isinstance(raw_code, (int, float)):
        unit_code = str(raw_code)
    else:
        unit_code = (raw_code or "").strip()

    if isinstance(raw_name, (int, float)):
        unit_name = str(raw_name)
    else:
        unit_name = (raw_name or "").strip()

    if not _init_ee():
        return JsonResponse(
            {"configured": False, "feature": None, "message": "EE not initialized"},
            status=200,
        )

    import ee  # type: ignore

    iso = str(body.get("country_iso") or "ZWE").upper()
    country_name = _BOUNDARY_COUNTRY_NAME.get(iso)
    path = _GAUL_PATHS_BY_COUNTRY.get(iso, {}).get(level)
    if not path or not country_name:
        return JsonResponse(
            {
                "configured": True,
                "feature": None,
                "message": f"Unsupported level {level} for {iso}",
            },
            status=200,
        )

    try:
        fc = ee.FeatureCollection(path)
        if path.startswith("FAO/GAUL/"):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", country_name))
        code_field = _GAUL_CODE.get(level)
        name_field = _GAUL_NAME.get(level)

        filt = None

        # Try code first (handle numeric vs string code)
        if unit_code and code_field:
            # Try both string and numeric comparison if possible
            f_str = ee.Filter.eq(code_field, unit_code)
            try:
                code_int = int(unit_code)
                f_int = ee.Filter.eq(code_field, code_int)
                filt = fc.filter(ee.Filter.Or(f_str, f_int))
            except Exception:
                filt = fc.filter(f_str)

        # If nothing found by code, or no code provided, fall back to name
        if (not filt or filt.size().getInfo() == 0) and unit_name and name_field:
            filt = fc.filter(ee.Filter.eq(name_field, unit_name))

        # Still nothing? just use full collection as last resort
        if not filt:
            filt = fc

        feat = ee.Feature(filt.first())
        geom = feat.geometry(1)  # 1 m error margin

        # Extract properties
        name_val = feat.get(name_field) if name_field else None
        code_val = feat.get(code_field) if code_field else None

        # Convert to Python values
        if hasattr(name_val, "getInfo"):
            name_val = name_val.getInfo()
        if hasattr(code_val, "getInfo"):
            code_val = code_val.getInfo()

        gj = {
            "type": "Feature",
            "geometry": geom.getInfo(),
            "properties": {
                "name": name_val,
                "code": code_val,
                "level": level,
            },
        }

        return JsonResponse({"configured": True, "feature": gj})

    except Exception as e:
        return JsonResponse(
            {
                "configured": False,
                "feature": None,
                "message": f"boundary fetch failed: {e}",
            },
            status=200,
        )

# ----------------------------------------------------------------------
# /api/gee/analyze/  POST {dataset, geometry}
# ----------------------------------------------------------------------


@csrf_exempt
def gee_analyze(request: HttpRequest) -> JsonResponse:
    """
    Analyze a suitability raster over a drawn polygon using a histogram approach.
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        body = {}
    dataset = (body.get("dataset") or "").strip()
    geometry = body.get("geometry")

    if not dataset or not geometry:
        return JsonResponse(
            {"items": [], "message": "dataset and geometry required"},
            status=200,
        )

    if not _init_ee():
        return JsonResponse({"items": [], "message": "EE not initialized"}, status=200)

    try:
        import ee  # type: ignore

        img = ee.Image(dataset)
        band_name = ee.String(img.bandNames().get(0))
        band = img.select([band_name])

        # Use the *fixed* helper here
        region = _ee_geom_from_geojson(geometry)

        # Reasonable scale for UI analysis
        scale = ee.Number(img.projection().nominalScale()).max(50)

        hist = band.reduceRegion(
            reducer=ee.Reducer.frequencyHistogram(),
            geometry=region,
            scale=scale,
            maxPixels=1e10,
            bestEffort=True,
            tileScale=4,
        )

        freq_dict = ee.Dictionary(hist.get(band_name))
        freq_py = freq_dict.getInfo() or {}

        if not freq_py:
            return JsonResponse(
                {
                    "items": [],
                    "message": "No valid class pixels found in this polygon.",
                },
                status=200,
            )

        scale_m = float(scale.getInfo())
        area_per_pixel_ha = (scale_m * scale_m) / 10000.0

        items: list[dict[str, Any]] = []
        for k, v in freq_py.items():
            try:
                klass = int(k)
            except Exception:
                try:
                    klass = int(float(k))
                except Exception:
                    continue
            count = float(v or 0.0)
            area_ha = count * area_per_pixel_ha
            items.append(
                {
                    "class": klass,
                    "label": _label_for_class(klass),
                    "area_ha": area_ha,
                }
            )

        items.sort(key=lambda x: x["class"])
        return JsonResponse({"items": items})

    except Exception as e:
        return JsonResponse(
            {"items": [], "message": f"Earth Engine error: {e}"},
            status=200,
        )

# ----------------------------------------------------------------------
# /api/gee/analyze-admin/  POST {dataset, level, unit_code, unit_name}
# ----------------------------------------------------------------------
@csrf_exempt
def gee_analyze_admin(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        body = {}
    dataset = (body.get("dataset") or "").strip()
    level = int(body.get("level", 1))
    unit_code = (body.get("unit_code") or "").strip()
    unit_name = (body.get("unit_name") or "").strip()

    if not dataset:
        return JsonResponse({"items": [], "message": "dataset required"}, status=200)
    if not _init_ee():
        return JsonResponse({"items": [], "message": "EE not initialized"}, status=200)

    import ee  # type: ignore
    iso = str(body.get("country_iso") or "ZWE").upper()
    country_name = _BOUNDARY_COUNTRY_NAME.get(iso)
    path = _GAUL_PATHS_BY_COUNTRY.get(iso, {}).get(level)
    if not path or not country_name:
        return JsonResponse(
            {"items": [], "message": f"Unsupported level {level} for {iso}"},
            status=200,
        )

    try:
        fc = ee.FeatureCollection(path)
        if path.startswith("FAO/GAUL/"):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", country_name))
        code_field = _GAUL_CODE.get(level)
        name_field = _GAUL_NAME.get(level)

        filt = None
        if unit_code and code_field:
            filt = fc.filter(ee.Filter.eq(code_field, unit_code))
        if (not filt or filt.size().getInfo() == 0) and unit_name and name_field:
            filt = fc.filter(ee.Filter.eq(name_field, unit_name))
        if not filt:
            filt = fc

        feat = ee.Feature(filt.first())
        region = feat.geometry(1)

        img = ee.Image(dataset)
        band = ee.String(img.bandNames().get(0))
        scale = ee.Number(img.projection().nominalScale()).max(50)

        area_ha = ee.Image.pixelArea().divide(10000).rename("area_ha")
        grouped = area_ha.addBands(img.select([band])).reduceRegion(
            reducer=ee.Reducer.sum().group(groupField=1, groupName="class"),
            geometry=region,
            scale=scale,
            maxPixels=1e10,
            bestEffort=True,
            tileScale=4,
        )
        groups = ee.List(ee.Dictionary(grouped).get("groups"))
        groups_py = (groups.getInfo() or [])
        items: list[dict[str, Any]] = []
        for g in groups_py:
            klass = int(g.get("class"))
            area_val = float(g.get("sum") or 0.0)
            items.append(
                {
                    "class": klass,
                    "label": _label_for_class(klass),
                    "area_ha": area_val,
                }
            )
        items.sort(key=lambda x: x["class"])
        return JsonResponse({"items": items})
    except Exception as e:
        return JsonResponse({"items": [], "message": f"Earth Engine error: {e}"}, status=200)


# ----------------------------------------------------------------------
# /api/gee/analyze-irrigation/  POST {geometry, iso_period, band, threshold?}
# -> total irrigated hectares inside `geometry` for the given period/band.
# Used by the boundary popup's "Irrigated area" analysis for South Africa.
# ----------------------------------------------------------------------
@csrf_exempt
def gee_analyze_irrigation(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        body = {}

    geometry = body.get("geometry")
    iso_period = (body.get("iso_period") or "").strip()
    band = (body.get("band") or "filtered").strip().lower()
    try:
        threshold = float(body.get("threshold", 0.5))
    except Exception:
        threshold = 0.5

    if not geometry or not iso_period:
        return JsonResponse(
            {"items": [], "message": "geometry and iso_period required"}, status=200
        )
    if band not in _SA_IRRIGATION_BANDS:
        return JsonResponse(
            {"items": [], "message": f"unsupported band: {band}"}, status=200
        )
    if not _init_ee():
        return JsonResponse({"items": [], "message": "EE not initialized"}, status=200)

    try:
        import ee  # type: ignore

        ic = ee.ImageCollection(_SA_IRRIGATION_IC)
        # Same mosaic-with-homelands composition as the map renderer uses
        # (see gee_map IRR_SA_ branch). Without this, hectare totals for
        # boundaries overlapping homeland uploads come back as 0 because
        # those pixels live in the per-homeland assets, not the IC.
        sa_img = (
            ic.filter(ee.Filter.eq("iso_period", iso_period))
              .select(band)
              .mosaic()
        )
        uploaded = _homeland_uploaded_mosaic(iso_period, band)
        chunks = _homeland_chunk_mosaic_for_band(band)
        layers = [sa_img]
        if uploaded is not None:
            layers.append(uploaded)
        if chunks is not None:
            layers.append(chunks)
        band_img = (
            ee.ImageCollection(layers).mosaic()
            if len(layers) > 1 else sa_img
        )

        if band == "probability":
            mask = band_img.gte(threshold)
            irr_label = f"Irrigated (p ≥ {threshold:.2f})"
        else:
            # raw / filtered: any non-zero pixel is irrigated. Same convention
            # the map renderer uses.
            mask = band_img.gt(0)
            irr_label = f"Irrigated ({band})"

        region = _ee_geom_from_geojson(geometry)
        # IMPORTANT: band_img is a mosaic(), and EE resets a mosaic's
        # projection to the default 1-degree grid (~111 km nominal scale).
        # Using band_img.projection().nominalScale() here therefore reduces at
        # ~111 km — one giant pixel over the whole polygon — which collapses
        # the irrigated area to equal the boundary total (the "100% irrigated"
        # bug). These assets are 10 m native, so pin the scale explicitly.
        scale = 10

        pixel_ha = ee.Image.pixelArea().divide(10000).rename("area_ha")
        irr_dict = pixel_ha.updateMask(mask).reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=region,
            scale=scale,
            maxPixels=int(1e10),
            bestEffort=True,
            tileScale=4,
        )
        total_dict = pixel_ha.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=region,
            scale=scale,
            maxPixels=int(1e10),
            bestEffort=True,
            tileScale=4,
        )
        irr_val = float(ee.Number(irr_dict.get("area_ha")).getInfo() or 0.0)
        total_val = float(ee.Number(total_dict.get("area_ha")).getInfo() or 0.0)
        share = (100.0 * irr_val / total_val) if total_val > 0 else 0.0

        return JsonResponse(
            {
                "items": [
                    {"label": irr_label, "area_ha": irr_val, "share_pct": share},
                    {"label": "Boundary total", "area_ha": total_val, "share_pct": 100.0},
                ],
                "iso_period": iso_period,
                "band": band,
                "threshold": threshold if band == "probability" else None,
            }
        )

    except Exception as e:
        return JsonResponse(
            {"items": [], "message": f"Earth Engine error: {e}"}, status=200
        )


# ----------------------------------------------------------------------
# /api/wapor/timeseries/  POST {geometry}
# -> mean ETa per dekad inside geometry, for all locally-available mosaics.
# Used by the boundary popup's "Crop water use (time series)" analysis.
# ----------------------------------------------------------------------
@csrf_exempt
def wapor_timeseries(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        body = {}
    geometry = body.get("geometry")
    selected_dekad_date = (body.get("dekad_date") or "").strip()
    start_date = (body.get("start_date") or "").strip()
    end_date = (body.get("end_date") or "").strip()
    if not geometry:
        return JsonResponse({"items": [], "message": "geometry required"}, status=200)
    if selected_dekad_date and selected_dekad_date not in set(_WAPOR_DEKAD_TO_DATE.values()):
        return JsonResponse(
            {"items": [], "message": f"WaPOR period not available: {selected_dekad_date}"},
            status=200,
        )
    available_dekad_dates = set(_WAPOR_DEKAD_TO_DATE.values())
    if start_date and start_date not in available_dekad_dates:
        return JsonResponse(
            {"items": [], "message": f"WaPOR start date not available: {start_date}"},
            status=200,
        )
    if end_date and end_date not in available_dekad_dates:
        return JsonResponse(
            {"items": [], "message": f"WaPOR end date not available: {end_date}"},
            status=200,
        )
    if start_date and end_date and start_date > end_date:
        return JsonResponse(
            {"items": [], "message": "Start date must be before or equal to end date."},
            status=200,
        )

    try:
        import numpy as np
        from rasterio.errors import WindowError
        from rasterio.features import geometry_mask, geometry_window
        from shapely.geometry import shape
    except Exception as e:  # noqa: BLE001
        return JsonResponse({"items": [], "message": f"deps: {e}"}, status=200)

    try:
        geom = shape(geometry)
        gb = geom.bounds  # (minx, miny, maxx, maxy)
    except Exception as e:  # noqa: BLE001
        return JsonResponse({"items": [], "message": f"bad geometry: {e}"}, status=200)

    items = []
    dekad_items = _WAPOR_DEKAD_TO_DATE.items()
    if selected_dekad_date:
        dekad_items = [
            (dekad_key, dekad_date)
            for dekad_key, dekad_date in _WAPOR_DEKAD_TO_DATE.items()
            if dekad_date == selected_dekad_date
        ]
    elif start_date or end_date:
        lo = start_date or min(available_dekad_dates)
        hi = end_date or max(available_dekad_dates)
        dekad_items = [
            (dekad_key, dekad_date)
            for dekad_key, dekad_date in _WAPOR_DEKAD_TO_DATE.items()
            if lo <= dekad_date <= hi
        ]

    def _stats_for_tif(tif_path: Path):
        with rasterio.open(tif_path) as src:
            # geometry_window with padding is safer than from_bounds for tiny
            # drawn polygons whose bbox can round down to a zero-sized window.
            try:
                win = geometry_window(src, [geometry], pad_x=1, pad_y=1)
            except WindowError:
                return None, 0
            a = src.read(1, window=win)
            t = src.window_transform(win)
            # all_touched=True counts pixels whose any portion is covered
            # by the polygon, which is more generous for small drawn AOIs
            # that wouldn't capture any pixel centers otherwise.
            mask = geometry_mask(
                [geometry], out_shape=a.shape, transform=t, invert=True,
                all_touched=True,
            )
            nodata = src.nodata
            valid = mask & np.isfinite(a)
            if nodata is not None:
                valid &= a != nodata
            if not valid.any():
                # Last-mile tolerance for very small drawn polygons: if the
                # polygon itself misses all valid cells, try a tiny raster-grid
                # buffer around it. This keeps the analysis useful when a user
                # draws a narrow AOI over a visible WaPOR patch.
                pixel_size = max(abs(src.transform.a), abs(src.transform.e))
                buffered = geom.buffer(pixel_size * 2)
                if not buffered.is_empty:
                    try:
                        buf_win = geometry_window(
                            src, [buffered.__geo_interface__], pad_x=1, pad_y=1
                        )
                        buf_arr = src.read(1, window=buf_win)
                        buf_mask = geometry_mask(
                            [buffered.__geo_interface__],
                            out_shape=buf_arr.shape,
                            transform=src.window_transform(buf_win),
                            invert=True,
                            all_touched=True,
                        )
                        valid = buf_mask & np.isfinite(buf_arr)
                        if nodata is not None:
                            valid &= buf_arr != nodata
                        if valid.any():
                            a = buf_arr
                    except WindowError:
                        pass
            if not valid.any():
                # Final fallback: sample a small square around the polygon
                # centroid and expand a few times. This handles tiny AOIs drawn
                # between valid raster cells while still staying spatially local.
                try:
                    row, col = src.index(geom.centroid.x, geom.centroid.y)
                    for radius_px in (3, 8, 16, 32, 64, 128):
                        row_start = max(0, row - radius_px)
                        row_stop = min(src.height, row + radius_px + 1)
                        col_start = max(0, col - radius_px)
                        col_stop = min(src.width, col + radius_px + 1)
                        if row_start >= row_stop or col_start >= col_stop:
                            continue
                        centroid_win = rasterio.windows.Window(
                            col_start,
                            row_start,
                            col_stop - col_start,
                            row_stop - row_start,
                        )
                        centroid_arr = src.read(1, window=centroid_win)
                        centroid_valid = np.isfinite(centroid_arr)
                        if nodata is not None:
                            centroid_valid &= centroid_arr != nodata
                        if centroid_valid.any():
                            a = centroid_arr
                            valid = centroid_valid
                            break
                except Exception:
                    pass
            if not valid.any():
                return None, 0
            vals = a[valid].astype("float32")
            return vals, int(vals.size)

    for dekad_key, dekad_date in dekad_items:
        tif = _WAPOR_LOCAL_ROOT / f"wapor_{dekad_date}.tif"
        if not tif.exists():
            continue
        try:
            vals, n_pixels = _stats_for_tif(tif)
            source = "cropland_masked"
            if vals is None:
                fallback_candidates = [
                    (tif.with_suffix(".pre-mask.tif"), "unmasked_pre_mask"),
                    (tif.with_suffix(".raw.tif"), "unmasked_raw"),
                    (tif.with_suffix(".chunked-backup.tif"), "unmasked_chunked_backup"),
                ]
                for fallback_tif, fallback_source in fallback_candidates:
                    if not fallback_tif.exists():
                        continue
                    vals, n_pixels = _stats_for_tif(fallback_tif)
                    if vals is not None:
                        source = fallback_source
                        break
            if vals is None:
                items.append({
                    "dekad": dekad_key,
                    "dekad_date": dekad_date,
                    "mean_eta": None,
                    "std_eta": None,
                    "n_pixels": 0,
                    "message": "No WaPOR pixels inside the selected polygon for this date.",
                })
                continue
            items.append({
                "dekad": dekad_key,
                "dekad_date": dekad_date,
                "mean_eta": round(float(vals.mean()), 2),
                "std_eta": round(float(vals.std()), 2),
                "min_eta": round(float(vals.min()), 2),
                "max_eta": round(float(vals.max()), 2),
                "n_pixels": n_pixels,
                "source": source,
            })
        except Exception as e:  # noqa: BLE001
            items.append({
                "dekad": dekad_key,
                "dekad_date": dekad_date,
                "mean_eta": None,
                "error": str(e),
            })

    # Sort by dekad_date (chronological)
    items.sort(key=lambda x: x.get("dekad_date") or "")
    return JsonResponse({"items": items})


# ----------------------------------------------------------------------
# /api/gee/boundaries-geojson/  -> GAUL polygons with properties
# GET ?level=1|2|3
# ----------------------------------------------------------------------
def gee_boundaries_geojson(request: HttpRequest) -> JsonResponse:
    level_param = request.GET.get("level", "1")
    try:
        level = int(level_param)
    except Exception:
        level = 1

    if not _init_ee():
        return JsonResponse(
            {
                "configured": False,
                "message": _EE_INIT_ERROR or "Earth Engine not initialized",
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )

    import ee  # type: ignore

    iso = (request.GET.get("country_iso") or "ZWE").upper()
    country_name = _BOUNDARY_COUNTRY_NAME.get(iso)
    path = _GAUL_PATHS_BY_COUNTRY.get(iso, {}).get(level)
    if not path or not country_name:
        return JsonResponse(
            {
                "configured": True,
                "message": f"Unsupported level {level} for {iso}",
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )

    try:
        name_field = _GAUL_NAME.get(level)
        code_field = _GAUL_CODE.get(level)

        fc = ee.FeatureCollection(path)
        if path.startswith("FAO/GAUL/"):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", country_name))

        # Simplify geometry to reduce size
        fc = fc.map(
            lambda f: f.setGeometry(f.geometry().simplify(100))
            .set("name", f.get(name_field))
            .set("code", f.get(code_field))
            .set("level", level)
        )

        gj = fc.getInfo()  # dict with type, properties, features

        gj["configured"] = True
        gj["message"] = ""
        return JsonResponse(gj, safe=False)
    except Exception as e:
        print("gee_boundaries_geojson error:", e)  # noqa: T201
        return JsonResponse(
            {
                "configured": False,
                "message": f"EE GAUL geojson failed (L{level}): {e}",
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )


# ----------------------------------------------------------------------
# /api/gee/boundary-at-point/  POST {level, lon, lat}
# -> find boundary feature at point and return its properties
# ----------------------------------------------------------------------
@csrf_exempt
def gee_boundary_at_point(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        body = {}

    level = int(body.get("level", 1))
    lon = body.get("lon")
    lat = body.get("lat")

    if lon is None or lat is None:
        return JsonResponse(
            {
                "configured": False,
                "feature": None,
                "message": "lon and lat are required",
            },
            status=200,
        )

    if not _init_ee():
        return JsonResponse(
            {
                "configured": False,
                "feature": None,
                "message": _EE_INIT_ERROR or "EE not initialized",
            },
            status=200,
        )

    import ee  # type: ignore

    iso = str(body.get("country_iso") or "ZWE").upper()
    country_name = _BOUNDARY_COUNTRY_NAME.get(iso)
    path = _GAUL_PATHS_BY_COUNTRY.get(iso, {}).get(level)
    if not path or not country_name:
        return JsonResponse(
            {
                "configured": True,
                "feature": None,
                "message": f"Unsupported level {level} for {iso}",
            },
            status=200,
        )

    try:
        name_field = _GAUL_NAME.get(level)
        code_field = _GAUL_CODE.get(level)

        point = ee.Geometry.Point([float(lon), float(lat)])

        fc = ee.FeatureCollection(path)
        if path.startswith("FAO/GAUL/"):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", country_name))
        fc = fc.filterBounds(point)

        feat = ee.Feature(fc.first())
        info = feat.getInfo() if feat else None

        if not info or "properties" not in info:
            return JsonResponse(
                {
                    "configured": True,
                    "feature": None,
                    "message": "No boundary found at this point",
                },
                status=200,
            )

        props = info.get("properties", {}) or {}
        name = props.get(name_field) or props.get("name") or "Unknown"
        code = props.get(code_field) or props.get("code") or "-"
        props["name"] = name
        props["code"] = code
        props["level"] = level

        return JsonResponse(
            {
                "configured": True,
                "feature": {
                    "properties": props,
                },
            }
        )
    except Exception as e:
        return JsonResponse(
            {
                "configured": False,
                "feature": None,
                "message": f"boundary-at-point failed: {e}",
            },
            status=200,
        )




@require_GET
def gee_socio_geojson(request: HttpRequest) -> JsonResponse:
    """
    Return a GeoJSON FeatureCollection for a socio-economic
    EE FeatureCollection asset.
    Expects ?dataset=projects/...
    """
    dataset = request.GET.get("dataset")
    if not dataset:
        return JsonResponse(
            {"configured": False, "message": "Missing 'dataset' query param."},
            status=400,
        )

    # Use the same EE init as all other endpoints
    if not _init_ee():
        return JsonResponse(
            {
                "configured": False,
                "message": _EE_INIT_ERROR or "Earth Engine not initialized",
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )

    try:
        import ee  # type: ignore
    except ImportError:
        return JsonResponse(
            {
                "configured": False,
                "message": "earthengine-api not installed.",
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )

    try:
        fc = ee.FeatureCollection(dataset)
    except Exception as e:
        return JsonResponse(
            {
                "configured": False,
                "message": f"Could not load FeatureCollection: {dataset}",
                "error": str(e),
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )

    try:
        # Optional: simplify to reduce size, but keep attributes
        fc_simplified = fc.map(
            lambda f: f.setGeometry(f.geometry().simplify(100))
        )
        gj = fc_simplified.getInfo()  # { type, features, ... }
    except Exception as e:
        return JsonResponse(
            {
                "configured": False,
                "message": "Failed to fetch FeatureCollection from Earth Engine.",
                "error": str(e),
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )

    gj["configured"] = True
    gj.setdefault("type", "FeatureCollection")
    return JsonResponse(gj, safe=False)


# ----------------------------------------------------------------------
# /api/gee/irrigation-periods/  -> list of available months in the SA
# irrigation ImageCollection (used by the date picker).
# Returns: {configured: bool, periods: [{iso_period, month_label, year, month}]}
# ----------------------------------------------------------------------
@require_GET
def gee_irrigation_periods(request: HttpRequest) -> JsonResponse:
    if not _init_ee():
        return JsonResponse(
            {
                "configured": False,
                "periods": [],
                "message": _EE_INIT_ERROR or "Earth Engine not initialized",
            }
        )
    try:
        import ee  # type: ignore
        ic = ee.ImageCollection(_SA_IRRIGATION_IC).sort("system:time_start")
        periods = (
            ic.toList(ic.size())
              .map(lambda im: ee.Image(im).toDictionary(
                  ["iso_period", "month_label", "year", "month"]
              ))
              .getInfo()
        )
        return JsonResponse({"configured": True, "periods": periods})
    except Exception as e:
        return JsonResponse(
            {
                "configured": False,
                "periods": [],
                "message": f"Failed to read irrigation IC: {e}",
            }
        )


# ----------------------------------------------------------------------
# /api/gee/wapor-periods/  -> dekad date picker options
# Frontend rebuilds dataset as "WAPOR_SA_<iso>?<dekad>" on every change.
# ----------------------------------------------------------------------
@require_GET
def gee_wapor_periods(request: HttpRequest) -> JsonResponse:
    """Return the dekads the viewer can display.

    A dekad is exposed if its mosaic file exists under ``out/wapor/``. Periods
    are grouped by year-month so the picker can show "July 2025" with D1/D2/D3
    options inside.
    """
    available = []
    for dekad_key, dekad_date in _WAPOR_DEKAD_TO_DATE.items():
        tif = _WAPOR_LOCAL_ROOT / f"wapor_{dekad_date}.tif"
        if not tif.exists():
            continue
        iso_period = dekad_date[:7]  # "2025-07"
        lo, hi = _wapor_rescale_for(tif)
        available.append({
            "iso_period": iso_period,
            "month_label": _WAPOR_PERIOD_LABELS.get(iso_period, iso_period),
            "dekad": dekad_key,
            "dekad_date": dekad_date,
            "vmin": round(lo, 2),
            "vmax": round(hi, 2),
        })
    return JsonResponse({"configured": True, "periods": available})


# ----------------------------------------------------------------------
# /api/wapor/tile/<dekad>/<z>/<x>/<y>.png
# Serves rio-tiler PNG tiles from the local WaPOR ETa20m mosaic.
# ----------------------------------------------------------------------
@require_GET
def wapor_tile(request: HttpRequest, dekad: str, z: int, x: int, y: int) -> HttpResponse:
    """Serve one PNG tile for a WaPOR dekad mosaic.

    ``dekad`` is the dekad date as YYYY-MM-DD (e.g. ``2025-07-11``). Values
    outside the data extent return a transparent PNG so the layer doesn't
    flash error tiles when the user pans away.
    """
    # Whitelist: only allow known dekads.
    if dekad not in set(_WAPOR_DEKAD_TO_DATE.values()):
        return HttpResponse(status=404)

    tif = _WAPOR_LOCAL_ROOT / f"wapor_{dekad}.tif"
    if not tif.exists():
        return HttpResponse(status=404)

    # Include mosaic mtime in the cache key so the Django locmem cache
    # invalidates whenever merge_wapor.py overwrites the mosaic.
    try:
        mtime = int(tif.stat().st_mtime)
    except OSError:
        mtime = 0
    cache_key = f"iv:wapor_tile:{dekad}:{mtime}:{z}:{x}:{y}"
    cached = cache.get(cache_key)
    if cached:
        return HttpResponse(cached, content_type="image/png")

    try:
        from rio_tiler.io import Reader
        from rio_tiler.errors import TileOutsideBounds
        from rio_tiler.colormap import cmap as rio_cmap
    except Exception as e:  # noqa: BLE001
        return HttpResponse(f"rio-tiler not installed: {e}".encode(), status=500)

    try:
        with Reader(str(tif)) as src:
            try:
                img = src.tile(int(x), int(y), int(z))
            except TileOutsideBounds:
                return HttpResponse(_TRANSPARENT_PNG, content_type="image/png")
        png_bytes = _render_quantile_stretched(img, tif)
    except Exception as e:  # noqa: BLE001
        import traceback as _tb
        _tb.print_exc()
        return HttpResponse(f"tile render error: {e}".encode(), status=500)

    cache.set(cache_key, png_bytes, timeout=24 * 60 * 60)
    resp = HttpResponse(png_bytes, content_type="image/png")
    # Short browser cache so renderer changes don't get stuck behind 24-h CDN-
    # style caching while we iterate on colormaps / rescale. The URL also
    # carries a ?v=q2-... cache-buster keyed on renderer algorithm.
    resp["Cache-Control"] = "public, max-age=300"
    return resp


# 1x1 transparent PNG (89 bytes).
_TRANSPARENT_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _render_quantile_stretched(img, tif_path: Path) -> bytes:
    """Render a tile by mapping each pixel to its quantile in the full mosaic.

    This is critical when data clusters tightly (winter ETa: std ~2 mm) — a
    linear rescale leaves nearly everything in one corner of the colormap.
    Quantile mapping guarantees colors are evenly distributed across pixels
    so adjacent fields are visually distinguishable.
    """
    import io
    import numpy as np
    from PIL import Image
    import matplotlib

    sorted_vals = _wapor_quantile_lut(tif_path)
    qs = np.linspace(0.0, 1.0, len(sorted_vals), dtype=np.float32)

    arr = np.asarray(img.array, dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[0]
    mask = np.asarray(img.mask)
    if mask.ndim == 3:
        mask = mask[0]
    valid = mask > 0

    norm = np.zeros(arr.shape, dtype=np.float32)
    if valid.any():
        norm_flat = np.interp(arr[valid], sorted_vals, qs)
        norm[valid] = norm_flat.astype(np.float32)

    cm = matplotlib.colormaps["turbo"]
    rgba = (cm(norm) * 255).astype(np.uint8)  # H, W, 4
    rgba[..., 3] = np.where(valid, 255, 0)

    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=False)
    return buf.getvalue()
