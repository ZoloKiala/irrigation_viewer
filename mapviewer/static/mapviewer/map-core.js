/* global turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || {};
  window.MAPVIEWER = API;

  // Translation helper — falls back to the English string if ivT() isn't loaded yet.
  const _t = (key, fallback) =>
    typeof window.ivT === "function" ? window.ivT(key, fallback) : fallback;

  // ------------------------- DOM ELEMENTS -------------------------
  const mapEl = document.getElementById("map");
  const legendEl = document.getElementById("legend");
  const statusBox = document.getElementById("statusBox");
  const analysisBox = document.getElementById("analysisBox");
  const activeLayerEl = document.querySelector("#activeLayer span.text-secondary");
  const drawToolbar = document.getElementById("drawToolbar");
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const locateBtn = document.getElementById("locateBtn");
  const basemapSwitcher = document.getElementById("basemapSwitcher");

  const attributePanel = document.getElementById("attributePanel");
  const attributeTablesEl = document.getElementById("attributeTables");

  const layerCheckboxes = document.querySelectorAll('input[name="layer"]');

  // Top nav buttons
  const navHomeBtn = document.getElementById("navHomeBtn");
  const navAboutBtn = document.getElementById("navAboutBtn");
  const navHelpBtn = document.getElementById("navHelpBtn");

  // Country dropdown
  const countrySelect = document.getElementById("countrySelect");

  // Map loading overlay (spinner card in map panel)
  const mapLoadingOverlay = document.getElementById("mapLoadingOverlay");
  const mapLoadingTextEl = mapLoadingOverlay
    ? mapLoadingOverlay.querySelector(".map-loading-text")
    : null;

  // Highlight layers
  const H_SRC = "boundary-highlight";
  const H_LINE = "boundary-highlight-line";
  const H_POINT = "boundary-highlight-point";

  // Track last socio click to avoid double popup with boundary polygons
  let lastSocioClickTime = 0;

  // Remember raster meta (e.g. bounds) by id
  const rasterMetaById = {};

  // Track current country; only Zimbabwe has data for now
  let currentCountry = "Zimbabwe";

  const BASEMAPS = {
    osm: {
      label: "Streets",
      sourceId: "basemap_osm",
      layerId: "basemap_osm",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
    },
    terrain: {
      label: "Terrain",
      sourceId: "basemap_terrain",
      layerId: "basemap_terrain",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
    },
    satellite: {
      label: "Satellite",
      sourceId: "basemap_satellite",
      layerId: "basemap_satellite",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
    },
  };

  let currentBasemapId = "osm";

  // Approximate country BBOXes: [minLng, minLat, maxLng, maxLat]
  const COUNTRY_BBOXES = {
    Zimbabwe: [25.0, -23.0, 33.2, -15.3],
    "South Africa": [16.0, -35.5, 33.5, -21.0],
    Angola: [11.0, -18.5, 24.2, -4.2],
  };

  // Helper: always read the real selected country from the dropdown
  function getCurrentCountry() {
    const select = document.getElementById("countrySelect");
    if (select && select.value) {
      return select.value;
    }
    return currentCountry || "Zimbabwe";
  }

  // ------------------------- BASIC HELPERS -------------------------
  function setStatus(msg, isError) {
    if (!statusBox) return;
    statusBox.textContent = msg || "";
    statusBox.classList.toggle("text-danger", !!isError);
    statusBox.classList.toggle("text-secondary", !isError);
  }

  function setAnalysisHtml(html) {
    if (!analysisBox) return;
    analysisBox.innerHTML = html;
  }

  function setActiveLayer(info) {
    if (!activeLayerEl) return;
    const wrapper = activeLayerEl.closest(".nav-status");
    if (!info) {
      activeLayerEl.textContent =
        (typeof window.ivT === "function"
          ? window.ivT("status_active_none", "Select a layer to begin")
          : "Select a layer to begin");
      if (wrapper) wrapper.classList.remove("nav-status--on");
      return;
    }
    activeLayerEl.textContent = info.label || info.dataset || "active";
    if (wrapper) wrapper.classList.add("nav-status--on");
  }

  // Single shared #legend element renders MULTIPLE active legends stacked
  // vertically. Each "kind" owns its own slot in _legendSlots; updating one
  // doesn't clobber the others. _renderLegends() re-emits HTML from the
  // current slot state and shows/hides the container.
  const _legendSlots = { suitability: null, irrigation: null, wapor: null };

  function _renderLegends() {
    if (!legendEl) return;
    const sections = [];
    if (_legendSlots.suitability) sections.push(_legendSlots.suitability);
    if (_legendSlots.irrigation)  sections.push(_legendSlots.irrigation);
    if (_legendSlots.wapor)       sections.push(_legendSlots.wapor);
    if (!sections.length) {
      legendEl.style.display = "none";
      legendEl.innerHTML = "";
      return;
    }
    legendEl.style.display = "block";
    legendEl.innerHTML = sections
      .map((html) => `<div class="legend-section">${html}</div>`)
      .join("");
  }

  function showLegend() {
    const p = window.IV_SUIT_PALETTE || {
      N: "#f1e5cd", S1: "#166534", S2: "#22c55e", S3: "#fde047",
    };
    _legendSlots.suitability = `
      <div class="legend-title">Suitability</div>
      <div class="legend-item"><span class="legend-color" style="background:${p.N};"></span><span>N</span></div>
      <div class="legend-item"><span class="legend-color" style="background:${p.S1};"></span><span>S1</span></div>
      <div class="legend-item"><span class="legend-color" style="background:${p.S2};"></span><span>S2</span></div>
      <div class="legend-item"><span class="legend-color" style="background:${p.S3};"></span><span>S3</span></div>
    `;
    _renderLegends();
  }

  function hideLegend() {
    _legendSlots.suitability = null;
    _renderLegends();
  }

  function showIrrigationLegend(band) {
    let body = "";
    if (band === "probability") {
      body = `
        <div class="legend-title">Irrigation probability</div>
        <div class="legend-gradient legend-gradient--prob"></div>
        <div class="legend-gradient-axis">
          <span>0.0</span><span>0.5</span><span>1.0</span>
        </div>
      `;
    } else {
      const title = band === "raw" ? "Irrigated (raw)" : "Irrigated (filtered)";
      body = `
        <div class="legend-title">${title}</div>
        <div class="legend-item">
          <span class="legend-color" style="background:#1a9641;"></span>
          <span>Irrigated</span>
        </div>
        <div class="legend-foot">non-irrigated pixels are transparent</div>
      `;
    }
    _legendSlots.irrigation = body;
    _renderLegends();
  }

  function hideIrrigationLegend() {
    _legendSlots.irrigation = null;
    _renderLegends();
  }

  function showWaporLegend(dekadDate) {
    const renderAxis = (lo, hi) => {
      const mid = (lo + hi) / 2;
      _legendSlots.wapor = `
        <div class="legend-title">Crop water use (mm/dekad)</div>
        <div class="legend-gradient legend-gradient--wapor"></div>
        <div class="legend-gradient-axis">
          <span>${lo.toFixed(1)}</span>
          <span>${mid.toFixed(1)}</span>
          <span>${hi.toFixed(1)}</span>
        </div>
        <div class="legend-foot">WaPOR L1 AETI_D downscaled to 20 m</div>
      `;
      _renderLegends();
    };
    renderAxis(0, 30);
    if (!dekadDate) return;
    fetch("/api/gee/wapor-periods/")
      .then((r) => r.json())
      .then((d) => {
        const p = (d.periods || []).find((x) => x.dekad_date === dekadDate);
        if (!p) return;
        if (typeof p.vmin === "number" && typeof p.vmax === "number") {
          renderAxis(p.vmin, p.vmax);
        }
      })
      .catch(() => {});
  }

  function hideWaporLegend() {
    _legendSlots.wapor = null;
    _renderLegends();
  }

  // Attribute panel helpers (panel visibility now user-controlled)
  function ensureAttributePanelVisible() {
    // intentionally blank – you toggle via UI
  }

  function hideAttributePanelIfEmpty() {
    if (!attributeTablesEl || !attributePanel) return;
    const hasTables = attributeTablesEl.querySelector(".attribute-table-wrapper");
    if (!hasTables) {
      // optional auto-close:
      // attributePanel.classList.add("d-none");
    }
  }

  function removeAttributeTableForLayer(layerId) {
    if (!attributeTablesEl) return;
    const wrapper = attributeTablesEl.querySelector(
      `.attribute-table-wrapper[data-layer-id="${layerId}"]`
    );
    if (wrapper) wrapper.remove();
    hideAttributePanelIfEmpty();
  }

  function clearSelectedRows() {
    document
      .querySelectorAll(".attribute-table-row.is-selected")
      .forEach((row) => row.classList.remove("is-selected"));
  }

  // ------------------------- HIGHLIGHT HELPERS -------------------------
  function dissolveHighlightFeature(feature) {
    if (
      !feature ||
      !feature.geometry ||
      feature.geometry.type !== "MultiPolygon" ||
      !Array.isArray(feature.geometry.coordinates) ||
      feature.geometry.coordinates.length < 2 ||
      typeof turf === "undefined" ||
      typeof turf.polygon !== "function" ||
      typeof turf.union !== "function"
    ) {
      return feature;
    }

    try {
      const props = feature.properties || {};
      const parts = feature.geometry.coordinates.map((coords) =>
        turf.polygon(coords, props)
      );
      let dissolved = parts[0];
      for (let i = 1; i < parts.length; i++) {
        dissolved = turf.union(dissolved, parts[i]) || dissolved;
      }
      return {
        ...dissolved,
        id: feature.id,
        properties: props,
      };
    } catch (err) {
      console.warn("Could not dissolve highlight multipolygon", err);
      return feature;
    }
  }

  function polygonFeatureToLineFeature(feature) {
    if (!feature || !feature.geometry) return feature;
    const geom = feature.geometry;
    if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
      return feature;
    }

    const lines = [];
    const addRing = (ring) => {
      if (Array.isArray(ring) && ring.length > 1) {
        lines.push(ring);
      }
    };

    if (geom.type === "Polygon") {
      geom.coordinates.forEach(addRing);
    } else {
      geom.coordinates.forEach((polygon) => polygon.forEach(addRing));
    }

    if (!lines.length) return feature;

    return {
      type: "Feature",
      id: feature.id,
      properties: feature.properties || {},
      geometry: lines.length === 1
        ? { type: "LineString", coordinates: lines[0] }
        : { type: "MultiLineString", coordinates: lines },
    };
  }

  function setHighlight(feature) {
    const map = API.map;
    if (!map || !map.getSource(H_SRC)) return;
    if (!feature || !feature.geometry) {
      map.getSource(H_SRC).setData({
        type: "FeatureCollection",
        features: [],
      });
      return;
    }
    const displayFeature = polygonFeatureToLineFeature(
      dissolveHighlightFeature(feature)
    );
    const fc = {
      type: "FeatureCollection",
      features: [displayFeature],
    };
    map.getSource(H_SRC).setData(fc);

    try {
      if (map.getLayer(H_LINE)) map.moveLayer(H_LINE);
      if (map.getLayer(H_POINT)) map.moveLayer(H_POINT);
    } catch (e) {
      // ignore
    }
  }

  function clearHighlight() {
    const map = API.map;
    if (!map || !map.getSource(H_SRC)) return;
    map.getSource(H_SRC).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  // ------------------------- LAYER Z-ORDER -------------------------
  // User-controlled stacking order for raster overlays (irrigation / WaPOR /
  // suitability). Array of map-layer ids, index 0 = TOP-most. Persisted so the
  // chosen order survives reloads. The ↑/↓ controls injected per active layer
  // reorder this; updateLayerZOrder() honours it.
  const _OVERLAY_ORDER_KEY = "iv:overlay-order";
  let _overlayOrder = [];
  try {
    const _raw = localStorage.getItem(_OVERLAY_ORDER_KEY);
    if (_raw) _overlayOrder = JSON.parse(_raw) || [];
  } catch (_) { _overlayOrder = []; }

  function updateLayerZOrder() {
    const map = API.map;
    if (!map) return;

    const leaves = document.querySelectorAll(
      ".layer-leaf input[name='layer'], label input[name='layer']"
    );
    const seen = new Set();
    const layerIds = [];

    leaves.forEach((cb) => {
      if (!cb.checked) return;
      const id = cb.dataset.id;
      const dataset = cb.value;
      if (!id || !dataset) return;

      const isBoundary = dataset.startsWith("BOUNDARY_");
      const isSocio = id.startsWith("SOC_");

      let mapLayerId;
      if (isBoundary) {
        mapLayerId = `${id}_line`;
      } else if (isSocio) {
        mapLayerId = `${id}_soc_layer`;
      } else {
        mapLayerId = id;
      }

      if (!seen.has(mapLayerId) && map.getLayer(mapLayerId)) {
        seen.add(mapLayerId);
        layerIds.push(mapLayerId);
      }
    });

    // Apply the user's chosen stacking for tracked raster overlays (index 0 =
    // top). Untracked layers (e.g. boundary lines) sort to the top as before.
    layerIds.sort((a, b) => {
      const ia = _overlayOrder.indexOf(a);
      const ib = _overlayOrder.indexOf(b);
      if (ia === -1 && ib === -1) return 0;   // both untracked: keep DOM order
      if (ia === -1) return -1;
      if (ib === -1) return 1;
      return ia - ib;                          // tracked: lower index = higher
    });

    for (let i = layerIds.length - 1; i >= 0; i--) {
      const lid = layerIds[i];
      if (map.getLayer(lid)) map.moveLayer(lid);
    }

    // Keep draw layers + highlight on top
    try {
      const style = map.getStyle();
      if (style && style.layers) {
        style.layers
          .filter((l) => l.id && l.id.startsWith("gl-draw-"))
          .forEach((l) => {
            if (map.getLayer(l.id)) map.moveLayer(l.id);
          });
      }
    } catch (e) {
      console.warn("Could not reorder draw layers", e);
    }

    try {
      if (map.getLayer(H_LINE)) map.moveLayer(H_LINE);
      if (map.getLayer(H_POINT)) map.moveLayer(H_POINT);
    } catch (e) {
      // ignore
    }
  }

  function _saveOverlayOrder() {
    try { localStorage.setItem(_OVERLAY_ORDER_KEY, JSON.stringify(_overlayOrder)); } catch (_) {}
  }

  // Overlay ids currently on the map, in stacking order (index 0 = top).
  function _activeOverlayIds() {
    const map = API.map;
    if (!map) return [];
    return _overlayOrder.filter((lid) => map.getLayer(lid));
  }

  // Enable/disable a control's arrows based on this layer's position among the
  // currently-active overlays.
  function _syncOrderControl(wrap) {
    const id = wrap.dataset.for;
    const active = _activeOverlayIds();
    const pos = active.indexOf(id);
    const up = wrap.querySelector(".layer-order-up");
    const down = wrap.querySelector(".layer-order-down");
    if (up) up.disabled = pos <= 0;                        // already on top / alone
    if (down) down.disabled = pos === -1 || pos >= active.length - 1;
    // Hide entirely when there's nothing to reorder against.
    wrap.style.display = active.length > 1 ? "" : "none";
  }

  function _syncAllOrderControls() {
    document.querySelectorAll(".layer-order-control").forEach(_syncOrderControl);
  }

  // dir: -1 = move up (toward top), +1 = move down (toward bottom). Moves
  // relative to the nearest *active* overlay so inactive layers don't block.
  function _moveOverlay(id, dir) {
    const active = _activeOverlayIds();
    const pos = active.indexOf(id);
    if (pos < 0) return;
    const swapPos = pos + dir;
    if (swapPos < 0 || swapPos >= active.length) return;
    const otherId = active[swapPos];
    const i = _overlayOrder.indexOf(id);
    const j = _overlayOrder.indexOf(otherId);
    if (i < 0 || j < 0) return;
    [_overlayOrder[i], _overlayOrder[j]] = [_overlayOrder[j], _overlayOrder[i]];
    _saveOverlayOrder();
    updateLayerZOrder();
    _syncAllOrderControls();
  }

  // Inject ↑/↓ stacking controls into a raster overlay's sidebar row.
  function attachLayerOrderControls(id) {
    if (!id) return;
    if (!_overlayOrder.includes(id)) {
      _overlayOrder.unshift(id);   // newly added overlay starts on top
      _saveOverlayOrder();
    }
    const cb = document.querySelector(`input[name="layer"][data-id="${id}"]`);
    if (!cb) return;
    const row = cb.closest(".layer-leaf, .layer-leaf-with-picker, .form-check, label");
    if (!row) return;
    if (row.querySelector(`.layer-order-control[data-for="${id}"]`)) {
      _syncAllOrderControls();
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "layer-order-control";
    wrap.dataset.for = id;
    wrap.innerHTML = `
      <button type="button" class="layer-order-up" title="Move this layer above the other" aria-label="Move layer up">▲</button>
      <button type="button" class="layer-order-down" title="Move this layer below the other" aria-label="Move layer down">▼</button>
    `;
    row.appendChild(wrap);
    wrap.querySelector(".layer-order-up").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation(); _moveOverlay(id, -1);
    });
    wrap.querySelector(".layer-order-down").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation(); _moveOverlay(id, +1);
    });
    _syncAllOrderControls();
  }

  function detachLayerOrderControls(id) {
    const el = document.querySelector(`.layer-order-control[data-for="${id}"]`);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    _syncAllOrderControls();
  }

  // Raster overlays announce themselves via iv:layer-added — attach controls.
  document.addEventListener("iv:layer-added", (e) => {
    if (e.detail && e.detail.type === "raster" && e.detail.id) {
      attachLayerOrderControls(e.detail.id);
    }
  });

  // ------------------------- MAP SPINNER HELPERS -------------------------
  function showMapSpinner(message) {
    if (!mapLoadingOverlay) return;
    if (mapLoadingTextEl && message) {
      mapLoadingTextEl.textContent = message;
    }
    mapLoadingOverlay.classList.remove("d-none");
  }

  function hideMapSpinner() {
    if (!mapLoadingOverlay) return;
    mapLoadingOverlay.classList.add("d-none");
  }

  // ------------------------- BASEMAPS -------------------------
  function addBasemapLayers() {
    const map = API.map;
    if (!map) return;
    Object.entries(BASEMAPS).forEach(([id, cfg]) => {
      if (!map.getSource(cfg.sourceId)) {
        map.addSource(cfg.sourceId, {
          type: "raster",
          tiles: cfg.tiles,
          tileSize: cfg.tileSize || 256,
        });
      }
      if (!map.getLayer(cfg.layerId)) {
        map.addLayer({
          id: cfg.layerId,
          type: "raster",
          source: cfg.sourceId,
          layout: {
            visibility: id === currentBasemapId ? "visible" : "none",
          },
        });
      }
    });
  }

  function setBasemap(id) {
    const map = API.map;
    if (!map || !BASEMAPS[id]) return;
    currentBasemapId = id;
    Object.entries(BASEMAPS).forEach(([bid, cfg]) => {
      if (!map.getLayer(cfg.layerId)) return;
      map.setLayoutProperty(
        cfg.layerId,
        "visibility",
        bid === id ? "visible" : "none"
      );
    });
    // Let other UIs (Tweaks panel, etc.) sync their selected state.
    document.dispatchEvent(
      new CustomEvent("iv:basemap-changed", { detail: { id } })
    );
  }

  // Expose current basemap id so panels can read initial state.
  API.getCurrentBasemapId = () => currentBasemapId;

  function attachBasemapSwitcher() {
    if (!basemapSwitcher) return;
    basemapSwitcher.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-basemap]");
      if (!btn) return;
      const id = btn.dataset.basemap;
      if (!BASEMAPS[id]) return;

      basemapSwitcher.querySelectorAll("button[data-basemap]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });

      setBasemap(id);
    });
  }

  // ------------------------- RASTER (SUITABILITY) -------------------------
  function normalizeRasterBounds(bounds) {
    if (!bounds) return null;
    const west = Number(bounds.west);
    const south = Number(bounds.south);
    const east = Number(bounds.east);
    const north = Number(bounds.north);
    if (![west, south, east, north].every(Number.isFinite)) return null;
    if (west < -180 || east > 180 || south < -90 || north > 90) return null;
    if (west >= east || south >= north) return null;
    return { west, south, east, north };
  }

  function removeMapLayer(id) {
    const map = API.map;
    if (!map || !id) return;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
    detachLayerOrderControls(id);
    updateLayerZOrder();
  }

  // ---------- Layer opacity ----------
  // Opacity is driven by the single global "Layer opacity" slider in the
  // tweaks panel (see ui.js). These helpers apply/persist it per layer;
  // values survive reloads via localStorage keyed by layer id.
  const _LAYER_OPACITY_KEY = (id) => `iv:layer-opacity:${id}`;

  // Hard guard: any of these prefixes / exact ids identifies a basemap or
  // map-decoration layer that the opacity setter must NEVER touch.
  function isBasemapLayerId(id) {
    if (!id) return true;
    if (id.startsWith("basemap")) return true;
    // Map-decoration ids used elsewhere (boundary highlight, etc.).
    if (id === "boundary-highlight"
        || id === "boundary-highlight-line"
        || id === "boundary-highlight-point") return true;
    return false;
  }

  // Defensive: re-pin every basemap raster to full opacity. If some other
  // code path ever wrote raster-opacity < 1 on a basemap, this restores it
  // the next time any per-layer slider is touched.
  function restoreBasemapOpacity() {
    const map = API.map;
    if (!map || typeof map.getStyle !== "function") return;
    try {
      (map.getStyle().layers || []).forEach((l) => {
        if (l.type === "raster" && isBasemapLayerId(l.id)) {
          map.setPaintProperty(l.id, "raster-opacity", 1);
        }
      });
    } catch (_) { /* style not ready */ }
  }

  function setLayerOpacityPct(id, pct) {
    const map = API.map;
    if (!map || !id) return;
    if (isBasemapLayerId(id)) return;  // never dim the basemap
    restoreBasemapOpacity();           // keep basemap at 1 in case anything drifted
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const op = clamped / 100;
    try {
      if (!map.getLayer(id)) return;
      const ltype = map.getLayer(id).type;
      if (ltype === "raster") {
        map.setPaintProperty(id, "raster-opacity", op);
      } else if (ltype === "fill") {
        map.setPaintProperty(id, "fill-opacity", op);
      } else if (ltype === "line") {
        map.setPaintProperty(id, "line-opacity", op);
      } else if (ltype === "circle") {
        map.setPaintProperty(id, "circle-opacity", op);
      }
    } catch (_) { /* layer not present */ }
    localStorage.setItem(_LAYER_OPACITY_KEY(id), String(clamped));
  }

  API.setLayerOpacityPct = setLayerOpacityPct;
  API.restoreBasemapOpacity = restoreBasemapOpacity;

  function isCategoricalRasterDataset(dataset, isSuitability) {
    if (isSuitability) return true;
    if (!dataset) return false;
    if (dataset.startsWith("IRR_SA_")) {
      const band = (dataset.split("?")[1] || "filtered").toLowerCase();
      return band !== "probability";
    }
    return false;
  }

  function rasterPaintForDataset(dataset, isSuitability) {
    const categorical = isCategoricalRasterDataset(dataset, isSuitability);
    return {
      "raster-resampling": categorical ? "nearest" : "linear",
      "raster-fade-duration": categorical ? 0 : 150,
    };
  }

  function addRasterMapLayer(id, dataset, isSuitability) {
    const map = API.map;
    if (!map || !id) return;
    map.addLayer({
      id,
      type: "raster",
      source: id,
      paint: rasterPaintForDataset(dataset, isSuitability),
    });
  }

  async function addRasterLayer(dataset, id, label, isSuitability, analysisManager) {
    const map = API.map;
    if (!map || !dataset || !id) return;

    if (map.getSource(id)) {
      if (!map.getLayer(id)) {
        addRasterMapLayer(id, dataset, isSuitability);
      }
      if (isSuitability && analysisManager) {
        const bounds = rasterMetaById[id] ? rasterMetaById[id].bounds : null;
        analysisManager.setSuitability({ id, dataset, label }, bounds || null);
        showLegend();
        setAnalysisHtml(
          "<em>Draw a polygon on the map (analysis runs automatically) or click a boundary and use “Run analysis” in the popup.</em>"
        );
      }
      // Let the tweaks-panel slider apply the current opacity to this layer.
      document.dispatchEvent(
        new CustomEvent("iv:layer-added", { detail: { id, type: "raster" } })
      );
      updateLayerZOrder();
      return;
    }

    try {
      const loadingMsg = _t("status_loading_tiles", "Loading map tiles…");
      setStatus(loadingMsg, false);
      showMapSpinner(loadingMsg);

      const url = API.geeMap || "/api/gee/map/";
      const palette =
        (typeof window.IV_SUIT_PALETTE_NAME === "string" && window.IV_SUIT_PALETTE_NAME) ||
        localStorage.getItem("iv:palette") ||
        "verdant";
      const resp = await fetch(
        `${url}?dataset=${encodeURIComponent(dataset)}` +
        `&palette=${encodeURIComponent(palette)}`
      );
      if (!resp.ok) {
        const txt = await resp.text();
        console.error("gee_map HTTP error", resp.status, txt);
        hideMapSpinner();
        setStatus(`Map request failed (${resp.status})`, true);
        return;
      }
      const data = await resp.json();

      if (!data.configured || !data.tile_url) {
        console.error("gee_map not configured", data);
        hideMapSpinner();
        setStatus(data.message || "Map configuration failed.", true);
        return;
      }

      const tileUrl = data.tile_url;
      const bounds = normalizeRasterBounds(data.bounds);
      rasterMetaById[id] = {
        bounds,
      };

      const sourceConfig = {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        // EE serves tiles well past z16; keep the cap high enough that 10 m
        // irrigation pixels stay native instead of becoming overzoomed haze.
        maxzoom: 18,
      };
      if (bounds) {
        sourceConfig.bounds = [bounds.west, bounds.south, bounds.east, bounds.north];
      }
      map.addSource(id, sourceConfig);

      addRasterMapLayer(id, dataset, isSuitability);

      // Let the tweaks panel re-apply its opacity to the new layer.
      document.dispatchEvent(
        new CustomEvent("iv:layer-added", { detail: { id, type: "raster" } })
      );

      const onSourceData = (e) => {
        if (e.sourceId === id && e.sourceDataType === "content") {
          hideMapSpinner();
          map.off("sourcedata", onSourceData);
        }
      };
      map.on("sourcedata", onSourceData);

      if (isSuitability && analysisManager) {
        analysisManager.setSuitability({ id, dataset, label }, bounds);
        setAnalysisHtml(
          "<em>Draw a polygon on the map (analysis runs automatically) or click a boundary and use “Run analysis” in the popup.</em>"
        );
      }

      // Deliberately do NOT recenter/zoom when a raster layer is toggled on.
      // These layers (suitability, SA irrigation, WaPOR) now span most of the
      // country, so fitting the camera to their bounds just zoomed the user
      // out to all of South Africa. Keep the user's current view instead.

      setStatus(_t("status_map_loaded", "Map loaded."), false);
      updateLayerZOrder();
    } catch (err) {
      console.error("Failed to add raster layer", err);
      hideMapSpinner();
      const detail = err && err.message ? ` ${err.message}` : "";
      setStatus(
        `${_t("status_tiles_failed", "Failed to load tiles from Earth Engine.")}${detail}`,
        true
      );
    }
  }

  // ------------------------- LAYER TREE & DRAG -------------------------
  function wireLayerTreeGroups() {
    document.querySelectorAll(".layer-toggle").forEach((header) => {
      header.addEventListener("click", () => {
        const group = header.closest(".layer-group");
        if (!group) return;
        group.classList.toggle("open");
      });
    });
  }

  function wireLayerGroupDragAndDrop() {
    const tree = document.querySelector(".layer-tree");
    if (!tree) return;

    const groups = tree.querySelectorAll(".layer-group");
    groups.forEach((li) => {
      li.setAttribute("draggable", "true");
    });

    let dragEl = null;

    tree.addEventListener("dragstart", (e) => {
      const li = e.target.closest(".layer-group");
      if (!li) return;
      dragEl = li;
      e.dataTransfer.effectAllowed = "move";
    });

    tree.addEventListener("dragover", (e) => {
      const li = e.target.closest(".layer-group");
      if (!li || li === dragEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    tree.addEventListener("drop", (e) => {
      const li = e.target.closest(".layer-group");
      if (!li || !dragEl || li === dragEl) return;
      e.preventDefault();

      const parent = li.parentNode;
      parent.insertBefore(dragEl, li);

      dragEl = null;
      updateLayerZOrder();
    });

    tree.addEventListener("dragend", () => {
      dragEl = null;
    });
  }

  // ------------------------- DRAW TOOLBAR -------------------------
  function attachDrawToolbarEvents(analysisManager) {
    const draw = API.draw;
    if (!drawToolbar || !draw) return;

    drawToolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;

      const mode = btn.dataset.mode;

      drawToolbar.querySelectorAll("button[data-mode]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });

      if (mode === "select") {
        draw.changeMode("simple_select");
        setStatus(_t("status_pan_or_select", "Pan the map or select existing shapes."), false);
        return;
      }

      if (mode === "polygon") {
        draw.changeMode("draw_polygon");
        setStatus(
          "Click on the map to add vertices. Click ✓ (or press Enter) to finish.",
          false
        );
        return;
      }

      if (mode === "finish") {
        // Force-finalize the in-progress polygon. MapboxDraw's onStop for
        // draw_polygon commits the polygon when we change modes (if it has
        // >=3 vertices), which fires draw.create. The draw.create handler in
        // map-init.js then opens the popup — we DON'T open one here too, or
        // we'd end up with two popups for the same polygon.
        let currentMode;
        try { currentMode = draw.getMode(); } catch (_) { currentMode = ""; }
        if (currentMode !== "draw_polygon") {
          setStatus("Nothing to finish — click ▭ to start drawing.", false);
          return;
        }
        try { draw.changeMode("simple_select"); } catch (_) {}
        setStatus("Polygon finished.", false);
        drawToolbar.querySelectorAll("button[data-mode]").forEach((b) => {
          b.classList.toggle("active", b.dataset.mode === "select");
        });
        return;
      }

      if (mode === "clear") {
        const fc = draw.getAll();
        if (fc && fc.features && fc.features.length) {
          draw.deleteAll();
        }
        setStatus(_t("status_shapes_cleared", "All drawn shapes cleared."), false);
        analysisManager.resetForDrawDelete();
        clearHighlight();

        draw.changeMode("simple_select");
        drawToolbar
          .querySelectorAll("button[data-mode]")
          .forEach((b) =>
            b.classList.toggle("active", b.dataset.mode === "select")
          );
      }
    });
  }

  // ------------------------- SEARCH & LOCATE -------------------------
  function attachSearchAndLocate() {
    const map = API.map;
    if (!map) return;

    if (searchBtn && searchInput) {
      const doSearch = async () => {
        const q = (searchInput.value || "").trim();
        if (!q) return;

        try {
          setStatus(`Searching for “${q}”…`, false);
          const resp = await fetch(
            "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
              encodeURIComponent(q),
            {
              headers: { Accept: "application/json" },
            }
          );
          if (!resp.ok) {
            setStatus(_t("status_search_failed", "Location search failed."), true);
            return;
          }
          const results = await resp.json();
          if (!results.length) {
            setStatus(_t("status_search_no_results", "No results for that place."), true);
            return;
          }
          const r = results[0];
          const lon = parseFloat(r.lon);
          const lat = parseFloat(r.lat);
          map.flyTo({ center: [lon, lat], zoom: 10 });
          setStatus(`Centered on ${r.display_name}`, false);
        } catch (err) {
          console.error("Search error", err);
          setStatus(_t("status_search_error", "Search error."), true);
        }
      };

      searchBtn.addEventListener("click", doSearch);
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doSearch();
        }
      });
    }

    if (locateBtn) {
      locateBtn.addEventListener("click", () => {
        if (!navigator.geolocation) {
          setStatus(_t("status_geo_unsupported", "Geolocation not supported in this browser."), true);
          return;
        }
        setStatus(_t("status_locating", "Locating…"), false);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            map.flyTo({ center: [longitude, latitude], zoom: 12 });
            setStatus(_t("status_centered_on_loc", "Centered on your location."), false);
          },
          (err) => {
            console.error("Geolocation error", err);
            if (err.code === 1) {
              setStatus(_t("status_geo_denied", "Location permission denied."), true);
            } else {
              setStatus(_t("status_geo_unavailable", "Could not get your location."), true);
            }
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000,
          }
        );
      });
    }
  }

  // ------------------------- LAYER CHECKBOXES -------------------------
  function attachLayerEvents(analysisManager, boundaryManager, socioManager) {
    layerCheckboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        const dataset = cb.value;
        const id = cb.dataset.id;
        const labelText =
          cb.closest("label")?.querySelector("span.layer-label")?.textContent ||
          cb.closest("label")?.querySelector("span")?.textContent ||
          dataset;

        if (!dataset || !id) return;

        const isBoundary = dataset.startsWith("BOUNDARY_");
        const isSocio = id.startsWith("SOC_");
        const isIrrigation = dataset.startsWith("IRR_SA_");
        const isWapor = dataset.startsWith("WAPOR_SA_");
        const isSuitability =
          dataset.startsWith("projects/") && !isSocio && !isBoundary;

        const isTurningOn = cb.checked;
        const selectedCountry = getCurrentCountry();
        const isZimbabwe = selectedCountry === "Zimbabwe";

        // Block suitability + socio for non-Zimbabwe countries (no data yet).
        // Boundaries work for any country whose backend mapping is configured.
        if (!isZimbabwe && isTurningOn && (isSuitability || isSocio)) {
          cb.checked = false;
          const msg = isSuitability
            ? "Suitability layers are currently only available for Zimbabwe."
            : `Layers for ${selectedCountry} are not configured yet.`;
          setStatus(msg, true);
          return;
        }

        if (isSuitability) {
          if (cb.checked) {
            // Single-select: uncheck & remove other suitability rasters.
            layerCheckboxes.forEach((other) => {
              const otherDataset = other.value;
              const otherId = other.dataset.id;
              const otherIsSocio = otherId && otherId.startsWith("SOC_");
              const otherIsBoundary =
                otherDataset && otherDataset.startsWith("BOUNDARY_");
              if (
                other !== cb &&
                otherDataset &&
                otherDataset.startsWith("projects/") &&
                !otherIsSocio &&
                !otherIsBoundary
              ) {
                other.checked = false;
                removeMapLayer(otherId);
              }
            });

            addRasterLayer(dataset, id, labelText, true, analysisManager);
          } else {
            removeMapLayer(id);
            analysisManager.clearSuitability();
          }
        }

        if (isBoundary) {
          if (cb.checked) {
            // Single-select within the boundary group — only one admin level
            // visible at a time, since stacked admin lines just clutter the map.
            layerCheckboxes.forEach((other) => {
              if (other === cb) return;
              const otherDataset = other.value || "";
              if (other.checked && otherDataset.startsWith("BOUNDARY_")) {
                other.checked = false;
                boundaryManager.removeBoundaryVectorLayer(other.dataset.id);
              }
            });
            clearHighlight();
            boundaryManager.addBoundaryVectorLayer(dataset, id, labelText);
          } else {
            boundaryManager.removeBoundaryVectorLayer(id);
            clearHighlight();
          }
        }

        if (isSocio) {
          if (cb.checked) {
            socioManager.addSocioLayerVector(dataset, id, labelText);
          } else {
            socioManager.removeSocioLayerVector(id);
          }
        }

        if (isIrrigation) {
          if (cb.checked) {
            // Multiple irrigation layers don't really make sense; uncheck any
            // sibling irrigation row so the map only shows one period/band.
            layerCheckboxes.forEach((other) => {
              if (other === cb) return;
              const od = other.value || "";
              if (other.checked && od.startsWith("IRR_SA_")) {
                other.checked = false;
                removeMapLayer(other.dataset.id);
              }
            });
            addRasterLayer(dataset, id, labelText, false, analysisManager);
            // Drive legend from the dataset's ?<band> suffix.
            const band = (dataset.split("?")[1] || "filtered").toLowerCase();
            showIrrigationLegend(band);
          } else {
            removeMapLayer(id);
            hideIrrigationLegend();
          }
        }

        if (isWapor) {
          if (cb.checked) {
            // Single-select: drop any other WaPOR dekads currently on so the
            // viewport only renders one dekad at a time.
            layerCheckboxes.forEach((other) => {
              if (other === cb) return;
              const od = other.value || "";
              if (other.checked && od.startsWith("WAPOR_SA_")) {
                other.checked = false;
                removeMapLayer(other.dataset.id);
              }
            });
            addRasterLayer(dataset, id, labelText, false, analysisManager);
            // Map the dekad suffix (D1/D2/D3) to its date so the legend can
            // pull the matching p2/p98 from /api/gee/wapor-periods/.
            const dekadKey = (dataset.split("?")[1] || "D2").toUpperCase();
            const dateMap = { D1: "2025-07-01", D2: "2025-07-11", D3: "2025-07-21" };
            showWaporLegend(dateMap[dekadKey]);
          } else {
            removeMapLayer(id);
            hideWaporLegend();
          }
        }

        updateLayerZOrder();
      });
    });
  }


  // ------------------------- LAYER TREE FILTER BY COUNTRY -------------------------
  function updateLayerTreeForCountry() {
    const selectedCountry = getCurrentCountry();
    currentCountry = selectedCountry; // keep in sync

    const matchesCountry = (leaf) => {
      const cb = leaf.querySelector('input[name="layer"]');
      const leafCountry =
        leaf.dataset.country ||
        (cb && cb.dataset.country) ||
        "Zimbabwe";
      return leafCountry === selectedCountry;
    };

    // Bootstrap utility classes (.d-flex on leaves) carry `!important`, so a
    // plain inline `display: none` is overridden. Use setProperty with the
    // "important" priority — and removeProperty to restore the class default.
    const setHidden = (el, hidden) => {
      if (hidden) {
        el.setAttribute("hidden", "");
        el.style.setProperty("display", "none", "important");
      } else {
        el.removeAttribute("hidden");
        el.style.removeProperty("display");
      }
    };

    // Pass 1: per-leaf — hide and uncheck wrong-country leaves.
    document.querySelectorAll(".layer-leaf").forEach((leaf) => {
      const cb = leaf.querySelector('input[name="layer"]');
      if (!cb) return;

      const isForSelectedCountry = matchesCountry(leaf);

      if (!isForSelectedCountry && cb.checked) {
        cb.checked = false;
        cb.dispatchEvent(new Event("change"));
      }

      setHidden(leaf, !isForSelectedCountry);
    });

    // Pass 2: hide layer groups whose leaves are all wrong-country, so empty
    // section headers (e.g. "Suitability maps" when South Africa is selected)
    // disappear instead of showing a header with nothing under it.
    let visibleGroupCount = 0;
    document.querySelectorAll(".layer-tree .layer-group").forEach((group) => {
      const leaves = group.querySelectorAll(".layer-leaf");
      let hasMatch = false;
      for (const leaf of leaves) {
        if (matchesCountry(leaf)) { hasMatch = true; break; }
      }
      if (hasMatch) visibleGroupCount += 1;
      setHidden(group, !hasMatch);
    });

    // Pass 3: show an empty-state if no group has any leaf for this country.
    // Substitutes the country name into the message; falls back to a generic
    // line when ivT is unavailable.
    const emptyEl = document.getElementById("layerTreeEmpty");
    const emptyText = document.getElementById("layerTreeEmptyText");
    if (emptyEl) {
      const showEmpty = visibleGroupCount === 0;
      emptyEl.classList.toggle("d-none", !showEmpty);
      if (showEmpty && emptyText) {
        const tmpl =
          (typeof window.ivT === "function"
            ? window.ivT(
                "layers_not_configured",
                "Layers for {country} are not configured yet."
              )
            : "Layers for {country} are not configured yet.");
        emptyText.textContent = tmpl.replace("{country}", selectedCountry);
      }
    }
  }




  // ------------------------- NAV & COUNTRY -------------------------
  function wireTopNavAndCountry(analysisManager) {
    if (navHomeBtn) {
      navHomeBtn.addEventListener("click", () => {
        if (API.resetView) {
          API.resetView();
        }
      });
    }

    // About/Help handled via modals

    if (countrySelect) {
      // Sync initial state from select
      currentCountry = getCurrentCountry();
      updateLayerTreeForCountry();

      countrySelect.addEventListener("change", () => {
        const country = getCurrentCountry();
        currentCountry = country;

        if (API.onCountryChange) {
          API.onCountryChange(country);
        }
        if (analysisManager) {
          analysisManager.resetForDrawDelete();
        }

        updateLayerTreeForCountry();
      });
    }
  }

  // ------------------------- EXPORT ON API -------------------------
  API.mapEl = mapEl;
  API.attributeTablesEl = attributeTablesEl;
  API.layerCheckboxes = layerCheckboxes;
  API.navHomeBtn = navHomeBtn;
  API.navAboutBtn = navAboutBtn;
  API.navHelpBtn = navHelpBtn;
  API.countrySelect = countrySelect;

  API.H_SRC = H_SRC;
  API.H_LINE = H_LINE;
  API.H_POINT = H_POINT;

  API.COUNTRY_BBOXES = COUNTRY_BBOXES;

  API.setStatus = setStatus;
  API.setAnalysisHtml = setAnalysisHtml;
  API.setActiveLayer = setActiveLayer;
  API.showLegend = showLegend;
  API.hideLegend = hideLegend;
  API.showIrrigationLegend = showIrrigationLegend;
  API.hideIrrigationLegend = hideIrrigationLegend;
  API.showWaporLegend = showWaporLegend;
  API.hideWaporLegend = hideWaporLegend;

  /**
   * Show a popup at ``lngLat`` for a freehand-drawn polygon. Mirrors the
   * boundary-click popup: lets the user choose an analysis type and run it
   * against the drawn polygon. Country-aware (SA has WaPOR + irrigation;
   * other countries reuse the suitability flow).
   */
  let _waporPopupPeriodsPromise = null;
  function _fetchWaporPopupPeriods() {
    if (!_waporPopupPeriodsPromise) {
      _waporPopupPeriodsPromise = fetch("/api/gee/wapor-periods/")
        .then((r) => r.json())
        .then((d) => Array.isArray(d.periods) ? d.periods : [])
        .catch(() => []);
    }
    return _waporPopupPeriodsPromise;
  }

  function _toggleWaporPopupPicker(popupEl) {
    const mode = popupEl.querySelector("#drawAnalysisType")?.value || "";
    const picker = popupEl.querySelector(".wapor-popup-picker");
    if (picker) picker.classList.toggle("d-none", mode !== "wapor_ts");
  }

  async function _populateWaporPopupPicker(popupEl) {
    const startEl = popupEl.querySelector(".wapor-popup-start-date");
    const endEl = popupEl.querySelector(".wapor-popup-end-date");
    if (!startEl || !endEl || popupEl.__waporPickerLoaded) return;
    const periods = await _fetchWaporPopupPeriods();
    popupEl.__waporPeriods = periods;
    if (!periods.length) {
      [startEl, endEl].forEach((el) => {
        el.value = "";
        el.removeAttribute("min");
        el.removeAttribute("max");
        el.disabled = true;
      });
      popupEl.__waporPickerLoaded = true;
      return;
    }
    const availableDates = periods.map((p) => p.dekad_date).filter(Boolean).sort();
    [startEl, endEl].forEach((el) => {
      el.min = availableDates[0] || "";
      el.max = availableDates[availableDates.length - 1] || "";
      el.dataset.availableDates = availableDates.join(",");
      el.disabled = false;
    });
    startEl.value = availableDates[0] || "";
    endEl.value = availableDates[availableDates.length - 1] || "";
    popupEl.__waporPickerLoaded = true;
  }

  function _selectedWaporPopupDateRange(popupEl) {
    return {
      start_date: popupEl.querySelector(".wapor-popup-start-date")?.value || "",
      end_date: popupEl.querySelector(".wapor-popup-end-date")?.value || "",
    };
  }

  function _isAvailableWaporPopupDate(popupEl, value) {
    const raw = popupEl.querySelector(".wapor-popup-start-date")?.dataset.availableDates || "";
    const dates = raw.split(",").filter(Boolean);
    return !dates.length || dates.includes(value);
  }

  function _runDrawAnalysis(mode, feature, analysisManager, opts = {}) {
    const fakeFeature = {
      geometry: feature.geometry,
      properties: { name: "Drawn polygon" },
    };
    if (mode === "wapor_ts") {
      analysisManager.runFreehandWaporTimeseries(feature.geometry, {
        start_date: opts.start_date || null,
        end_date: opts.end_date || null,
      });
    } else if (mode === "irrigation") {
      analysisManager.runBoundaryIrrigationAnalysis(fakeFeature, "Drawn polygon");
    } else {
      analysisManager.runFreehandAnalysis();
    }
  }

  function showDrawPolygonPopup(lngLat, feature, analysisManager) {
    // Keep drawn-polygon popups singleton-safe. Draw completion can emit
    // more than one event in quick succession (for example draw.create and
    // draw.update), so clear any previous drawn popup before creating another.
    try {
      if (API._activeDrawPolygonPopup) API._activeDrawPolygonPopup.remove();
    } catch (_) {}
    API._activeDrawPolygonPopup = null;
    try {
      document
        .querySelectorAll(".draw-polygon-popup")
        .forEach((el) => el.remove());
    } catch (_) {}

    const country = getCurrentCountry();
    const optsSA = `
      <option value="irrigation" selected>Irrigated area (ha)</option>
      <option value="wapor_ts">Crop water use (time series)</option>
    `;
    const optsOther = `
      <option value="soil" selected>Suitability (area)</option>
    `;
    const options = country === "South Africa" ? optsSA : optsOther;

    // Drawn polygon's area (geodesic, via turf) — mirrors the boundary popup.
    let areaHtml = "";
    if (feature && feature.geometry && typeof turf !== "undefined" && turf.area) {
      try {
        const ha = turf.area(feature) / 10000;
        const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
        areaHtml = `<div class="text-secondary small mb-2">Area: ${fmt(ha / 100)} km² (${fmt(ha)} ha)</div>`;
      } catch (_) {}
    }

    // Stack the select + button vertically so a narrow popup never clips
    // the Run-analysis button at the map edge.
    const html = `
      <div class="small popup-body" style="min-width: 220px;">
        <div class="fw-semibold mb-1">Drawn polygon</div>
        ${areaHtml}
        <label class="form-label form-label-sm mb-1">Analysis type</label>
        <select id="drawAnalysisType" class="form-select form-select-sm mb-2">
          ${options}
        </select>
        <div class="wapor-popup-picker mb-2 ${country === "South Africa" ? "" : "d-none"}">
          <label class="form-label form-label-sm mb-1">Start date</label>
          <input type="date" class="form-control form-control-sm mb-2 wapor-popup-start-date" disabled />
          <label class="form-label form-label-sm mb-1">End date</label>
          <input type="date" class="form-control form-control-sm wapor-popup-end-date" disabled />
        </div>
        <button id="drawAnalyzeBtn" type="button" class="btn btn-primary btn-sm w-100">
          Run analysis
        </button>
      </div>
    `;

    const defaultMode = country === "South Africa" ? "irrigation" : "soil";

    // Normalize the position to [lng, lat] array which MapLibre's setLngLat
    // accepts most reliably across versions.
    let normLngLat = lngLat;
    if (lngLat && Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat)) {
      normLngLat = [lngLat.lng, lngLat.lat];
    } else if (Array.isArray(lngLat) && lngLat.length >= 2) {
      normLngLat = [lngLat[0], lngLat[1]];
    }

    let popup = null;
    try {
      popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        className: "draw-polygon-popup",
        maxWidth: "240px",
        anchor: "bottom",
        offset: 12,
      })
        .setLngLat(normLngLat)
        .setHTML(html)
        .addTo(API.map);
    } catch (err) {
      console.warn("[draw popup] failed to render popup:", err, "pos:", normLngLat);
      return null;
    }

    // Backup close-button wiring: in some browsers / map states the built-in
    // close handler doesn't fire, leaving the popup stuck open. Explicitly
    // attach a listener to the close button so it always removes the popup.
    try {
      const root = popup.getElement && popup.getElement();
      if (root) {
        const closeBtn = root.querySelector(".maplibregl-popup-close-button")
          || root.querySelector(".mapboxgl-popup-close-button");
        if (closeBtn) {
          const stopPopupCloseEvent = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
          };
          ["pointerdown", "mousedown", "mouseup", "touchstart"].forEach((type) => {
            closeBtn.addEventListener(type, stopPopupCloseEvent, true);
          });
          closeBtn.addEventListener("click", (ev) => {
            stopPopupCloseEvent(ev);
            try { popup.remove(); } catch (_) {}
          }, true);
        }
      }
    } catch (_) { /* ignore */ }

    // Store handler state on the popup container so a single document-level
    // delegated listener can find it on click. Event delegation removes any
    // timing fragility from attaching listeners right after setHTML / addTo.
    const popupEl = popup.getElement && popup.getElement();
    if (popupEl) {
      popupEl.__drawAnalyzeFeature = feature;
      popupEl.__drawAnalyzeManager = analysisManager;
      popupEl.__drawAnalyzeDefaultMode = defaultMode;
      _toggleWaporPopupPicker(popupEl);
      _populateWaporPopupPicker(popupEl);
    }
    API._activeDrawPolygonPopup = popup;
    if (typeof popup.on === "function") {
      popup.on("close", () => {
        if (API._activeDrawPolygonPopup === popup) {
          API._activeDrawPolygonPopup = null;
        }
      });
    }

    return popup;
  }

  // One-time document-level click delegation for the Run analysis button.
  // Attached once on first call; subsequent popups share the same listener.
  let _drawAnalyzeDelegationInstalled = false;
  function _installDrawAnalyzeDelegation() {
    if (_drawAnalyzeDelegationInstalled) return;
    _drawAnalyzeDelegationInstalled = true;
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      const btn = t.closest("#drawAnalyzeBtn");
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const popupEl = btn.closest(".maplibregl-popup, .mapboxgl-popup");
      if (!popupEl) return;
      const feature = popupEl.__drawAnalyzeFeature;
      const manager = popupEl.__drawAnalyzeManager;
      const def = popupEl.__drawAnalyzeDefaultMode || "wapor_ts";
      if (!feature || !manager) return;
      const sel = popupEl.querySelector("#drawAnalysisType");
      const mode = sel ? sel.value : def;
      const range = _selectedWaporPopupDateRange(popupEl);
      if (mode === "wapor_ts" && (!range.start_date || !range.end_date)) {
        setStatus("Pick a WaPOR start and end date first.", true);
        _populateWaporPopupPicker(popupEl);
        return;
      }
      if (mode === "wapor_ts" && range.start_date > range.end_date) {
        setStatus("Start date must be before or equal to end date.", true);
        return;
      }
      if (
        mode === "wapor_ts" &&
        (!_isAvailableWaporPopupDate(popupEl, range.start_date) ||
          !_isAvailableWaporPopupDate(popupEl, range.end_date))
      ) {
        setStatus("Pick one of the available WaPOR dates.", true);
        return;
      }
      _runDrawAnalysis(mode, feature, manager, {
        start_date: range.start_date,
        end_date: range.end_date,
      });
    });
    document.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t || t.id !== "drawAnalysisType") return;
      const popupEl = t.closest(".maplibregl-popup, .mapboxgl-popup");
      if (!popupEl) return;
      _toggleWaporPopupPicker(popupEl);
      if ((t.value || "") === "wapor_ts") _populateWaporPopupPicker(popupEl);
    });
  }
  _installDrawAnalyzeDelegation();

  API.showDrawPolygonPopup = showDrawPolygonPopup;
  API.ensureAttributePanelVisible = ensureAttributePanelVisible;
  API.hideAttributePanelIfEmpty = hideAttributePanelIfEmpty;
  API.removeAttributeTableForLayer = removeAttributeTableForLayer;
  API.clearSelectedRows = clearSelectedRows;

  API.setHighlight = setHighlight;
  API.clearHighlight = clearHighlight;
  API.updateLayerZOrder = updateLayerZOrder;

  API.showMapSpinner = showMapSpinner;
  API.hideMapSpinner = hideMapSpinner;

  API.addBasemapLayers = addBasemapLayers;
  API.setBasemap = setBasemap;
  API.attachBasemapSwitcher = attachBasemapSwitcher;

  API.removeMapLayer = removeMapLayer;
  API.addRasterLayer = addRasterLayer;

  // Re-fetch the currently checked suitability raster — used by the Tweaks
  // panel after a palette swap so the EE tile repaints in the new colours.
  API.refreshActiveSuitability = function refreshActiveSuitability() {
    const checked = document.querySelector(
      'input[name="layer"][type="checkbox"]:checked'
    );
    if (!checked) return;
    const dataset = checked.value || "";
    const id = checked.dataset.id || "";
    if (!dataset.startsWith("projects/") || !id) return;
    if (id.startsWith("SOC_")) return; // socio FCs are not affected by palette
    const labelText =
      checked.closest("label")?.querySelector("span.layer-label")?.textContent ||
      dataset;
    // Drop the existing source/layer so the new tile URL is used.
    removeMapLayer(id);
    // analysisManager not needed for repaint — keep its cached suitability.
    addRasterLayer(dataset, id, labelText, true, API.analysisManager);
  };

  API.wireLayerTreeGroups = wireLayerTreeGroups;
  API.wireLayerGroupDragAndDrop = wireLayerGroupDragAndDrop;
  API.attachDrawToolbarEvents = attachDrawToolbarEvents;
  API.attachSearchAndLocate = attachSearchAndLocate;
  API.attachLayerEvents = attachLayerEvents;
  API.wireTopNavAndCountry = wireTopNavAndCountry;
  API.updateLayerTreeForCountry = updateLayerTreeForCountry;

  API.rasterMetaById = rasterMetaById;

  API.getLastSocioClickTime = () => lastSocioClickTime;
  API.setLastSocioClickTime = (t) => {
    lastSocioClickTime = t;
  };

  API.getCurrentCountry = getCurrentCountry;
})();
