/* global maplibregl, MapboxDraw */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

  function initMap() {
    const mapEl = API.mapEl;
    if (!mapEl) return;

    const map = new maplibregl.Map({
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

    API.map = map;
    window.map = map; // optional external access

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("error", (e) => {
      const err = e && e.error ? e.error : null;
      const msg = err ? String(err.message || err) : "";
      const status = err && (err.status || err.statusCode);
      if (status === 429 || /(^|\D)429(\D|$)|too many requests|quota|restricted mode/i.test(msg)) {
        if (API.hideMapSpinner) API.hideMapSpinner();
        API.setStatus(
          "Earth Engine quota/rate limit hit. Wait a minute, then turn the layer on again.",
          true
        );
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
      API.setStatus("Drawing tools unavailable (Draw plugin not loaded).", true);
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
    };

    if (draw) {
      map.on("draw.create", () => analysisManager.runFreehandAnalysis());
      map.on("draw.update", () => analysisManager.runFreehandAnalysis());
      map.on("draw.delete", () => {
        analysisManager.resetForDrawDelete();
      });
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
        API.setStatus(
          "Earth Engine quota/rate limit hit. Wait a minute, then turn the layer on again.",
          true
        );
        API.hideMapSpinner();
        return;
      }
      const msg = `Tile error: ${e.error.message || ""}`;
      API.setStatus(msg, true);
      API.hideMapSpinner();
    });

    map.on("load", () => {
      API.setStatus("Map ready. Choose a suitability layer to begin.", false);

      API.addBasemapLayers();

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

    API.setAnalysisHtml(
      "<em>Pick a suitability map, then draw a polygon (auto analysis) or click a boundary and use “Run analysis” in the popup.</em>"
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!API.mapEl) return;

    initMap();
    API.wireLayerTreeGroups();
    API.wireLayerGroupDragAndDrop();
  });
})();
