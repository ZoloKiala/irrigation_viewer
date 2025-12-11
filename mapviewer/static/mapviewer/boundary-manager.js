/* global maplibregl, turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

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
    }

    async addBoundaryVectorLayer(dataset, id, label) {
      if (!this.map || !dataset || !id) return;

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

      if (this.map.getSource(sourceId) && this.map.getLayer(lineId)) {
        const info = this.boundaryLayerData[id];
        if (info && info.features && info.features.length) {
          this.renderBoundaryAttributeTableForLayer(id, info.label, info.features, null);
        }
        API.updateLayerZOrder();
        return;
      }

      try {
        this.setStatus("Loading boundary polygons…", false);
        API.showMapSpinner("Loading boundary polygons…");

        const resp = await fetch(`${this.geeBoundariesUrl}?level=${level}`);

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

        this.map.addLayer({
          id: fillId,
          type: "fill",
          source: sourceId,
          filter: ["==", "$type", "Polygon"],
          paint: {
            "fill-color": "#ffffff",
            "fill-opacity": 0.01,
          },
        });

        this.map.addLayer({
          id: lineId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": "#000000",
            "line-width": 1.5,
          },
        });

        API.hideMapSpinner();

        this.boundaryLayerData[id] = {
          label,
          sourceId,
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

        this.map.on("click", fillId, (e) => this.onBoundaryClick(e, id));

        this.ensureAttributePanelVisible();
        this.renderBoundaryAttributeTableForLayer(id, label, features, null);

        this.setStatus("", false);
        API.updateLayerZOrder();
      } catch (err) {
        console.error("Failed to add boundary vector layer", err);
        API.hideMapSpinner();
        this.setStatus("Error loading boundary polygons.", true);
      }
    }

    removeBoundaryVectorLayer(id) {
      if (!this.map || !id) return;
      const info = this.boundaryLayerData[id];
      const sourceId = info ? info.sourceId : `${id}_src`;
      const fillId = info ? info.fillId : `${id}_fill`;
      const lineId = info ? info.lineId : `${id}_line`;

      if (this.map.getLayer(fillId)) this.map.removeLayer(fillId);
      if (this.map.getLayer(lineId)) this.map.removeLayer(lineId);
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);

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
      if (Date.now() - this.getLastSocioClickTime() < 200) {
        return;
      }

      try {
        if (!e.features || !e.features.length) return;

        const feature = e.features[0];
        this.analysisManager.currentBoundaryFeature = feature;
        this.highlight(feature);
        API.updateLayerZOrder();

        const info = this.boundaryLayerData[layerId];
        if (info && info.features && info.features.length) {
          const idx =
            feature.properties && typeof feature.properties.__idx === "number"
              ? feature.properties.__idx
              : null;
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
          .addTo(this.map);

        setTimeout(() => {
          const btn = document.getElementById("boundaryAnalyzeBtn");
          if (!btn) return;

          btn.addEventListener("click", () => {
            if (!this.analysisManager.currentSuitability) {
              this.setStatus("Select a suitability map first.", true);
              return;
            }
            this.analysisManager.runBoundaryAnalysis(feature, name);
            popup.remove();
          });
        }, 0);
      } catch (err) {
        console.error("onBoundaryClick failed", err);
      }
    }
  }

  API.BoundaryManager = BoundaryManager;
})();
