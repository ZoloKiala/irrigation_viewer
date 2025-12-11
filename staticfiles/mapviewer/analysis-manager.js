/* global turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

  class AnalysisManager {
    constructor(options) {
      this.map = options.map;
      this.draw = options.draw;
      this.geeAnalyzeUrl = options.geeAnalyzeUrl || "/api/gee/analyze/";
      this.setStatus = options.setStatus || API.setStatus;
      this.setAnalysisHtml = options.setAnalysisHtml || API.setAnalysisHtml;
      this.showLegend = options.showLegend || API.showLegend;
      this.hideLegend = options.hideLegend || API.hideLegend;
      this.setActiveLayer = options.setActiveLayer || API.setActiveLayer;
      this.highlight = options.highlight || API.setHighlight;
      this.clearHighlight = options.clearHighlight || API.clearHighlight;

      this.currentSuitability = null; // { id, dataset, label }
      this.currentSuitBounds = null; // { west, east, south, north }
      this.currentBoundaryFeature = null;
    }

    setSuitability(info, bounds) {
      this.currentSuitability = info || null;
      if (bounds) this.currentSuitBounds = bounds || null;

      if (!info) {
        this.setActiveLayer(null);
        this.hideLegend();
      } else {
        this.setActiveLayer(info);
        this.showLegend();
      }
    }

    clearSuitability() {
      this.currentSuitability = null;
      this.currentSuitBounds = null;
      this.setActiveLayer(null);
      this.hideLegend();
      this.setAnalysisHtml(
        "<em>Pick a suitability map, then draw a polygon to analyze.</em>"
      );
      try {
        if (window.IrrChart && typeof window.IrrChart.clear === "function") {
          window.IrrChart.clear();
        }
      } catch (err) {
        console.error("IrrChart.clear failed:", err);
      }
    }

    geometryOverlapsSuitability(geom) {
      if (!this.currentSuitBounds) return true;
      try {
        const bbox = turf.bbox(geom); // [minX, minY, maxX, maxY]
        const [minX, minY, maxX, maxY] = bbox;
        const { west, east, south, north } = this.currentSuitBounds;
        if (minX > east || maxX < west || minY > north || maxY < south) {
          return false;
        }
        return true;
      } catch (err) {
        console.warn("geometryOverlapsSuitability failed", err);
        return true;
      }
    }

    async runFreehandAnalysis() {
      if (!this.currentSuitability) {
        this.setStatus("Select a suitability map first.", true);
        return;
      }
      const fc = this.draw && this.draw.getAll ? this.draw.getAll() : null;
      if (!fc || !fc.features || !fc.features.length) {
        this.setStatus("Draw a polygon first.", true);
        return;
      }

      const geom = fc.features[fc.features.length - 1].geometry;

      if (!this.geometryOverlapsSuitability(geom)) {
        this.setStatus(
          "Drawn polygon lies outside the current suitability map extent.",
          true
        );
        this.setAnalysisHtml(
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
        this.setStatus("Running analysis…", false);

        const resp = await fetch(this.geeAnalyzeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset: this.currentSuitability.dataset,
            geometry: geom,
          }),
        });

        if (!resp.ok) {
          const txt = await resp.text();
          console.error("gee_analyze HTTP error", resp.status, txt);
          this.setStatus(`Analysis request failed (${resp.status})`, true);
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
          this.setAnalysisHtml(
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
          this.setStatus("Analysis complete (no classes / outside coverage).", false);
          return;
        }

        this.renderAnalysis("Polygon", items);
        this.setStatus("Analysis complete.", false);
      } catch (err) {
        console.error("Freehand analysis failed", err);
        this.setStatus("Analysis failed.", true);
      }
    }

    async runBoundaryAnalysis(feature, label) {
      if (!this.currentSuitability) {
        this.setStatus("Select a suitability map first.", true);
        return;
      }
      if (!feature || !feature.geometry) {
        this.setStatus("Click a boundary polygon first.", true);
        return;
      }

      this.currentBoundaryFeature = feature;
      const geom = feature.geometry;
      const props = feature.properties || {};
      const name =
        label ||
        props.name ||
        props.ADM1_NAME ||
        props.ADM2_NAME ||
        props.ADM3_NAME ||
        "Boundary";

      if (!this.geometryOverlapsSuitability(geom)) {
        this.setStatus(
          "Selected boundary lies outside the current suitability map extent.",
          true
        );
        this.setAnalysisHtml(
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
        this.setStatus("Running boundary analysis…", false);

        const resp = await fetch(this.geeAnalyzeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset: this.currentSuitability.dataset,
            geometry: geom,
          }),
        });

        if (!resp.ok) {
          const txt = await resp.text();
          console.error("gee_analyze (boundary) HTTP error", resp.status, txt);
          this.setStatus(`Boundary analysis request failed (${resp.status})`, true);
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
          this.setAnalysisHtml(
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
          this.setStatus(
            "Boundary analysis complete (no classes / outside coverage).",
            false
          );
          return;
        }

        this.renderAnalysis(name, items);
        this.setStatus("Boundary analysis complete.", false);
      } catch (err) {
        console.error("Boundary analysis failed", err);
        this.setStatus("Boundary analysis failed.", true);
      }
    }

    renderAnalysis(label, items) {
      if (!Array.isArray(items)) {
        this.setAnalysisHtml("<em>Unexpected response from server.</em>");
        return;
      }

      const processed = items.map((it) => {
        const cls =
          typeof it.class === "number" ? it.class : parseInt(it.class, 10) || 0;
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

      this.setAnalysisHtml(`  
        <div class="mb-2 fw-semibold">Analysis – ${label}</div>
        <div class="table-responsive">
          <table class="table table-sm table-dark table-striped align-middle mb-2">
            <thead>
              <tr>
                <th>Class</th>
                <th>Label</th>
                <th class="text-end">Area&nbsp;(ha)</th>
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

    resetForDrawDelete() {
      this.setAnalysisHtml(
        "<em>Pick a suitability map, then draw a polygon (auto analysis) or click a boundary and use the popup button.</em>"
      );
      try {
        if (window.IrrChart && typeof window.IrrChart.clear === "function") {
          window.IrrChart.clear();
        }
      } catch (err) {
        console.error("IrrChart.clear failed:", err);
      }
      this.clearHighlight();
    }
  }

  API.AnalysisManager = AnalysisManager;
})();
