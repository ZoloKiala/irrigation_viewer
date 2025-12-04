/* global maplibregl, MapboxDraw, turf, Chart */

(function () {
  const API = window.MAPVIEWER || {};

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

  let map;
  let draw;
  let currentSuitability = null;   // {id, dataset, label}
  let currentSuitBounds = null;    // bounds from gee_map

  const boundaryVectorLayers = new Set(); // line layer ids
  const boundaryLayerData = {};          // boundary layer info

  const socioLayerData = {};             // socio layer info

  // Highlight layers
  const H_SRC = "boundary-highlight";
  const H_LINE = "boundary-highlight-line";
  const H_POINT = "boundary-highlight-point";

  // NEW: track last socio click to avoid double popup
  let lastSocioClickTime = 0;

  const BASEMAPS = {
    osm: {
      label: "Streets",
      sourceId: "basemap_osm",
      layerId: "basemap_osm",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256
    },
    terrain: {
      label: "Terrain",
      sourceId: "basemap_terrain",
      layerId: "basemap_terrain",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256
    },
    satellite: {
      label: "Satellite",
      sourceId: "basemap_satellite",
      layerId: "basemap_satellite",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256
    }
  };

  let currentBasemapId = "osm";
  let currentBoundaryFeature = null;

  // ---------------- helpers ----------------
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

  function ensureAttributePanelVisible() {
    // If you want auto-open uncomment:
    // if (attributePanel && attributePanel.classList.contains("d-none")) {
    //   attributePanel.classList.remove("d-none");
    // }
  }

  function hideAttributePanelIfEmpty() {
    if (!attributeTablesEl || !attributePanel) return;
    const hasTables = attributeTablesEl.querySelector(".attribute-table-wrapper");
    if (!hasTables) {
      // keep panel under user control; do not auto-hide
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

  function setHighlight(feature) {
    if (!map || !map.getSource(H_SRC)) return;
    if (!feature || !feature.geometry) {
      map.getSource(H_SRC).setData({
        type: "FeatureCollection",
        features: [],
      });
      return;
    }
    const fc = {
      type: "FeatureCollection",
      features: [feature],
    };
    map.getSource(H_SRC).setData(fc);

    try {
      if (map.getLayer(H_LINE)) map.moveLayer(H_LINE);
      if (map.getLayer(H_POINT)) map.moveLayer(H_POINT);
    } catch (e) {}
  }

  function clearHighlight() {
    if (!map || !map.getSource(H_SRC)) return;
    map.getSource(H_SRC).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  function geometryOverlapsSuitability(geom) {
    if (!currentSuitBounds) return true;
    try {
      const bbox = turf.bbox(geom); // [minX, minY, maxX, maxY]
      const [minX, minY, maxX, maxY] = bbox;
      const { west, east, south, north } = currentSuitBounds;
      if (minX > east || maxX < west || minY > north || maxY < south) {
        return false;
      }
      return true;
    } catch (err) {
      console.warn("geometryOverlapsSuitability failed", err);
      return true;
    }
  }

  // ---------------- layer z-order ----------------
  function updateLayerZOrder() {
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
    } catch (e) {}
  }

  // ---------------- basemaps ----------------
  function addBasemapLayers() {
    if (!map) return;
    Object.entries(BASEMAPS).forEach(([id, cfg]) => {
      if (!map.getSource(cfg.sourceId)) {
        map.addSource(cfg.sourceId, {
          type: "raster",
          tiles: cfg.tiles,
          tileSize: cfg.tileSize || 256
        });
      }
      if (!map.getLayer(cfg.layerId)) {
        map.addLayer({
          id: cfg.layerId,
          type: "raster",
          source: cfg.sourceId,
          layout: {
            visibility: id === currentBasemapId ? "visible" : "none"
          }
        });
      }
    });
  }

  function setBasemap(id) {
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

  // ---------------- raster (suitability) ----------------
  function removeMapLayer(id) {
    if (!map || !id) return;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
    updateLayerZOrder();
  }

  async function addRasterLayer(dataset, id, label, isSuitability) {
    if (!map || !dataset || !id) return;

    if (map.getSource(id)) {
      if (!map.getLayer(id)) {
        map.addLayer({ id, type: "raster", source: id });
      }
      if (isSuitability) {
        currentSuitability = { id, dataset, label };
        setActiveLayer(currentSuitability);
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

      const url = API.geeMap || "/api/gee/map/";
      const resp = await fetch(`${url}?dataset=${encodeURIComponent(dataset)}`);
      if (!resp.ok) {
        const txt = await resp.text();
        console.error("gee_map HTTP error", resp.status, txt);
        setStatus(`Map request failed (${resp.status})`, true);
        return;
      }
      const data = await resp.json();

      if (!data.configured || !data.tile_url) {
        console.error("gee_map not configured", data);
        setStatus(data.message || "Map configuration failed.", true);
        return;
      }

      const tileUrl = data.tile_url;

      map.addSource(id, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
      });

      map.addLayer({
        id,
        type: "raster",
        source: id,
      });

      currentSuitBounds = data.bounds || null;

      if (data.bounds && isSuitability) {
        const b = data.bounds;
        map.fitBounds(
          [
            [b.west, b.south],
            [b.east, b.north],
          ],
          { padding: 40, duration: 800 }
        );
      }

      if (isSuitability) {
        currentSuitability = { id, dataset, label };
        setActiveLayer(currentSuitability);
        showLegend();
        setAnalysisHtml(
          "<em>Draw a polygon on the map (analysis runs automatically) or click a boundary and use “Run analysis” in the popup.</em>"
        );
      }

      setStatus("Map loaded.", false);
      updateLayerZOrder();
    } catch (err) {
      console.error("Failed to add raster layer", err);
      setStatus("Failed to load tiles from Earth Engine.", true);
    }
  }

  // ---------------- admin boundaries ----------------
  async function addBoundaryVectorLayer(dataset, id, label) {
    if (!map || !dataset || !id) return;

    let level = 1;
    try {
      const match = dataset.match(/_L(\d+)/);
      level = match ? parseInt(match[1], 10) || 1 : 1;
    } catch (e) {
      level = 1;
    }

    const sourceId = `${id}_src`;
    const fillId = `${id}_fill`;
    const lineId = `${id}_line`;

    if (map.getSource(sourceId) && map.getLayer(lineId)) {
      const info = boundaryLayerData[id];
      if (info && info.features && info.features.length) {
        renderBoundaryAttributeTableForLayer(id, info.label, info.features, null);
      }
      updateLayerZOrder();
      return;
    }

    try {
      setStatus("Loading boundary polygons…", false);

      const url = API.geeBoundariesGeoJSON || "/api/gee/boundaries-geojson/";
      const resp = await fetch(`${url}?level=${level}`);

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("gee_boundaries_geojson HTTP error", resp.status, txt);
        setStatus(`Boundary polygons request failed (${resp.status})`, true);
        return;
      }

      const data = await resp.json();

      if (!data.configured) {
        console.error("gee_boundaries_geojson not configured", data);
        setStatus(data.message || "Could not load boundary polygons.", true);
        return;
      }

      const rawFeatures = data.features || [];
      const features = rawFeatures.map((f, idx) => {
        const props = (f && f.properties) || {};
        return {
          ...f,
          properties: {
            ...props,
            __idx: idx,
          },
        };
      });

      const fc = {
        type: data.type || "FeatureCollection",
        features,
      };

      map.addSource(sourceId, {
        type: "geojson",
        data: fc,
      });

      map.addLayer({
        id: fillId,
        type: "fill",
        source: sourceId,
        filter: ["==", "$type", "Polygon"],
        paint: {
          "fill-color": "#ffffff",
          "fill-opacity": 0.01,
        },
      });

      map.addLayer({
        id: lineId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#000000",
          "line-width": 1.5,
        },
      });

      boundaryVectorLayers.add(lineId);
      boundaryLayerData[id] = {
        label,
        sourceId,
        fillId,
        lineId,
        features,
      };

      map.on("mouseenter", fillId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", fillId, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", fillId, (e) => onBoundaryClick(e, id));

      ensureAttributePanelVisible();
      renderBoundaryAttributeTableForLayer(id, label, features, null);

      setStatus("", false);
      updateLayerZOrder();
    } catch (err) {
      console.error("Failed to add boundary vector layer", err);
      setStatus("Error loading boundary polygons.", true);
    }
  }

  function removeBoundaryVectorLayer(id) {
    if (!map || !id) return;
    const info = boundaryLayerData[id];
    const sourceId = info ? info.sourceId : `${id}_src`;
    const fillId = info ? info.fillId : `${id}_fill`;
    const lineId = info ? info.lineId : `${id}_line`;

    if (map.getLayer(fillId)) map.removeLayer(fillId);
    if (map.getLayer(lineId)) map.removeLayer(lineId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    boundaryVectorLayers.delete(lineId);
    delete boundaryLayerData[id];

    removeAttributeTableForLayer(id);
    updateLayerZOrder();
  }

  // ---------------- socio-economic layers ----------------
  async function addSocioLayerVector(dataset, id, label) {
    if (!map || !dataset || !id) return;

    if (socioLayerData[id] && map.getSource(socioLayerData[id].sourceId)) {
      ensureAttributePanelVisible();
      renderSocioAttributeTable(id, label, socioLayerData[id].features, null);
      updateLayerZOrder();
      return;
    }

    try {
      setStatus("Loading socio-economic features…", false);

      const url = API.geeSocioGeoJSON || "/api/gee/socio-geojson/";
      const resp = await fetch(`${url}?dataset=${encodeURIComponent(dataset)}`);

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("gee_socio_geojson HTTP error", resp.status, txt);
        setStatus(`Socio-economic features request failed (${resp.status})`, true);
        return;
      }

      const data = await resp.json();
      if (!data.configured) {
        console.error("gee_socio_geojson not configured", data);
        setStatus(data.message || "Could not load socio-economic features.", true);
        return;
      }

      const rawFeatures = data.features || [];
      const features = rawFeatures.map((f, idx) => {
        const props = (f && f.properties) || {};
        return {
          ...f,
          properties: {
            ...props,
            __idx: idx,
          },
        };
      });

      const fc = {
        type: data.type || "FeatureCollection",
        features,
      };

      const sourceId = `${id}_soc_src`;
      const layerId = `${id}_soc_layer`;

      map.addSource(sourceId, {
        type: "geojson",
        data: fc,
      });

      map.addLayer({
        id: layerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-radius": 5,
          "circle-color": "#22d3ee",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0f172a"
        }
      });

      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", layerId, (e) => onSocioClick(e, id, label));

      socioLayerData[id] = {
        dataset,
        label,
        sourceId,
        layerId,
        features,
      };

      if (features.length) {
        try {
          const bbox = turf.bbox(fc);
          map.fitBounds(
            [
              [bbox[0], bbox[1]],
              [bbox[2], bbox[3]],
            ],
            { padding: 40, duration: 800 }
          );
        } catch (e) {
          console.warn("Could not compute bbox for socio layer", e);
        }
      }

      ensureAttributePanelVisible();
      renderSocioAttributeTable(id, label, features, null);

      updateLayerZOrder();
      setStatus("", false);
    } catch (err) {
      console.error("Failed to add socio layer", err);
      setStatus("Error loading socio-economic features.", true);
    }
  }

  function removeSocioLayerVector(id) {
    if (!map) return;
    const info = socioLayerData[id];
    if (!info) {
      removeAttributeTableForLayer(id);
      return;
    }

    if (map.getLayer(info.layerId)) map.removeLayer(info.layerId);
    if (map.getSource(info.sourceId)) map.removeSource(info.sourceId);

    delete socioLayerData[id];
    removeAttributeTableForLayer(id);
    clearHighlight();
    updateLayerZOrder();
  }

  // -------- socio attribute table & zoom --------
  function renderSocioAttributeTable(layerId, label, features, selectedIndex) {
    if (!attributeTablesEl) return;

    removeAttributeTableForLayer(layerId);

    if (!features || !features.length) {
      attributeTablesEl.insertAdjacentHTML(
        "beforeend",
        `<div class="attribute-table-wrapper mb-3" data-layer-id="${layerId}">
           <div class="attribute-panel-title mb-1">${label}</div>
           <div class="small text-secondary"><em>No features.</em></div>
         </div>`
      );
      return;
    }

    const keySet = new Set();
    features.forEach((f) => {
      const props = (f && f.properties) || {};
      Object.keys(props).forEach((k) => {
        if (
          k === "system:index" ||
          k === ".geo" ||
          k === "__idx" ||
          k.toLowerCase().includes("geometry")
        ) return;
        keySet.add(k);
      });
    });
    const columns = Array.from(keySet).slice(0, 6);
    if (!columns.length) columns.push("id");

    const tableId = `attr-table-${layerId}`;
    const searchId = `attr-search-${layerId}`;
    const headerCells = columns.map((k) => `<th>${k}</th>`).join("");

    const rowsHtml = features
      .map((f, idx) => {
        const props = (f && f.properties) || {};
        const tds = columns.map((k) => {
          let v = props[k];
          if (v === null || v === undefined) v = "";
          return `<td>${String(v)}</td>`;
        }).join("");
        const selectedClass =
          typeof selectedIndex === "number" && selectedIndex === idx
            ? " is-selected"
            : "";
        return `<tr class="attribute-table-row${selectedClass}"
                    data-layer-id="${layerId}"
                    data-feature-index="${idx}">
                  ${tds}
                </tr>`;
      })
      .join("");

    const html = `
      <div class="attribute-table-wrapper mb-3" data-layer-id="${layerId}">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="attribute-panel-title">${label}</div>
          <div class="d-flex gap-2 align-items-center">
            <input id="${searchId}"
                   type="text"
                   class="form-control form-control-sm attribute-search-input"
                   placeholder="Search…"
                   data-target-table="${tableId}">
            <button type="button"
                    class="btn btn-outline-light btn-sm py-0 px-2"
                    data-zoom-layer-id="${layerId}">
              Zoom all
            </button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-dark table-striped align-middle mb-1 attribute-table"
                 id="${tableId}">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    attributeTablesEl.insertAdjacentHTML("beforeend", html);

    const wrapper = attributeTablesEl.querySelector(
      `.attribute-table-wrapper[data-layer-id="${layerId}"]`
    );
    if (!wrapper) return;

    wrapper.querySelectorAll(".attribute-table-row").forEach((row) => {
      row.addEventListener("click", () => {
        const idx = parseInt(row.dataset.featureIndex || "0", 10);
        clearSelectedRows();
        row.classList.add("is-selected");
        zoomToSocioFeature(layerId, idx);
      });
    });

    const searchInputEl = wrapper.querySelector(`#${searchId}`);
    if (searchInputEl) {
      searchInputEl.addEventListener("input", () => {
        const q = searchInputEl.value.toLowerCase();
        const rows = wrapper.querySelectorAll(".attribute-table-row");
        rows.forEach((r) => {
          const txt = r.textContent.toLowerCase();
          r.style.display = !q || txt.includes(q) ? "" : "none";
        });
      });
    }

    const zoomBtn = wrapper.querySelector("[data-zoom-layer-id]");
    if (zoomBtn) {
      zoomBtn.addEventListener("click", () => {
        zoomToSocioLayer(layerId);
      });
    }

    if (typeof selectedIndex === "number") {
      const targetRow = wrapper.querySelector(
        `.attribute-table-row[data-feature-index="${selectedIndex}"]`
      );
      if (targetRow && targetRow.scrollIntoView) {
        targetRow.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function zoomToSocioFeature(layerId, featureIndex) {
    if (!map) return;
    const info = socioLayerData[layerId];
    if (!info || !info.features || !info.features.length) return;
    const f = info.features[featureIndex];
    if (!f || !f.geometry) return;

    try {
      const bbox = turf.bbox(f);
      setHighlight(f);
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        {
          padding: 80,
          duration: 800,
          maxZoom: 11
        }
      );
    } catch (e) {
      console.error("zoomToSocioFeature failed", e);
    }
  }

  function zoomToSocioLayer(layerId) {
    if (!map) return;
    const info = socioLayerData[layerId];
    if (!info || !info.features || !info.features.length) return;
    try {
      const fc = { type: "FeatureCollection", features: info.features };
      const bbox = turf.bbox(fc);
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 60, duration: 800, maxZoom: 10 }
      );
    } catch (e) {
      console.error("zoomToSocioLayer failed", e);
    }
  }

  function onSocioClick(e, layerId, label) {
    // mark time so boundary click can ignore this
    lastSocioClickTime = Date.now();

    const info = socioLayerData[layerId];
    if (!info || !info.features || !info.features.length) return;
    if (!e.features || !e.features.length) return;

    const feature = e.features[0];
    setHighlight(feature);

    const idx =
      feature.properties && typeof feature.properties.__idx === "number"
        ? feature.properties.__idx
        : 0;

    ensureAttributePanelVisible();
    renderSocioAttributeTable(layerId, label, info.features, idx);

    const props = feature.properties || {};
    const title =
      props.name ||
      props.SCHEME_NAME ||
      props.project_name ||
      props.FACILITY ||
      label ||
      "Feature";

    const rowsHtml = Object.keys(props)
      .filter(
        (k) =>
          k !== "__idx" &&
          k !== ".geo" &&
          k !== "system:index" &&
          !k.toLowerCase().includes("geometry")
      )
      .map((k) => {
        let v = props[k];
        if (v === null || v === undefined) v = "";
        return `<tr><th class="pe-2">${k}</th><td>${String(v)}</td></tr>`;
      })
      .join("");

    const html = `
      <div class="small popup-body">
        <div class="fw-semibold mb-1">${title}</div>
        ${
          rowsHtml
            ? `<div class="table-responsive mb-1">
                 <table class="table table-sm table-dark mb-1">
                   <tbody>${rowsHtml}</tbody>
                 </table>
               </div>`
            : ""
        }
        <div class="text-secondary">
          Use the <strong>Attributes</strong> panel to browse the full table.
        </div>
      </div>
    `;

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "320px",
    });

    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  }

  // -------- boundary attribute table & zoom --------
  function renderBoundaryAttributeTableForLayer(layerId, label, features, selectedIndex) {
    if (!attributeTablesEl) return;

    removeAttributeTableForLayer(layerId);

    if (!features || !features.length) {
      attributeTablesEl.insertAdjacentHTML(
        "beforeend",
        `<div class="attribute-table-wrapper mb-3" data-layer-id="${layerId}">
           <div class="attribute-panel-title mb-2">${label} – boundaries</div>
           <div class="small text-secondary"><em>No features.</em></div>
         </div>`
      );
      return;
    }

    const keySet = new Set();
    features.forEach((f) => {
      const props = (f && f.properties) || {};
      Object.keys(props).forEach((k) => {
        if (
          k === "system:index" ||
          k === ".geo" ||
          k === "__idx" ||
          k.toLowerCase().includes("geometry")
        ) return;
        keySet.add(k);
      });
    });
    const columns = Array.from(keySet).slice(0, 6);
    if (!columns.length) columns.push("id");

    const tableId = `attr-table-${layerId}`;
    const searchId = `attr-search-${layerId}`;
    const headerCells = columns.map((k) => `<th>${k}</th>`).join("");

    const rowsHtml = features
      .map((f, idx) => {
        const props = (f && f.properties) || {};
        const tds = columns.map((k) => {
          let v = props[k];
          if (v === null || v === undefined) v = "";
          return `<td>${String(v)}</td>`;
        }).join("");
        const selectedClass =
          typeof selectedIndex === "number" && selectedIndex === idx
            ? " is-selected"
            : "";
        return `<tr class="attribute-table-row${selectedClass}"
                    data-layer-id="${layerId}"
                    data-feature-index="${idx}">
                  ${tds}
                </tr>`;
      })
      .join("");

    const html = `
      <div class="attribute-table-wrapper mb-3" data-layer-id="${layerId}">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="attribute-panel-title">${label} – boundaries</div>
          <div class="d-flex gap-2 align-items-center">
            <input id="${searchId}"
                   type="text"
                   class="form-control form-control-sm attribute-search-input"
                   placeholder="Search…"
                   data-target-table="${tableId}">
            <button type="button"
                    class="btn btn-outline-light btn-sm py-0 px-2"
                    data-zoom-layer-id="${layerId}">
              Zoom all
            </button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-dark table-striped align-middle mb-1 attribute-table"
                 id="${tableId}">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    attributeTablesEl.insertAdjacentHTML("beforeend", html);

    const wrapper = attributeTablesEl.querySelector(
      `.attribute-table-wrapper[data-layer-id="${layerId}"]`
    );
    if (!wrapper) return;

    wrapper.querySelectorAll(".attribute-table-row").forEach((row) => {
      row.addEventListener("click", () => {
        const idx = parseInt(row.dataset.featureIndex || "0", 10);
        clearSelectedRows();
        row.classList.add("is-selected");
        zoomToBoundaryFeature(layerId, idx);
      });
    });

    const searchInputEl = wrapper.querySelector(`#${searchId}`);
    if (searchInputEl) {
      searchInputEl.addEventListener("input", () => {
        const q = searchInputEl.value.toLowerCase();
        const rows = wrapper.querySelectorAll(".attribute-table-row");
        rows.forEach((r) => {
          const txt = r.textContent.toLowerCase();
          r.style.display = !q || txt.includes(q) ? "" : "none";
        });
      });
    }

    const zoomBtn = wrapper.querySelector("[data-zoom-layer-id]");
    if (zoomBtn) {
      zoomBtn.addEventListener("click", () => {
        zoomToBoundaryLayer(layerId);
      });
    }

    if (typeof selectedIndex === "number") {
      const targetRow = wrapper.querySelector(
        `.attribute-table-row[data-feature-index="${selectedIndex}"]`
      );
      if (targetRow && targetRow.scrollIntoView) {
        targetRow.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function zoomToBoundaryFeature(layerId, featureIndex) {
    if (!map) return;
    const info = boundaryLayerData[layerId];
    if (!info || !info.features || !info.features.length) return;
    const f = info.features[featureIndex];
    if (!f || !f.geometry) return;
    try {
      const bbox = turf.bbox(f);
      setHighlight(f);
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        {
          padding: 80,
          duration: 800,
          maxZoom: 10
        }
      );
    } catch (e) {
      console.error("zoomToBoundaryFeature failed", e);
    }
  }

  function zoomToBoundaryLayer(layerId) {
    if (!map) return;
    const info = boundaryLayerData[layerId];
    if (!info || !info.features || !info.features.length) return;
    try {
      const fc = { type: "FeatureCollection", features: info.features };
      const bbox = turf.bbox(fc);
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 60, duration: 800, maxZoom: 9 }
      );
    } catch (e) {
      console.error("zoomToBoundaryLayer failed", e);
    }
  }

  function onBoundaryClick(e, layerId) {
    // If click just came from socio layer, skip boundary popup
    if (Date.now() - lastSocioClickTime < 200) {
      return;
    }

    try {
      if (!e.features || !e.features.length) return;

      const feature = e.features[0];
      currentBoundaryFeature = feature;
      setHighlight(feature);
      updateLayerZOrder();

      const info = boundaryLayerData[layerId];
      if (info && info.features && info.features.length) {
        const idx =
          feature.properties && typeof feature.properties.__idx === "number"
            ? feature.properties.__idx
            : null;
        ensureAttributePanelVisible();
        renderBoundaryAttributeTableForLayer(
          layerId,
          info.label,
          info.features,
          idx
        );
      }

      const props = feature.properties || {};
      const name =
        props.ADM3_NAME ||
        props.ADM2_NAME ||
        props.ADM1_NAME ||
        props.ADM0_NAME ||
        props.name ||
        "Boundary";

      const html = `
        <div class="small popup-body">
          <div class="fw-semibold mb-1">${name}</div>
          <div class="mb-2">
            Use the attribute panel to explore full attributes.
          </div>
          <div class="d-flex justify-content-end mt-1">
            <button id="boundaryAnalyzeBtn" type="button"
                    class="btn btn-primary btn-sm">
              Run analysis
            </button>
          </div>
        </div>
      `;

      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
      })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);

      setTimeout(() => {
        const btn = document.getElementById("boundaryAnalyzeBtn");
        if (!btn) return;

        btn.addEventListener("click", () => {
          if (!currentSuitability) {
            setStatus("Select a suitability map first.", true);
            return;
          }
          runBoundaryAnalysis();
          popup.remove();
        });
      }, 0);
    } catch (err) {
      console.error("onBoundaryClick failed", err);
    }
  }

  // ---------------- analysis (draw + boundary) ----------------
  async function runFreehandAnalysis() {
    if (!currentSuitability) {
      setStatus("Select a suitability map first.", true);
      return;
    }
    const fc = draw && draw.getAll ? draw.getAll() : null;
    if (!fc || !fc.features || !fc.features.length) {
      setStatus("Draw a polygon first.", true);
      return;
    }

    const geom = fc.features[fc.features.length - 1].geometry;

    if (!geometryOverlapsSuitability(geom)) {
      setStatus(
        "Drawn polygon lies outside the current suitability map extent.",
        true
      );
      setAnalysisHtml(
        "<em>This polygon is outside the selected suitability map's coverage. Draw inside the mapped area or choose another map.</em>"
      );
      try {
        if (window.IrrChart && typeof window.IrrChart.clear === "function") {
          window.IrrChart.clear();
        }
      } catch (err) {
        console.error("IrrChart.clear failed:", err);
      }
      return;
    }

    try {
      setStatus("Running analysis…", false);

      const url = API.geeAnalyze || "/api/gee/analyze/";
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset: currentSuitability.dataset,
          geometry: geom,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("gee_analyze HTTP error", resp.status, txt);
        setStatus(`Analysis request failed (${resp.status})`, true);
        return;
      }

      const data = await resp.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const totalArea = items.reduce(
        (acc, it) => acc + (Number(it.area_ha) || 0),
        0
      );

      if (!items.length || totalArea < 1) {
        const msg =
          data.message ||
          "<em>No irrigated classes found in this polygon (likely outside coverage).</em>";
        setAnalysisHtml(
          typeof msg === "string" && !msg.startsWith("<em>")
            ? `<em>${msg}</em>`
            : msg
        );
        try {
          if (window.IrrChart && typeof window.IrrChart.clear === "function") {
            window.IrrChart.clear();
          }
        } catch (err) {
          console.error("IrrChart.clear failed:", err);
        }
        setStatus("Analysis complete (no classes / outside coverage).", false);
        return;
      }

      renderAnalysis("Polygon", items);
      setStatus("Analysis complete.", false);
    } catch (err) {
      console.error("Freehand analysis failed", err);
      setStatus("Analysis failed.", true);
    }
  }

  async function runBoundaryAnalysis() {
    if (!currentSuitability) {
      setStatus("Select a suitability map first.", true);
      return;
    }
    if (!currentBoundaryFeature || !currentBoundaryFeature.geometry) {
      setStatus("Click a boundary polygon first.", true);
      return;
    }

    const geom = currentBoundaryFeature.geometry;
    const props = currentBoundaryFeature.properties || {};
    const name =
      props.name ||
      props.ADM1_NAME ||
      props.ADM2_NAME ||
      props.ADM3_NAME ||
      "Boundary";

    if (!geometryOverlapsSuitability(geom)) {
      setStatus(
        "Selected boundary lies outside the current suitability map extent.",
        true
      );
      setAnalysisHtml(
        "<em>This boundary is outside the selected suitability map's coverage. Choose another boundary or suitability map.</em>"
      );
      try {
        if (window.IrrChart && typeof window.IrrChart.clear === "function") {
          window.IrrChart.clear();
        }
      } catch (err) {
        console.error("IrrChart.clear failed:", err);
      }
      return;
    }

    try {
      setStatus("Running boundary analysis…", false);

      const url = API.geeAnalyze || "/api/gee/analyze/";
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset: currentSuitability.dataset,
          geometry: geom,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("gee_analyze (boundary) HTTP error", resp.status, txt);
        setStatus(`Boundary analysis request failed (${resp.status})`, true);
        return;
      }

      const data = await resp.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const totalArea = items.reduce(
        (acc, it) => acc + (Number(it.area_ha) || 0),
        0
      );

      if (!items.length || totalArea < 1) {
        const msg =
          data.message ||
          "<em>No irrigated classes found inside this boundary (likely outside coverage).</em>";
        setAnalysisHtml(
          typeof msg === "string" && !msg.startsWith("<em>")
            ? `<em>${msg}</em>`
            : msg
        );
        try {
          if (window.IrrChart && typeof window.IrrChart.clear === "function") {
            window.IrrChart.clear();
          }
        } catch (err) {
          console.error("IrrChart.clear failed:", err);
        }
        setStatus("Boundary analysis complete (no classes / outside coverage).", false);
        return;
      }

      renderAnalysis(name, items);
      setStatus("Boundary analysis complete.", false);
    } catch (err) {
      console.error("Boundary analysis failed", err);
      setStatus("Boundary analysis failed.", true);
    }
  }

  function renderAnalysis(label, items) {
    if (!Array.isArray(items)) {
      setAnalysisHtml("<em>Unexpected response from server.</em>");
      return;
    }

    const processed = items.map((it) => {
      const cls =
        typeof it.class === "number"
          ? it.class
          : parseInt(it.class, 10) || 0;
      const area = Number(it.area_ha) || 0;
      const lbl = it.label || String(cls);
      return { class: cls, label: lbl, area_ha: area };
    });

    processed.sort((a, b) => a.class - b.class);

    const total = processed.reduce((acc, it) => acc + it.area_ha, 0);

    const rows = processed
      .map((it) => {
        const pct = total > 0 ? (100 * it.area_ha) / total : 0;
        return `
        <tr>
          <td>${it.class}</td>
          <td>${it.label}</td>
          <td class="text-end">${it.area_ha.toFixed(1)}</td>
          <td class="text-end">${pct.toFixed(1)}%</td>
        </tr>
      `;
      })
      .join("");

    setAnalysisHtml(`
      <div class="mb-2 fw-semibold">Analysis – ${label}</div>
      <div class="table-responsive">
        <table class="table table-sm table-dark table-striped align-middle mb-2">
          <thead>
            <tr>
              <th>Class</th>
              <th>Label</th>
              <th class="text-end">Area (ha)</th>
              <th class="text-end">Share</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="small text-secondary">Total area: ${total.toFixed(1)} ha</div>
    `);

    try {
      if (window.IrrChart && typeof window.IrrChart.update === "function") {
        window.IrrChart.update(processed, { title: `Suitability – ${label}` });
      }
    } catch (err) {
      console.error("IrrChart.update failed:", err);
    }
  }

  // ---------------- layer tree UI & draw toolbar ----------------
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

  function attachDrawToolbarEvents() {
    if (!drawToolbar) return;

    drawToolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn || !draw) return;

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
        setAnalysisHtml(
          "<em>Pick a suitability map, then draw a polygon (auto analysis) or click a boundary and use the popup button.</em>"
        );
        try {
          if (window.IrrChart && typeof window.IrrChart.clear === "function") {
            window.IrrChart.clear();
          }
        } catch (err) {
          console.error("IrrChart.clear failed:", err);
        }
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

  // ---------------- search + locate ----------------
  function attachSearchAndLocate() {
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

  // ---------------- map init + bootstrap ----------------
  function initMap() {
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
              "background-color": "#020617"
            }
          }
        ]
      },
      center: [30.9, -19.0],
      zoom: 6.3,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

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
      setStatus("Drawing tools unavailable (Draw plugin not loaded).", true);
    }

    map.on("draw.create", () => runFreehandAnalysis());
    map.on("draw.update", () => runFreehandAnalysis());
    map.on("draw.delete", () => {
      setAnalysisHtml(
        "<em>Pick a suitability map, then draw a polygon (auto analysis) or click a boundary and use the popup button.</em>"
      );
      try {
        if (window.IrrChart && typeof window.IrrChart.clear === "function") {
          window.IrrChart.clear();
        }
      } catch (err) {
        console.error("IrrChart.clear failed:", err);
      }
      clearHighlight();
    });

    map.on("error", (e) => {
      if (!e || !e.error || !e.error.url) return;
      console.error("Map error", e);
      const msg = `Tile error: ${e.error.message || ""}`;
      setStatus(msg, true);
    });

    map.on("load", () => {
      setStatus("Map ready. Choose a suitability layer to begin.", false);

      addBasemapLayers();

      map.addSource(H_SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: H_LINE,
        type: "line",
        source: H_SRC,
        filter: ["!=", "$type", "Point"],
        paint: {
          "line-color": "#f97316",
          "line-width": 4,
        },
      });

      map.addLayer({
        id: H_POINT,
        type: "circle",
        source: H_SRC,
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#f97316",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        },
      });

      updateLayerZOrder();
    });
  }

  function attachLayerEvents() {
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
        const isSuitability = dataset.startsWith("projects/") && !isSocio && !isBoundary;

        if (isSuitability) {
          if (cb.checked) {
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

            addRasterLayer(dataset, id, labelText, true);
          } else {
            removeMapLayer(id);
            currentSuitability = null;
            setActiveLayer(null);
            hideLegend();
            setAnalysisHtml(
              "<em>Pick a suitability map, then draw a polygon to analyze.</em>"
            );
            if (window.IrrChart && typeof window.IrrChart.clear === "function") {
              window.IrrChart.clear();
            }
          }
        }

        if (isBoundary) {
          if (cb.checked) {
            addBoundaryVectorLayer(dataset, id, labelText);
          } else {
            removeBoundaryVectorLayer(id);
            clearHighlight();
          }
        }

        if (isSocio) {
          if (cb.checked) {
            addSocioLayerVector(dataset, id, labelText);
          } else {
            removeSocioLayerVector(id);
          }
        }

        updateLayerZOrder();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!mapEl) return;

    initMap();
    attachLayerEvents();
    attachDrawToolbarEvents();
    wireLayerTreeGroups();
    wireLayerGroupDragAndDrop();
    attachSearchAndLocate();
    attachBasemapSwitcher();

    setAnalysisHtml(
      "<em>Pick a suitability map, then draw a polygon (auto analysis) or click a boundary and use “Run analysis” in the popup.</em>"
    );
  });
})();
