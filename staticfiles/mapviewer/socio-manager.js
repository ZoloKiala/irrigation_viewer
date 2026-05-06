/* global maplibregl, turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

  // Translation helper — falls back to the English string if ivT() isn't loaded yet.
  const _t = (key, fallback) =>
    typeof window.ivT === "function" ? window.ivT(key, fallback) : fallback;

  class SocioManager {
    constructor(options) {
      this.map = options.map;
      this.attributeTablesEl = options.attributeTablesEl || API.attributeTablesEl;
      this.geeSocioUrl = options.geeSocioUrl || "/api/gee/socio-geojson/";
      this.setStatus = options.setStatus || API.setStatus;
      this.ensureAttributePanelVisible =
        options.ensureAttributePanelVisible || API.ensureAttributePanelVisible;
      this.removeAttributeTableForLayer =
        options.removeAttributeTableForLayer || API.removeAttributeTableForLayer;
      this.clearSelectedRows =
        options.clearSelectedRows || API.clearSelectedRows;
      this.highlight = options.highlight || API.setHighlight;
      this.setLastSocioClickTime =
        options.setLastSocioClickTime || API.setLastSocioClickTime;

      this.socioLayerData = {}; // by layerId
    }

    async addSocioLayerVector(dataset, id, label) {
      if (!this.map || !dataset || !id) return;

      if (this.socioLayerData[id] && this.map.getSource(this.socioLayerData[id].sourceId)) {
        this.ensureAttributePanelVisible();
        this.renderSocioAttributeTable(
          id,
          label,
          this.socioLayerData[id].features,
          null
        );
        API.updateLayerZOrder();
        return;
      }

      try {
        const loadingMsg = _t("status_loading_socio", "Loading socio-economic features…");
        this.setStatus(loadingMsg, false);
        API.showMapSpinner(loadingMsg);

        const resp = await fetch(
          `${this.geeSocioUrl}?dataset=${encodeURIComponent(dataset)}`
        );

        if (!resp.ok) {
          const txt = await resp.text();
          console.error("gee_socio_geojson HTTP error", resp.status, txt);
          API.hideMapSpinner();
          this.setStatus(
            `Socio-economic features request failed (${resp.status})`,
            true
          );
          return;
        }

        const data = await resp.json();
        if (!data.configured) {
          console.error("gee_socio_geojson not configured", data);
          API.hideMapSpinner();
          this.setStatus(
            data.message || "Could not load socio-economic features.",
            true
          );
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

        this.map.addSource(sourceId, {
          type: "geojson",
          data: fc,
        });

        this.map.addLayer({
          id: layerId,
          type: "circle",
          source: sourceId,
          paint: {
            "circle-radius": 5,
            "circle-color": "#22d3ee",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#0f172a",
          },
        });

        API.hideMapSpinner();

        this.map.on("mouseenter", layerId, () => {
          this.map.getCanvas().style.cursor = "pointer";
        });
        this.map.on("mouseleave", layerId, () => {
          this.map.getCanvas().style.cursor = "";
        });

        this.map.on("click", layerId, (e) => this.onSocioClick(e, id, label));

        this.socioLayerData[id] = {
          dataset,
          label,
          sourceId,
          layerId,
          features,
        };

        if (features.length) {
          try {
            const bbox = turf.bbox(fc);
            this.map.fitBounds(
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

        this.ensureAttributePanelVisible();
        this.renderSocioAttributeTable(id, label, features, null);

        API.updateLayerZOrder();
        this.setStatus("", false);
      } catch (err) {
        console.error("Failed to add socio layer", err);
        API.hideMapSpinner();
        this.setStatus(_t("status_socio_error", "Error loading socio-economic features."), true);
      }
    }

    removeSocioLayerVector(id) {
      if (!this.map) return;
      const info = this.socioLayerData[id];
      if (!info) {
        this.removeAttributeTableForLayer(id);
        return;
      }

      if (this.map.getLayer(info.layerId)) this.map.removeLayer(info.layerId);
      if (this.map.getSource(info.sourceId)) this.map.removeSource(info.sourceId);

      delete this.socioLayerData[id];
      this.removeAttributeTableForLayer(id);
      API.clearHighlight();
      API.updateLayerZOrder();
    }

    renderSocioAttributeTable(layerId, label, features, selectedIndex) {
      if (!this.attributeTablesEl) return;

      this.removeAttributeTableForLayer(layerId);

      if (!features || !features.length) {
        this.attributeTablesEl.insertAdjacentHTML(
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
                    data-feature-index="${idx}">${tds}</tr>`;
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
          this.zoomToSocioFeature(layerId, idx);
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
          this.zoomToSocioLayer(layerId);
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

    zoomToSocioFeature(layerId, featureIndex) {
      if (!this.map) return;
      const info = this.socioLayerData[layerId];
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
            maxZoom: 11,
          }
        );
      } catch (e) {
        console.error("zoomToSocioFeature failed", e);
      }
    }

    zoomToSocioLayer(layerId) {
      if (!this.map) return;
      const info = this.socioLayerData[layerId];
      if (!info || !info.features || !info.features.length) return;
      try {
        const fc = { type: "FeatureCollection", features: info.features };
        const bbox = turf.bbox(fc);
        this.map.fitBounds(
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

    onSocioClick(e, layerId, label) {
      this.setLastSocioClickTime(Date.now());

      const info = this.socioLayerData[layerId];
      if (!info || !info.features || !info.features.length) return;
      if (!e.features || !e.features.length) return;

      const feature = e.features[0];
      this.highlight(feature);

      const idx =
        feature.properties && typeof feature.properties.__idx === "number"
          ? feature.properties.__idx
          : 0;

      this.ensureAttributePanelVisible();
      this.renderSocioAttributeTable(layerId, label, info.features, idx);

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

      popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    }
  }

  API.SocioManager = SocioManager;
})();
