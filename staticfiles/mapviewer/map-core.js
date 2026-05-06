/* global turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || {};
  window.MAPVIEWER = API;

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
    if (!info) {
      activeLayerEl.textContent = "none";
      return;
    }
    activeLayerEl.textContent = info.label || info.dataset || "active";
  }

  function showLegend() {
    if (!legendEl) return;
    legendEl.style.display = "block";
    legendEl.innerHTML = `
      <div class="legend-title">Suitability</div>
      <div class="legend-item">
        <span class="legend-color" style="background:#f1e5cd;"></span>
        <span>N</span>
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#166534;"></span>
        <span>S1</span>
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#22c55e;"></span>
        <span>S2</span>
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#fde047;"></span>
        <span>S3</span>
      </div>
    `;
  }

  function hideLegend() {
    if (!legendEl) return;
    legendEl.style.display = "none";
    legendEl.innerHTML = "";
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
  }

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
    updateLayerZOrder();
  }

  async function addRasterLayer(dataset, id, label, isSuitability, analysisManager) {
    const map = API.map;
    if (!map || !dataset || !id) return;

    if (map.getSource(id)) {
      if (!map.getLayer(id)) {
        map.addLayer({ id, type: "raster", source: id });
      }
      if (isSuitability && analysisManager) {
        const bounds = rasterMetaById[id] ? rasterMetaById[id].bounds : null;
        analysisManager.setSuitability({ id, dataset, label }, bounds || null);
        showLegend();
        setAnalysisHtml(
          "<em>Draw a polygon on the map (analysis runs automatically) or click a boundary and use “Run analysis” in the popup.</em>"
        );
      }
      updateLayerZOrder();
      return;
    }

    try {
      setStatus("Loading map tiles…", false);
      showMapSpinner("Loading map tiles…");

      const url = API.geeMap || "/api/gee/map/";
      const resp = await fetch(`${url}?dataset=${encodeURIComponent(dataset)}`);
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
        maxzoom: 7,
      };
      if (bounds) {
        sourceConfig.bounds = [bounds.west, bounds.south, bounds.east, bounds.north];
      }
      map.addSource(id, sourceConfig);

      map.addLayer({
        id,
        type: "raster",
        source: id,
      });

      const onSourceData = (e) => {
        if (e.sourceId === id && e.sourceDataType === "content") {
          hideMapSpinner();
          map.off("sourcedata", onSourceData);
        }
      };
      map.on("sourcedata", onSourceData);

      if (isSuitability && analysisManager) {
        analysisManager.setSuitability({ id, dataset, label }, bounds);

        if (bounds) {
          const b = bounds;
          map.fitBounds(
            [
              [b.west, b.south],
              [b.east, b.north],
            ],
            { padding: 40, duration: 800, maxZoom: 7 }
          );
        }

        setAnalysisHtml(
          "<em>Draw a polygon on the map (analysis runs automatically) or click a boundary and use “Run analysis” in the popup.</em>"
        );
      }

      setStatus("Map loaded.", false);
      updateLayerZOrder();
    } catch (err) {
      console.error("Failed to add raster layer", err);
      hideMapSpinner();
      const detail = err && err.message ? ` ${err.message}` : "";
      setStatus(`Failed to load tiles from Earth Engine.${detail}`, true);
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
        setStatus("Pan the map or select existing shapes.", false);
        return;
      }

      if (mode === "polygon") {
        draw.changeMode("draw_polygon");
        setStatus(
          "Click on the map to draw a polygon. Double-click to finish.",
          false
        );
        return;
      }

      if (mode === "clear") {
        const fc = draw.getAll();
        if (fc && fc.features && fc.features.length) {
          draw.deleteAll();
        }
        setStatus("All drawn shapes cleared.", false);
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
            setStatus("Location search failed.", true);
            return;
          }
          const results = await resp.json();
          if (!results.length) {
            setStatus("No results for that place.", true);
            return;
          }
          const r = results[0];
          const lon = parseFloat(r.lon);
          const lat = parseFloat(r.lat);
          map.flyTo({ center: [lon, lat], zoom: 10 });
          setStatus(`Centered on ${r.display_name}`, false);
        } catch (err) {
          console.error("Search error", err);
          setStatus("Search error.", true);
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
          setStatus("Geolocation not supported in this browser.", true);
          return;
        }
        setStatus("Locating…", false);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            map.flyTo({ center: [longitude, latitude], zoom: 12 });
            setStatus("Centered on your location.", false);
          },
          (err) => {
            console.error("Geolocation error", err);
            if (err.code === 1) {
              setStatus("Location permission denied.", true);
            } else {
              setStatus("Could not get your location.", true);
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
        const isSuitability =
          dataset.startsWith("projects/") && !isSocio && !isBoundary;

        const isTurningOn = cb.checked;
        const selectedCountry = getCurrentCountry();
        const isZimbabwe = selectedCountry === "Zimbabwe";

        // Only Zimbabwe has data for now. For South Africa & Angola keep UI empty.
        // Allow turning OFF, but block turning ON outside Zimbabwe.
        if (!isZimbabwe && isTurningOn) {
          cb.checked = false;

          let msg = `Layers for ${selectedCountry} are not configured yet.`;
          if (isSuitability) {
            msg = "Suitability layers are currently only available for Zimbabwe.";
          }

          setStatus(msg, true);
          return;
        }

        if (isSuitability) {
          if (cb.checked) {
            // Single-select: uncheck & remove other suitability rasters
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

        updateLayerZOrder();
      });
    });
  }


// ------------------------- LAYER TREE FILTER BY COUNTRY -------------------------
// ------------------------- LAYER TREE FILTER BY COUNTRY -------------------------
// ------------------------- LAYER TREE FILTER BY COUNTRY -------------------------
function updateLayerTreeForCountry() {
  const selectedCountry = getCurrentCountry();
  currentCountry = selectedCountry; // keep in sync

  document.querySelectorAll(".layer-leaf").forEach((leaf) => {
    // 🔹 Always keep rows visible so the tree is never empty
    leaf.style.display = "";

    const cb = leaf.querySelector('input[name="layer"]');
    if (!cb) return;

    // Read country from label or input (default Zimbabwe)
    const leafCountry = leaf.dataset.country || cb.dataset.country || "Zimbabwe";

    const isForSelectedCountry = leafCountry === selectedCountry;

    // 🔹 If switching away from this layer's country, force it off
    if (!isForSelectedCountry && cb.checked) {
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
    }

    // 🔹 Optional: visually dim layers that don't belong to the selected country
    leaf.classList.toggle("is-disabled-country", !isForSelectedCountry);
  });
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
