# mapviewer/views.py
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from django.views.decorators.http import require_GET



# ----------------------------------------------------------------------
# Sidebar layers shown in the template
# ----------------------------------------------------------------------
LAYERS: List[Dict[str, str]] = [
    # Irrigation suitability (assets)
    {
        "id": "ASSET_MANICALAND",
        "label": "Manicaland (asset)",
        "dataset": "projects/tethys-app-1/assets/Manicaland",
    },
    {
        "id": "ASSET_MAT_NORTH",
        "label": "Matabeleland North (asset)",
        "dataset": "projects/tethys-app-1/assets/Matebeleland_North",
    },
    {
        "id": "ASSET_MAT_SOUTH",
        "label": "Matabeleland South (asset)",
        "dataset": "projects/tethys-app-1/assets/Mat_south",
    },
    {
        "id": "ASSET_MASVINGO",
        "label": "Masvingo (asset)",
        "dataset": "projects/tethys-app-1/assets/Masvingo",
    },
    # Admin boundaries
    {
        "id": "ZWE_L1",
        "label": "Zimbabwe - Admin Level 1 (Provinces)",
        "dataset": "BOUNDARY_ZWE_L1",
    },
    {
        "id": "ZWE_L2",
        "label": "Zimbabwe - Admin Level 2 (Districts)",
        "dataset": "BOUNDARY_ZWE_L2",
    },
    {
        "id": "ZWE_L3",
        "label": "Zimbabwe - Admin Level 3 (Wards)",
        "dataset": "BOUNDARY_ZWE_L3",
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

    # 1) Env var
    env_path = os.environ.get("GEE_SERVICE_ACCOUNT_JSON")
    if env_path:
        p = Path(env_path)
        if p.exists():
            key_path = p

    # 2) settings
    if key_path is None:
        cfg_path = getattr(settings, "GEE_SERVICE_ACCOUNT_JSON", None)
        if cfg_path:
            p = Path(cfg_path)
            if p.exists():
                key_path = p

    # 3) default filename at BASE_DIR
    if key_path is None:
        base = Path(getattr(settings, "BASE_DIR", "."))
        p = base / "tethys-app-1-acc3960d3dd6.json"
        if p.exists():
            key_path = p

    try:
        import ee  # type: ignore

        if key_path and key_path.exists():
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
    return render(request, "mapviewer/index.html", {"layers": LAYERS})


# ----------------------------------------------------------------------
# GAUL / boundary helpers
# ----------------------------------------------------------------------
# NOTE: level 3 uses your custom wards asset
_GAUL_PATHS: Dict[int, str] = {
    1: "FAO/GAUL/2015/level1",
    2: "FAO/GAUL/2015/level2",
    3: "projects/tethys-app-1/assets/ZWE_ADM3_wards_2025",
}

# If your ward asset uses different field names, update the level-3 entries.
_GAUL_NAME: Dict[int, str] = {
    1: "ADM1_NAME",
    2: "ADM2_NAME",
    3: "ADM3_NAME",
}
_GAUL_CODE: Dict[int, str] = {
    1: "ADM1_CODE",
    2: "ADM2_CODE",
    3: "ADM3_CODE",
}


def _ee_geom_from_geojson(geo: Dict[str, Any]):
    import ee  # type: ignore
    # Let Earth Engine handle defaults; no manual geodesic/maxError here
    return ee.Geometry(geo)



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
        if dataset.startswith("BOUNDARY_ZWE_L"):
            try:
                level = int(dataset.rsplit("_L", 1)[1])
            except Exception:
                return JsonResponse(
                    {
                        "configured": True,
                        "message": "Invalid boundary level",
                        "tile_url": None,
                    },
                    status=400,
                )

            path = _GAUL_PATHS.get(level)
            if not path:
                return JsonResponse(
                    {
                        "configured": True,
                        "message": f"Unsupported level {level}",
                        "tile_url": None,
                    },
                    status=400,
                )

            try:
                fc = ee.FeatureCollection(path).filter(
                    ee.Filter.eq("ADM0_NAME", "Zimbabwe")
                )
            except Exception as e:
                return JsonResponse(
                    {
                        "configured": False,
                        "message": f"Failed to load GAUL L{level}: {e}",
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
            try:
                country = ee.FeatureCollection("FAO/GAUL/2015/level0").filter(
                    ee.Filter.eq("ADM0_NAME", "Zimbabwe")
                )
                ring = country.geometry().bounds().coordinates().getInfo()[0]
                lons = [pt[0] for pt in ring]
                lats = [pt[1] for pt in ring]
                bounds = {
                    "south": min(lats),
                    "west": min(lons),
                    "north": max(lats),
                    "east": max(lons),
                }
            except Exception:
                bounds = None

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
            try:
                ring = fc.geometry().bounds().coordinates().getInfo()[0]
                lons = [pt[0] for pt in ring]
                lats = [pt[1] for pt in ring]
                bounds = {
                    "south": min(lats),
                    "west": min(lons),
                    "north": max(lats),
                    "east": max(lons),
                }
            except Exception:
                bounds = None

        # --------------------------------------------------------------
        # 3) Default: try as Image, fallback to generic FC style
        # --------------------------------------------------------------
        else:
            try:
                # Try as image (e.g. suitability rasters)
                img = ee.Image(dataset)
                _ = img.bandNames()  # forces Image.load / will throw if not image
                image = img
                # Default suitability palette; harmless for other rasters too
                vis = {
                    "min": 0,
                    "max": 3,
                    "palette": ["#f1e5cd", "#166534", "#22c55e", "#fde047"],
                }
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

            bounds = None  # let client keep current view unless we compute bounds above

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

    try:
        import ee  # type: ignore

        path = _GAUL_PATHS.get(level)
        if not path:
            return JsonResponse(
                {
                    "configured": True,
                    "level": level,
                    "features": [],
                    "message": "Unsupported level",
                }
            )

        fc = ee.FeatureCollection(path)
        if level in (1, 2):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", "Zimbabwe"))

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

    path = _GAUL_PATHS.get(level)
    if not path:
        return JsonResponse(
            {
                "configured": True,
                "feature": None,
                "message": f"Unsupported level {level}",
            },
            status=200,
        )

    try:
        fc = ee.FeatureCollection(path).filter(
            ee.Filter.eq("ADM0_NAME", "Zimbabwe")
        )
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
    path = _GAUL_PATHS.get(level)
    if not path:
        return JsonResponse({"items": [], "message": f"Unsupported level {level}"}, status=200)

    try:
        fc = ee.FeatureCollection(path).filter(ee.Filter.eq("ADM0_NAME", "Zimbabwe"))
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

    path = _GAUL_PATHS.get(level)
    if not path:
        return JsonResponse(
            {
                "configured": True,
                "message": f"Unsupported level {level}",
                "type": "FeatureCollection",
                "features": [],
            },
            safe=False,
        )

    try:
        name_field = _GAUL_NAME.get(level)
        code_field = _GAUL_CODE.get(level)

        fc = ee.FeatureCollection(path)
        if level in (1, 2):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", "Zimbabwe"))

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

    path = _GAUL_PATHS.get(level)
    if not path:
        return JsonResponse(
            {
                "configured": True,
                "feature": None,
                "message": f"Unsupported level {level}",
            },
            status=200,
        )

    try:
        name_field = _GAUL_NAME.get(level)
        code_field = _GAUL_CODE.get(level)

        point = ee.Geometry.Point([float(lon), float(lat)])

        fc = ee.FeatureCollection(path)
        if level in (1, 2):
            fc = fc.filter(ee.Filter.eq("ADM0_NAME", "Zimbabwe"))
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
