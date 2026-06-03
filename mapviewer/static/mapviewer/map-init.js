/* global maplibregl, MapboxDraw */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

  // Translation helper — falls back to the English string if ivT() isn't loaded yet.
  const _t = (key, fallback) =>
    typeof window.ivT === "function" ? window.ivT(key, fallback) : fallback;

  // Render an actionable message in the map container when the map can't be
  // created (WebGL unavailable / MapLibre blocked) — beats a silent blank map.
  function _showMapUnavailable(mapEl, why) {
    if (!mapEl) return;
    mapEl.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;padding:2rem;text-align:center;color:#cbd5e1;' +
      'background:#020617;font:14px/1.55 system-ui,-apple-system,sans-serif;z-index:5;">' +
      '<div><div style="font-size:1.05rem;font-weight:600;margin-bottom:.5rem;">' +
      'Map can’t be displayed in this browser</div><div>' + why + '</div></div></div>';
    if (API.setStatus) {
      API.setStatus("Map unavailable in this browser (WebGL or map library blocked).", true);
    }
  }

  function initMap() {
    const mapEl = API.mapEl;
    if (!mapEl) return;

    // The map needs MapLibre (loaded from a CDN) + WebGL. Surface a clear
    // message if either is missing — common in Chrome when hardware
    // acceleration is off or an extension blocks unpkg.com. (Edge often has
    // hardware acceleration on by default, which is why it can differ.)
    if (typeof maplibregl === "undefined") {
      _showMapUnavailable(mapEl,
        "The map library failed to load — a browser extension (ad/script blocker) " +
        "or your network may be blocking unpkg.com. Allow it for this site and reload.");
      return;
    }
    const webglAvailable = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(window.WebGLRenderingContext &&
          (c.getContext("webgl2") || c.getContext("webgl") ||
           c.getContext("experimental-webgl")));
      } catch (_) { return false; }
    })();
    if (!webglAvailable) {
      _showMapUnavailable(mapEl,
        "WebGL isn’t available. In Chrome: Settings → System → enable “Use graphics " +
        "acceleration when available”, relaunch Chrome, then reload. " +
        "(Visit chrome://gpu — WebGL should read “Hardware accelerated”.)");
      return;
    }

    let map;
    try {
      map = new maplibregl.Map({
        container: mapEl,
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: {
                "background-color": "#020617",
              },
            },
          ],
        },
        center: [30.9, -19.0],
        zoom: 6.3,
      });
    } catch (err) {
      console.error("MapLibre failed to initialize:", err);
      _showMapUnavailable(mapEl,
        "The map engine failed to start (WebGL error). Enable hardware acceleration " +
        "and reload, or try a different browser.");
      return;
    }

    API.map = map;
    window.map = map; // optional external access

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("error", (e) => {
      const err = e && e.error ? e.error : null;
      const msg = err ? String(err.message || err) : "";
      const status = err && (err.status || err.statusCode);
      if (status === 429 || /(^|\D)429(\D|$)|too many requests|quota|restricted mode/i.test(msg)) {
        // EE quota/rate-limit errors are transient and self-recover; just hide
        // the spinner and stay silent (don't surface a message to the user).
        if (API.hideMapSpinner) API.hideMapSpinner();
      }
    });

    let draw = null;
    if (typeof MapboxDraw !== "undefined") {
      draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        styles: [
          {
            id: "gl-draw-polygon-fill-inactive",
            type: "fill",
            filter: [
              "all",
              ["==", "active", "false"],
              ["==", "$type", "Polygon"],
              ["!=", "mode", "static"],
            ],
            paint: {
              "fill-color": "#22d3ee",
              "fill-opacity": 0.25,
            },
          },
          {
            id: "gl-draw-polygon-stroke-inactive",
            type: "line",
            filter: [
              "all",
              ["==", "active", "false"],
              ["==", "$type", "Polygon"],
              ["!=", "mode", "static"],
            ],
            paint: {
              "line-color": "#0ea5e9",
              "line-width": 2,
            },
          },
          {
            id: "gl-draw-polygon-fill-active",
            type: "fill",
            filter: [
              "all",
              ["==", "active", "true"],
              ["==", "$type", "Polygon"],
            ],
            paint: {
              "fill-color": "#22d3ee",
              "fill-opacity": 0.35,
            },
          },
          {
            id: "gl-draw-polygon-stroke-active",
            type: "line",
            filter: [
              "all",
              ["==", "active", "true"],
              ["==", "$type", "Polygon"],
            ],
            paint: {
              "line-color": "#0ea5e9",
              "line-width": 3,
            },
          },
          {
            id: "gl-draw-line-inactive",
            type: "line",
            filter: [
              "all",
              ["==", "active", "false"],
              ["==", "$type", "LineString"],
              ["!=", "mode", "static"],
            ],
            paint: {
              "line-color": "#22d3ee",
              "line-width": 2,
            },
          },
          {
            id: "gl-draw-line-active",
            type: "line",
            filter: [
              "all",
              ["==", "active", "true"],
              ["==", "$type", "LineString"],
            ],
            paint: {
              "line-color": "#0ea5e9",
              "line-width": 3,
            },
          },
          {
            id: "gl-draw-polygon-midpoint",
            type: "circle",
            filter: [
              "all",
              ["==", "$type", "Point"],
              ["==", "meta", "midpoint"],
            ],
            paint: {
              "circle-radius": 4,
              "circle-color": "#22d3ee",
            },
          },
          {
            id: "gl-draw-polygon-and-line-vertex-halo-active",
            type: "circle",
            filter: [
              "all",
              ["==", "$type", "Point"],
              ["==", "meta", "vertex"],
              ["==", "active", "true"],
            ],
            paint: {
              "circle-radius": 7,
              "circle-color": "#ffffff",
            },
          },
          {
            id: "gl-draw-polygon-and-line-vertex-active",
            type: "circle",
            filter: [
              "all",
              ["==", "$type", "Point"],
              ["==", "meta", "vertex"],
              ["==", "active", "true"],
            ],
            paint: {
              "circle-radius": 4,
              "circle-color": "#0ea5e9",
            },
          },
        ],
      });
      map.addControl(draw, "top-left");
    } else {
      console.error("MapboxDraw is not loaded.");
      API.setStatus(_t("status_draw_unavailable", "Drawing tools unavailable (Draw plugin not loaded)."), true);
    }

    API.draw = draw;

    const analysisManager = new API.AnalysisManager({
      map,
      draw,
      geeAnalyzeUrl: API.geeAnalyze || "/api/gee/analyze/",
      setStatus: API.setStatus,
      setAnalysisHtml: API.setAnalysisHtml,
      showLegend: API.showLegend,
      hideLegend: API.hideLegend,
      setActiveLayer: API.setActiveLayer,
      highlight: API.setHighlight,
      clearHighlight: API.clearHighlight,
    });
    // Stash on API so other modules (Tweaks repaint) can reach it.
    API.analysisManager = analysisManager;

    const boundaryManager = new API.BoundaryManager({
      map,
      attributeTablesEl: API.attributeTablesEl,
      geeBoundariesUrl: API.geeBoundariesGeoJSON || "/api/gee/boundaries-geojson/",
      setStatus: API.setStatus,
      ensureAttributePanelVisible: API.ensureAttributePanelVisible,
      removeAttributeTableForLayer: API.removeAttributeTableForLayer,
      clearSelectedRows: API.clearSelectedRows,
      highlight: API.setHighlight,
      clearHighlight: API.clearHighlight,
      analysisManager,
      getLastSocioClickTime: API.getLastSocioClickTime,
    });

    const socioManager = new API.SocioManager({
      map,
      attributeTablesEl: API.attributeTablesEl,
      geeSocioUrl: API.geeSocioGeoJSON || "/api/gee/socio-geojson/",
      setStatus: API.setStatus,
      ensureAttributePanelVisible: API.ensureAttributePanelVisible,
      removeAttributeTableForLayer: API.removeAttributeTableForLayer,
      clearSelectedRows: API.clearSelectedRows,
      highlight: API.setHighlight,
      setLastSocioClickTime: API.setLastSocioClickTime,
    });

    API._managers = {
      analysis: analysisManager,
      boundary: boundaryManager,
      socio: socioManager,
    };

    API.resetView = function resetView() {
      if (!API.map) return;
      API.map.flyTo({ center: [30.9, -19.0], zoom: 6.3 });
    };

    API.onCountryChange = function onCountryChange(country) {
      if (!API.map || !API.COUNTRY_BBOXES[country]) {
        return;
      }
      const bbox = API.COUNTRY_BBOXES[country];
      API.map.fitBounds(bbox, {
        padding: 40,
        duration: 900,
        maxZoom: 7,
      });
      // Refresh the status + analysis-panel text so they point at the right
      // layer for the new country.
      const msg = country === "South Africa"
        ? "Map ready. Enable the South Africa irrigation layer to begin."
        : _t("status_map_ready", "Map ready. Choose a suitability layer to begin.");
      API.setStatus(msg, false);
      const html = country === "South Africa"
        ? "<em>Enable the South Africa irrigation layer, then click a homeland and choose <strong>Irrigated area (ha)</strong> in the popup.</em>"
        : "<em>Pick a suitability map, then draw a polygon (auto analysis) or click a boundary and use “Run analysis” in the popup.</em>";
      API.setAnalysisHtml(html);
    };

    if (draw) {
      let _drawPopup = null;
      const _closeDrawPopup = () => {
        if (_drawPopup) {
          try { _drawPopup.remove(); } catch (_) {}
          _drawPopup = null;
        }
      };

      // After a popup is closed (e.g. user clicked X), the next map click
      // immediately after may land on the now-exposed canvas inside the
      // drawn polygon and re-open the popup. This flag suppresses that.
      let _suppressMapClickUntil = 0;
      const _suppressMapClickBriefly = () => {
        _suppressMapClickUntil = Date.now() + 350;
      };

      const _validPos = (p) =>
        p && Number.isFinite(p.lng) && Number.isFinite(p.lat);

      const _showPopupForFeature = (feature, lngLat) => {
        if (!feature || !feature.geometry) return;
        let pos = _validPos(lngLat) ? lngLat : null;
        // Try turf centroid first.
        if (!pos && typeof turf !== "undefined") {
          try {
            const c = turf.centroid(feature).geometry.coordinates;
            const cand = { lng: c[0], lat: c[1] };
            if (_validPos(cand)) pos = cand;
          } catch (_) { /* fall through */ }
        }
        // Fallback: first vertex of the (Multi)Polygon outer ring.
        if (!pos) {
          try {
            const g = feature.geometry;
            let ring;
            if (g.type === "Polygon") ring = g.coordinates[0];
            else if (g.type === "MultiPolygon") ring = g.coordinates[0][0];
            const v = ring && ring[0];
            const cand = v ? { lng: v[0], lat: v[1] } : null;
            if (_validPos(cand)) pos = cand;
          } catch (_) { /* fall through */ }
        }
        if (!_validPos(pos)) {
          console.warn("[draw popup] could not derive a valid lng/lat from feature", feature);
          return;
        }
        _closeDrawPopup();
        _drawPopup = API.showDrawPolygonPopup(pos, feature, analysisManager);
        if (_drawPopup && typeof _drawPopup.on === "function") {
          _drawPopup.on("close", () => {
            _drawPopup = null;
            _suppressMapClickBriefly();
          });
        }
      };

      // Auto-show the analysis popup right after the polygon is finalized.
      // Also force MapboxDraw out of draw_polygon mode so subsequent clicks
      // don't start a new polygon, AND sync the toolbar UI + status text so
      // the user can tell the drawing operation is finished.
      const _resetDrawToolbarUi = () => {
        try { draw.changeMode("simple_select"); } catch (_) {}
        const toolbar = document.getElementById("drawToolbar")
          || document.querySelector(".draw-toolbar");
        if (toolbar) {
          toolbar.querySelectorAll("button[data-mode]").forEach((b) => {
            b.classList.toggle("active", b.dataset.mode === "select");
          });
        }
        API.setStatus("Polygon ready. Use the popup to run analysis.", false);
      };

      // Maximum drawn-polygon size. Analyses run server-side on Earth Engine
      // and are slow for huge areas (and the EE project is compute-limited);
      // a country-scale draw is almost never intentional. ~5,000 km².
      const MAX_DRAW_AREA_HA = 500000;
      const _enforceDrawSizeLimit = (feature) => {
        if (!feature || typeof turf === "undefined" || !turf.area) return true;
        let areaHa = 0;
        try { areaHa = turf.area(feature) / 10000; } catch (_) { return true; }
        if (areaHa <= MAX_DRAW_AREA_HA) return true;
        // Too big — remove the polygon and tell the user.
        try {
          if (feature.id != null) draw.delete(feature.id);
          else draw.deleteAll();
        } catch (_) {}
        _closeDrawPopup();
        if (analysisManager && typeof analysisManager.resetForDrawDelete === "function") {
          analysisManager.resetForDrawDelete();
        }
        API.setStatus(
          `Polygon too large (${Math.round(areaHa).toLocaleString()} ha). `
          + `Maximum is ${MAX_DRAW_AREA_HA.toLocaleString()} ha — draw a smaller area.`,
          true
        );
        return false;
      };

      map.on("draw.create", (e) => {
        console.log("[draw.create] features:", e && e.features);
        _resetDrawToolbarUi();
        const f = e && e.features && e.features[0];
        if (!_enforceDrawSizeLimit(f)) return;
        _showPopupForFeature(f, null);
      });

      // Enter key OR right-click finishes an in-progress polygon. mapbox-
      // gl-draw 1.5 + MapLibre sometimes drops the dblclick that's supposed
      // to finalize the polygon, leaving the user stuck adding vertices.
      const _finishInProgressPolygon = () => {
        let mode;
        try { mode = draw.getMode(); } catch (_) { return false; }
        if (mode !== "draw_polygon") return false;
        // changeMode commits the polygon (if valid) and fires draw.create.
        // The draw.create handler handles toolbar reset + popup, so don't do
        // it here too or we'd end up with two popups on screen.
        try { draw.changeMode("simple_select"); } catch (_) { return false; }
        return true;
      };

      document.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" || !draw) return;
        if (_finishInProgressPolygon()) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      });

      map.on("contextmenu", () => {
        // Right-click also finishes the polygon — matches several GIS tools.
        _finishInProgressPolygon();
      });

      map.on("draw.update", (e) => {
        const f = e && e.features && e.features[0];
        if (!_enforceDrawSizeLimit(f)) return;
        _showPopupForFeature(f, null);
      });

      map.on("draw.delete", () => {
        _closeDrawPopup();
        analysisManager.resetForDrawDelete();
      });

      // (Removed: click-inside-polygon-to-reopen-popup. It conflicted with the
      // popup close button — clicking X often reopened the popup because the
      // click reached the canvas under the polygon. The popup now opens only
      // on draw.create / draw.update. To run a new analysis, redraw or use
      // the Clear button.)
    }

    map.on("error", (e) => {
      if (!e || !e.error || !e.error.url) return;
      console.error("Map error", e);
      const err = e.error;
      const msgText = String(err.message || err || "");
      const isEarthEngineTile =
        /earthengine\.googleapis\.com/i.test(String(err.url || "")) ||
        /earthengine/i.test(msgText);
      const isRateLimit =
        err.status === 429 ||
        err.statusCode === 429 ||
        /(^|\D)429(\D|$)|too many requests|quota|restricted mode/i.test(msgText);
      if (isEarthEngineTile && isRateLimit) {
        // Transient EE quota/rate-limit on a tile fetch — hide the spinner and
        // stay silent rather than showing an error message.
        API.hideMapSpinner();
        return;
      }
      const msg = `Tile error: ${e.error.message || ""}`;
      API.setStatus(msg, true);
      API.hideMapSpinner();
    });

    map.on("load", () => {
      const country = (typeof API.getCurrentCountry === "function")
        ? API.getCurrentCountry()
        : "Zimbabwe";
      const readyMsg = country === "South Africa"
        ? "Map ready. Enable the South Africa irrigation layer to begin."
        : _t("status_map_ready", "Map ready. Choose a suitability layer to begin.");
      API.setStatus(readyMsg, false);

      API.addBasemapLayers();

      // Hard guarantee: basemap rasters always render at full opacity.
      // Re-pin after the initial add and after every style mutation so
      // nothing (legacy code, browser extensions, third-party libs) can
      // dim the basemap while the per-layer overlay sliders are in use.
      if (typeof API.restoreBasemapOpacity === "function") {
        API.restoreBasemapOpacity();
        map.on("styledata", () => API.restoreBasemapOpacity());
        map.on("sourcedata", (e) => {
          if (e && e.sourceId && e.sourceId.startsWith("basemap")) {
            API.restoreBasemapOpacity();
          }
        });
      }

      map.addSource(API.H_SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: API.H_LINE,
        type: "line",
        source: API.H_SRC,
        filter: ["!=", "$type", "Point"],
        paint: {
          "line-color": "#f97316",
          "line-width": 4,
        },
      });

      map.addLayer({
        id: API.H_POINT,
        type: "circle",
        source: API.H_SRC,
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#f97316",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      API.updateLayerZOrder();
    });

    API.attachLayerEvents(analysisManager, boundaryManager, socioManager);
    API.attachDrawToolbarEvents(analysisManager);
    API.attachSearchAndLocate();
    API.attachBasemapSwitcher();
    API.wireTopNavAndCountry(analysisManager);

    const country2 = (typeof API.getCurrentCountry === "function")
      ? API.getCurrentCountry()
      : "Zimbabwe";
    const initAnalysisHtml = country2 === "South Africa"
      ? "<em>Enable the South Africa irrigation layer, then click a homeland and choose <strong>Irrigated area (ha)</strong> in the popup.</em>"
      : "<em>Pick a suitability map, then draw a polygon (auto analysis) or click a boundary and use “Run analysis” in the popup.</em>";
    API.setAnalysisHtml(initAnalysisHtml);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!API.mapEl) return;

    if (API.updateLayerTreeForCountry) {
      API.updateLayerTreeForCountry();
    }
    if (API.countrySelect && API.updateLayerTreeForCountry) {
      API.countrySelect.addEventListener("change", () => {
        API.updateLayerTreeForCountry();
      });
    }

    initMap();
    API.wireLayerTreeGroups();
    API.wireLayerGroupDragAndDrop();

    // Deep-link from the landing-page use-case cards: ?country=South Africa
    // selects that country and zooms the map to it (via the change handler,
    // which calls onCountryChange + filters the layer tree).
    (function applyCountryFromUrl() {
      let wanted;
      try { wanted = new URLSearchParams(window.location.search).get("country"); }
      catch (_) { return; }
      if (!wanted || !API.countrySelect) return;
      const opt = Array.from(API.countrySelect.options).find(
        (o) => o.value.toLowerCase() === wanted.trim().toLowerCase()
      );
      if (!opt) return;
      const apply = () => {
        API.countrySelect.value = opt.value;
        API.countrySelect.dispatchEvent(new Event("change", { bubbles: true }));
      };
      if (API.map && typeof API.map.loaded === "function" && API.map.loaded()) {
        apply();
      } else if (API.map && typeof API.map.once === "function") {
        API.map.once("load", apply);
      } else {
        apply();
      }
    })();
  });
})();
