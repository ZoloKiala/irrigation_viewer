/* global maplibregl, turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

  // Translation helper — falls back to the English string if ivT() isn't loaded yet.
  const _t = (key, fallback) =>
    typeof window.ivT === "function" ? window.ivT(key, fallback) : fallback;

  class BoundaryManager {
    constructor(options) {
      this.map = options.map;
      this.attributeTablesEl = options.attributeTablesEl || API.attributeTablesEl;
      this.geeBoundariesUrl =
        options.geeBoundariesUrl || "/api/gee/boundaries-geojson/";
      this.setStatus = options.setStatus || API.setStatus;
      this.ensureAttributePanelVisible =
        options.ensureAttributePanelVisible || API.ensureAttributePanelVisible;
      this.removeAttributeTableForLayer =
        options.removeAttributeTableForLayer || API.removeAttributeTableForLayer;
      this.clearSelectedRows =
        options.clearSelectedRows || API.clearSelectedRows;
      this.highlight = options.highlight || API.setHighlight;
      this.clearHighlight = options.clearHighlight || API.clearHighlight;
      this.analysisManager = options.analysisManager;
      this.getLastSocioClickTime =
        options.getLastSocioClickTime || API.getLastSocioClickTime;

      this.boundaryLayerData = {}; // by layerId

      // Track the currently-open boundary popup so we can re-render its
      // text when the user switches languages.
      this._activePopup = null;
      this._activePopupCtx = null;
      this._waporPopupPeriodsPromise = null;

      document.addEventListener("iv:languagechange", () => {
        if (!this._activePopup || !this._activePopupCtx) return;
        const { feature, name } = this._activePopupCtx;
        this._activePopup.setHTML(this._buildBoundaryPopupHtml(name, feature));
        // setHTML replaces the inner DOM, so click handlers must be re-bound.
        this._attachBoundaryPopupHandlers(this._activePopup, feature, name);
      });
    }

    _buildBoundaryPopupHtml(name, feature) {
      const _t = (k, fb) =>
        (typeof window.ivT === "function" ? window.ivT(k, fb) : fb);

      // Selected polygon's area, computed instantly client-side from the full
      // (unclipped) geometry with turf (geodesic on WGS84). No EE round-trip.
      let areaHtml = "";
      if (feature && feature.geometry && typeof turf !== "undefined" && turf.area) {
        try {
          const ha = turf.area(feature) / 10000;
          const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
          areaHtml =
            `<div class="text-secondary small mb-2">Area: ${fmt(ha / 100)} km²`
            + ` (${fmt(ha)} ha)</div>`;
        } catch (_) {}
      }

      const country =
        (window.MAPVIEWER && typeof window.MAPVIEWER.getCurrentCountry === "function")
          ? window.MAPVIEWER.getCurrentCountry()
          : "Zimbabwe";

      // South Africa only has the irrigation IC + WaPOR wired up; the
      // soil/socio suitability flows aren't configured for SA, so hide them.
      const options = country === "South Africa"
        ? `<option value="irrigation" selected>${_t("popup_analysis_type_irrigation", "Irrigated area (ha)")}</option>
           <option value="wapor_ts">${_t("popup_analysis_type_wapor_ts", "Crop water use (time series)")}</option>`
        : `<option value="soil" selected>${_t("popup_analysis_type_soil", "Irrigation suitability (area)")}</option>
           <option value="socio">${_t("popup_analysis_type_socio", "Irrigation Investment suitability")}</option>`;

      // Auto-loaded "irrigated area" quick stats. The handler below fills
      // this div by calling /api/gee/analyze-irrigation/ when the popup
      // opens (SA only).
      const quickStats = country === "South Africa"
        ? `<div class="popup-irrigation-stats mt-2 mb-2 p-2 rounded"
                 style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">
             <div class="text-secondary small">Loading irrigated area…</div>
           </div>`
        : "";

      return `
        <div class="small popup-body">
          <div class="fw-semibold mb-1">${name}</div>
          ${areaHtml}
          <div class="mb-2">
            Use the attribute panel to explore full attributes.
          </div>
          ${quickStats}
          <div class="mt-1">
            <label class="form-label form-label-sm mb-1">Analysis type</label>
            <div class="d-flex align-items-center gap-2">
              <select id="boundaryAnalysisTypeSelect"
                      class="form-select form-select-sm">
                ${options}
              </select>
              <button id="boundaryAnalyzeBtn" type="button"
                      class="btn btn-primary btn-sm">
                ${_t("popup_run_analysis", "Run analysis")}
              </button>
            </div>
            <div class="wapor-boundary-picker mt-2 d-none">
              <label class="form-label form-label-sm mb-1">Start date</label>
              <input type="date" class="form-control form-control-sm mb-2 wapor-popup-start-date" disabled />
              <label class="form-label form-label-sm mb-1">End date</label>
              <input type="date" class="form-control form-control-sm wapor-popup-end-date" disabled />
            </div>
          </div>
        </div>
      `;
    }

    _fetchWaporPopupPeriods() {
      if (!this._waporPopupPeriodsPromise) {
        this._waporPopupPeriodsPromise = fetch("/api/gee/wapor-periods/")
          .then((r) => r.json())
          .then((d) => Array.isArray(d.periods) ? d.periods : [])
          .catch(() => []);
      }
      return this._waporPopupPeriodsPromise;
    }

    _toggleWaporPopupPicker(root) {
      const mode = root.querySelector("#boundaryAnalysisTypeSelect")?.value || "";
      const picker = root.querySelector(".wapor-boundary-picker");
      if (picker) picker.classList.toggle("d-none", mode !== "wapor_ts");
    }

    async _populateWaporPopupPicker(root) {
      const startEl = root.querySelector(".wapor-popup-start-date");
      const endEl = root.querySelector(".wapor-popup-end-date");
      if (!startEl || !endEl || root.__waporPickerLoaded) return;
      const periods = await this._fetchWaporPopupPeriods();
      if (!periods.length) {
        [startEl, endEl].forEach((el) => {
          el.value = "";
          el.removeAttribute("min");
          el.removeAttribute("max");
          el.disabled = true;
        });
        root.__waporPickerLoaded = true;
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
      root.__waporPickerLoaded = true;
    }

    _selectedWaporPopupDateRange(root) {
      return {
        start_date: root.querySelector(".wapor-popup-start-date")?.value || "",
        end_date: root.querySelector(".wapor-popup-end-date")?.value || "",
      };
    }

    _isAvailableWaporPopupDate(root, value) {
      const raw = root.querySelector(".wapor-popup-start-date")?.dataset.availableDates || "";
      const dates = raw.split(",").filter(Boolean);
      return !dates.length || dates.includes(value);
    }

    _attachBoundaryPopupHandlers(popup, feature, name) {
      setTimeout(() => {
        // Scope to THIS popup's DOM (not a global getElementById, which would
        // grab another popup's controls and leave this one's "Loading…" stuck).
        const root = popup && typeof popup.getElement === "function"
          ? popup.getElement()
          : null;
        const btn = root
          ? root.querySelector("#boundaryAnalyzeBtn")
          : document.getElementById("boundaryAnalyzeBtn");
        const select = root ? root.querySelector("#boundaryAnalysisTypeSelect") : null;
        if (!btn) return;
        if (select && root) {
          const syncPicker = () => {
            this._toggleWaporPopupPicker(root);
            if ((select.value || "") === "wapor_ts") {
              this._populateWaporPopupPicker(root);
            }
          };
          select.addEventListener("change", syncPicker);
          syncPicker();
        }

        // Auto-load irrigated area stats in the popup (South Africa only).
        // Picks iso_period/band from a checked IRR_SA_ layer if any, else
        // falls back to the current default (2025-07, filtered).
        const statsEl = root ? root.querySelector(".popup-irrigation-stats") : null;
        if (statsEl && feature && feature.geometry) {
          const checked = Array.from(
            document.querySelectorAll('input[name="layer"][type="checkbox"]:checked')
          );
          const irrCb = checked.find((cb) => (cb.value || "").startsWith("IRR_SA_"));
          let isoPeriod = "2025-07";
          let band = "filtered";
          if (irrCb) {
            const m = (irrCb.value || "").match(/^IRR_SA_([^?]+)\?(.+)$/);
            if (m) { isoPeriod = m[1]; band = m[2]; }
          }
          fetch("/api/gee/analyze-irrigation/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              geometry: feature.geometry,
              iso_period: isoPeriod, band,
            }),
          })
            .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then((data) => {
              const items = Array.isArray(data.items) ? data.items : [];
              const irrigated = items.find((it) => /irrig/i.test(it.label || ""));
              const total = items.find((it) => /boundary total/i.test(it.label || ""));
              const fmt = (v) => (v == null ? "—" :
                Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));
              const share = irrigated && irrigated.share_pct != null
                ? `${irrigated.share_pct.toFixed(1)}%` : "—";
              statsEl.innerHTML = `
                <div class="d-flex justify-content-between align-items-baseline">
                  <span class="text-secondary small">Irrigated (${band})</span>
                  <span class="fw-semibold">${fmt(irrigated && irrigated.area_ha)} ha</span>
                </div>
                <div class="d-flex justify-content-between align-items-baseline">
                  <span class="text-secondary small">Boundary total</span>
                  <span class="fw-semibold">${fmt(total && total.area_ha)} ha</span>
                </div>
                <div class="d-flex justify-content-between align-items-baseline">
                  <span class="text-secondary small">Share</span>
                  <span class="fw-semibold">${share}</span>
                </div>
                <div class="text-secondary small mt-1" style="opacity:0.7;">period ${isoPeriod}</div>
              `;
            })
            .catch((err) => {
              statsEl.innerHTML = `<div class="text-warning small">Could not load irrigated area: ${err.message}</div>`;
            });
        }

        btn.addEventListener("click", () => {
          const mode = select ? (select.value || "soil") : "soil";
          if (mode === "irrigation") {
            this.analysisManager.runBoundaryIrrigationAnalysis(feature, name);
            popup.remove();
            return;
          }
          if (mode === "wapor_ts") {
            const range = root ? this._selectedWaporPopupDateRange(root) : {};
            if (!range.start_date || !range.end_date) {
              this.setStatus("Pick a WaPOR start and end date first.", true);
              if (root) this._populateWaporPopupPicker(root);
              return;
            }
            if (range.start_date > range.end_date) {
              this.setStatus("Start date must be before or equal to end date.", true);
              return;
            }
            if (
              root &&
              (!this._isAvailableWaporPopupDate(root, range.start_date) ||
                !this._isAvailableWaporPopupDate(root, range.end_date))
            ) {
              this.setStatus("Pick one of the available WaPOR dates.", true);
              return;
            }
            this.analysisManager.runBoundaryWaporTimeseries(feature, name, {
              start_date: range.start_date,
              end_date: range.end_date,
            });
            popup.remove();
            return;
          }
          if (!this.analysisManager.currentSuitability) {
            this.setStatus(_t("status_select_suit", "Select a suitability map first."), true);
            return;
          }
          this.analysisManager.runBoundaryAnalysis(feature, name, mode);
          popup.remove();
        });
      }, 0);
    }

    _featureIndex(feature) {
      const rawIdx = feature && feature.properties
        ? feature.properties.__idx
        : null;
      const idx = Number(rawIdx);
      return Number.isInteger(idx) && idx >= 0 ? idx : null;
    }

    _fullFeatureFromRenderedFeature(renderedFeature, layerId) {
      const info = this.boundaryLayerData[layerId];
      const idx = this._featureIndex(renderedFeature);
      if (idx === null || !info || !Array.isArray(info.features)) {
        return renderedFeature;
      }
      return info.features[idx] || renderedFeature;
    }

    // For a multi-part feature, return just the single polygon part that
    // contains the click point. Some homelands (e.g. Bophuthatswana) are one
    // feature made of exclaves scattered across the country, so highlighting
    // the whole feature lights up pieces far from the click and looks like
    // several homelands are selected at once. Returns the whole feature when
    // it isn't a MultiPolygon or the click isn't inside any part.
    _clickedPolygonPart(feature, lngLat) {
      if (!feature || !feature.geometry || !lngLat
          || typeof turf === "undefined"
          || typeof turf.booleanPointInPolygon !== "function"
          || typeof turf.polygon !== "function") {
        return feature;
      }
      const g = feature.geometry;
      if (g.type !== "MultiPolygon") return feature;
      let pt;
      try { pt = turf.point([lngLat.lng, lngLat.lat]); } catch (_) { return feature; }
      for (const coords of (g.coordinates || [])) {
        try {
          if (turf.booleanPointInPolygon(pt, turf.polygon(coords))) {
            return {
              type: "Feature",
              properties: { ...(feature.properties || {}) },
              geometry: { type: "Polygon", coordinates: coords },
            };
          }
        } catch (_) { /* skip bad ring */ }
      }
      return feature;
    }

    _normalizeBoundaryGeometry(geometry) {
      if (!geometry) return geometry;
      const polygons = [];

      const walk = (geom) => {
        if (!geom) return;
        if (geom.type === "Polygon") {
          polygons.push(geom.coordinates);
        } else if (geom.type === "MultiPolygon") {
          (geom.coordinates || []).forEach((polygon) => polygons.push(polygon));
        } else if (geom.type === "GeometryCollection") {
          (geom.geometries || []).forEach(walk);
        }
      };

      walk(geometry);

      if (!polygons.length) return geometry;
      return polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons };
    }

    _geometryToBoundaryLines(geometry) {
      const lines = [];
      const addRing = (ring) => {
        if (!Array.isArray(ring) || ring.length < 2) return;
        lines.push(ring);
      };

      const walk = (geom) => {
        if (!geom) return;
        if (geom.type === "Polygon") {
          (geom.coordinates || []).forEach(addRing);
        } else if (geom.type === "MultiPolygon") {
          (geom.coordinates || []).forEach((polygon) => {
            polygon.forEach(addRing);
          });
        } else if (geom.type === "LineString") {
          if (Array.isArray(geom.coordinates) && geom.coordinates.length > 1) {
            lines.push(geom.coordinates);
          }
        } else if (geom.type === "MultiLineString") {
          (geom.coordinates || []).forEach((line) => {
            if (Array.isArray(line) && line.length > 1) lines.push(line);
          });
        } else if (geom.type === "GeometryCollection") {
          (geom.geometries || []).forEach(walk);
        }
      };

      walk(geometry);
      return lines;
    }

    _featuresToBoundaryLines(features) {
      const lineFeatures = [];

      (features || []).forEach((feature) => {
        this._geometryToBoundaryLines(feature && feature.geometry).forEach((line) => {
          lineFeatures.push({
            type: "Feature",
            properties: feature.properties || {},
            geometry: {
              type: "LineString",
              coordinates: line,
            },
          });
        });
      });

      return {
        type: "FeatureCollection",
        features: lineFeatures,
      };
    }

    async addBoundaryVectorLayer(dataset, id, label) {
      if (!this.map || !dataset || !id) return;

      // Parse the BOUNDARY_<ISO>_L<level> sentinel into its parts.
      let level = 1;
      let countryIso = "ZWE";
      try {
        const m = dataset.match(/^BOUNDARY_([A-Z]+)_L(\d+)/);
        if (m) {
          countryIso = m[1];
          level = parseInt(m[2], 10) || 1;
        } else {
          const lvlOnly = dataset.match(/_L(\d+)/);
          level = lvlOnly ? parseInt(lvlOnly[1], 10) || 1 : 1;
        }
      } catch (e) {
        level = 1;
      }

      const sourceId = `${id}_src`;
      const lineSourceId = `${id}_line_src`;
      const fillId = `${id}_fill`;
      const lineId = `${id}_line`;

      // If already added, just re-render attribute table
      if (this.map.getSource(sourceId) && this.map.getLayer(lineId)) {
        const info = this.boundaryLayerData[id];
        if (info && info.features && info.features.length) {
          this.renderBoundaryAttributeTableForLayer(
            id,
            info.label,
            info.features,
            null
          );
        }
        API.updateLayerZOrder();
        return;
      }

      try {
        const loadingMsg = _t("status_loading_boundaries", "Loading boundary polygons…");
        this.setStatus(loadingMsg, false);
        API.showMapSpinner(loadingMsg);

        const resp = await fetch(
          `${this.geeBoundariesUrl}?level=${level}&country_iso=${encodeURIComponent(countryIso)}`
        );

        if (!resp.ok) {
          const txt = await resp.text();
          console.error("gee_boundaries_geojson HTTP error", resp.status, txt);
          API.hideMapSpinner();
          this.setStatus(`Boundary polygons request failed (${resp.status})`, true);
          return;
        }

        const data = await resp.json();

        if (!data.configured) {
          console.error("gee_boundaries_geojson not configured", data);
          API.hideMapSpinner();
          this.setStatus(data.message || "Could not load boundary polygons.", true);
          return;
        }

        const rawFeatures = data.features || [];
        const features = rawFeatures.map((f, idx) => {
          const props = (f && f.properties) || {};
          return {
            ...f,
            geometry: this._normalizeBoundaryGeometry(f && f.geometry),
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

        this.map.addSource(sourceId, {
          type: "geojson",
          data: fc,
        });

        this.map.addSource(lineSourceId, {
          type: "geojson",
          data: this._featuresToBoundaryLines(features),
        });

        this.map.addLayer({
          id: fillId,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": "#ffffff",
            "fill-opacity": 0.01,
          },
        });

        this.map.addLayer({
          id: lineId,
          type: "line",
          source: lineSourceId,
          paint: {
            "line-color": "#000000",
            "line-width": 1.5,
          },
        });

        API.hideMapSpinner();

        this.boundaryLayerData[id] = {
          label,
          sourceId,
          lineSourceId,
          fillId,
          lineId,
          features,
        };

        this.map.on("mouseenter", fillId, () => {
          this.map.getCanvas().style.cursor = "pointer";
        });
        this.map.on("mouseleave", fillId, () => {
          this.map.getCanvas().style.cursor = "";
        });

        // Store the handler so removeBoundaryVectorLayer can unbind it.
        // Layer ids are deterministic, so without this a toggle off/on would
        // stack handlers and fire onBoundaryClick (and open popups) twice.
        const clickHandler = (e) => this.onBoundaryClick(e, id);
        this.map.on("click", fillId, clickHandler);
        if (this.boundaryLayerData[id]) {
          this.boundaryLayerData[id].clickHandler = clickHandler;
        }

        this.ensureAttributePanelVisible();
        this.renderBoundaryAttributeTableForLayer(id, label, features, null);

        this.setStatus("", false);
        API.updateLayerZOrder();
      } catch (err) {
        console.error("Failed to add boundary vector layer", err);
        API.hideMapSpinner();
        this.setStatus(_t("status_boundaries_error", "Error loading boundary polygons."), true);
      }
    }

    removeBoundaryVectorLayer(id) {
      if (!this.map || !id) return;
      const info = this.boundaryLayerData[id];
      const sourceId = info ? info.sourceId : `${id}_src`;
      const lineSourceId = info ? info.lineSourceId : `${id}_line_src`;
      const fillId = info ? info.fillId : `${id}_fill`;
      const lineId = info ? info.lineId : `${id}_line`;

      if (info && info.clickHandler) {
        try { this.map.off("click", fillId, info.clickHandler); } catch (_) {}
      }
      if (this.map.getLayer(fillId)) this.map.removeLayer(fillId);
      if (this.map.getLayer(lineId)) this.map.removeLayer(lineId);
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
      if (lineSourceId !== sourceId && this.map.getSource(lineSourceId)) {
        this.map.removeSource(lineSourceId);
      }

      delete this.boundaryLayerData[id];

      this.removeAttributeTableForLayer(id);
      API.updateLayerZOrder();
    }

    renderBoundaryAttributeTableForLayer(layerId, label, features, selectedIndex) {
      if (!this.attributeTablesEl) return;

      this.removeAttributeTableForLayer(layerId);

      if (!features || !features.length) {
        this.attributeTablesEl.insertAdjacentHTML(
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
          )
            return;
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
          const tds = columns
            .map((k) => {
              let v = props[k];
              if (v === null || v === undefined) v = "";
              return `<td>${String(v)}</td>`;
            })
            .join("");
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
                      class="attribute-zoom-btn"
                      data-zoom-layer-id="${layerId}"
                      title="Zoom to all features"
                      aria-label="Zoom to all features">
                <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
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

      this.attributeTablesEl.insertAdjacentHTML("beforeend", html);

      const wrapper = this.attributeTablesEl.querySelector(
        `.attribute-table-wrapper[data-layer-id="${layerId}"]`
      );
      if (!wrapper) return;

      wrapper.querySelectorAll(".attribute-table-row").forEach((row) => {
        row.addEventListener("click", () => {
          const idx = parseInt(row.dataset.featureIndex || "0", 10);
          this.clearSelectedRows();
          row.classList.add("is-selected");
          this.zoomToBoundaryFeature(layerId, idx);
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
          this.zoomToBoundaryLayer(layerId);
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

    zoomToBoundaryFeature(layerId, featureIndex) {
      if (!this.map) return;
      const info = this.boundaryLayerData[layerId];
      if (!info || !info.features || !info.features.length) return;
      const f = info.features[featureIndex];
      if (!f || !f.geometry) return;
      try {
        const bbox = turf.bbox(f);
        this.highlight(f);
        this.map.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          {
            padding: 80,
            duration: 800,
            maxZoom: 10,
          }
        );
      } catch (e) {
        console.error("zoomToBoundaryFeature failed", e);
      }
    }

    zoomToBoundaryLayer(layerId) {
      if (!this.map) return;
      const info = this.boundaryLayerData[layerId];
      if (!info || !info.features || !info.features.length) return;
      try {
        const fc = { type: "FeatureCollection", features: info.features };
        const bbox = turf.bbox(fc);
        this.map.fitBounds(
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

    onBoundaryClick(e, layerId) {
      // Ignore boundary click if it was immediately preceded by a socio click
      if (Date.now() - this.getLastSocioClickTime() < 200) {
        return;
      }

      try {
        if (!e.features || !e.features.length) return;

        const renderedFeature = e.features[0];
        const fullFeature = this._fullFeatureFromRenderedFeature(renderedFeature, layerId);
        // Select only the polygon piece under the click, not every scattered
        // part of a multi-part homeland.
        const feature = this._clickedPolygonPart(fullFeature, e.lngLat);
        this.analysisManager.currentBoundaryFeature = feature;
        this.highlight(feature);
        API.updateLayerZOrder();

        const info = this.boundaryLayerData[layerId];
        if (info && info.features && info.features.length) {
          const idx = this._featureIndex(feature);
          this.ensureAttributePanelVisible();
          this.renderBoundaryAttributeTableForLayer(
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

        // Only one boundary popup at a time. A stale popup left open would
        // duplicate the dropdown and (because the stats loader looks controls
        // up by global id) leave this popup's "Loading…" stuck forever.
        if (this._activePopup) {
          try { this._activePopup.remove(); } catch (_) {}
          this._activePopup = null;
        }

        const popup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          maxWidth: "340px",
        })
          .setLngLat(e.lngLat)
          .setHTML(this._buildBoundaryPopupHtml(name, feature))
          .addTo(this.map);

        this._activePopup = popup;
        this._activePopupCtx = { feature, name };
        popup.on("close", () => {
          if (this._activePopup === popup) {
            this._activePopup = null;
            this._activePopupCtx = null;
          }
        });

        this._attachBoundaryPopupHandlers(popup, feature, name);
      } catch (err) {
        console.error("onBoundaryClick failed", err);
      }
    }
  }

  API.BoundaryManager = BoundaryManager;
})();
