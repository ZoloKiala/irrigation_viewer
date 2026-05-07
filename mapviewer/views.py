# mapviewer/views.py
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET



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
        "label": "Manicaland (asset)",
        "label_key": "layer_asset_manicaland",
        "dataset": "projects/tethys-app-1/assets/Manicaland",
        "country": "Zimbabwe",
    },
    {
        "id": "ASSET_MAT_NORTH",
        "label": "Matabeleland North (asset)",
        "label_key": "layer_asset_mat_north",
        "dataset": "projects/tethys-app-1/assets/Matebeleland_North",
        "country": "Zimbabwe",
    },
    {
        "id": "ASSET_MAT_SOUTH",
        "label": "Matabeleland South (asset)",
        "label_key": "layer_asset_mat_south",
        "dataset": "projects/tethys-app-1/assets/Mat_south",
        "country": "Zimbabwe",
    },
    {
        "id": "ASSET_MASVINGO",
        "label": "Masvingo (asset)",
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
        "dataset": "IRR_SA_2024-09?filtered",
        "country": "South Africa",
        "has_date_picker": True,
        "ic_kind": "irrigation",
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

        if key_data:
            data = json.loads(key_data)
            service_account = data.get("client_email")
            if not service_account:
                raise RuntimeError("client_email missing in service account JSON")
            creds = ee.ServiceAccountCredentials(service_account, key_data=key_data)
            ee.Initialize(creds)
        elif key_path and key_path.exists():
            with key_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            service_account = data.get("client_email")
            if not service_account:
                raise RuntimeError("client_email missing in service account JSON")
            creds = ee.ServiceAccountCredentials(service_account, str(key_path))
            ee.Initialize(creds)
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
        # 2b) South Africa monthly irrigation ImageCollection
        # --------------------------------------------------------------
        elif _parse_irrigation_dataset(dataset):
            iso, band = _parse_irrigation_dataset(dataset)
            try:
                ic = ee.ImageCollection(_SA_IRRIGATION_IC)
                img = ic.filter(ee.Filter.eq("iso_period", iso)).first()
                # Will raise if no match
                _ = img.bandNames().getInfo()
                image = ee.Image(img).select(band)
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
                # raw / filtered are 0/1 binary masks; show only 1.
                image = image.selfMask()
                vis = {"min": 1, "max": 1, "palette": ["#1a9641"]}

            # Reuse SA bounds for nice zoom
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

        return JsonResponse(payload)

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

    cache_key = "iv:thumb:" + hashlib.sha1(
        f"{dataset}|{palette_name}|{dim}".encode("utf-8")
    ).hexdigest()
    cached_url = cache.get(cache_key)
    if cached_url:
        return HttpResponseRedirect(cached_url)

    if not _init_ee():
        return JsonResponse(
            {"error": _EE_INIT_ERROR or "Earth Engine not initialized"},
            status=503,
        )

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
                image = image.selfMask()
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
            except Exception:
                return JsonResponse(
                    {"error": f"Unsupported dataset for thumbnail: {dataset}"},
                    status=400,
                )

        url = image.getThumbURL(thumb_params)
        cache.set(cache_key, url, timeout=6 * 60 * 60)
        return HttpResponseRedirect(url)

    except Exception as e:
        return JsonResponse(
            {"error": f"Thumbnail generation failed: {e}"},
            status=500,
        )


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
