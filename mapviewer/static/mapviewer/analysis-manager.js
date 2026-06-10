/* global turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

  // Translation helper — falls back to the English string if ivT() isn't loaded yet.
  const _t = (key, fallback) =>
    typeof window.ivT === "function" ? window.ivT(key, fallback) : fallback;

  // Shared per-polygon colours so "Polygon N" is the same colour across the
  // crop-water-use chart and the irrigated-area comparison.
  const POLY_PALETTE = [
    "#22d3ee", "#f59e0b", "#34d399", "#f472b6",
    "#a78bfa", "#60a5fa", "#fb7185", "#facc15",
  ];

  // ----------------- Socio-economic config (from your matrix) -----------------
  // One entry per row in the spreadsheet
  const SOCIO_INDICATORS = [
    {
      id: "pop_density",
      parameter: "Population Density & Growth",
      indicator: "People per km² and population growth rate",
      criteria:
        "0 = <50/km²; 1 = 50–150/km²; 2 = >150/km² (higher density & growth increase suitability).",
    },
    {
      id: "poverty_income",
      parameter: "Poverty / Income Levels",
      indicator: "% below poverty line or average income",
      criteria:
        "0 = >60% poor / very low income; 1 = 30–60%; 2 = <30% poor (lower poverty / higher incomes score higher).",
    },
    {
      id: "ag_dependence",
      parameter: "Agricultural Dependence",
      indicator: "% of households reliant on farming",
      criteria:
        "0 = <30%; 1 = 30–70%; 2 = >70% of households reliant on agriculture.",
    },
    {
      id: "market_access",
      parameter: "Market Access",
      indicator: "Distance to nearest market in km / road quality",
      criteria:
        "0 = >20 km with poor roads; 1 = 10–20 km; 2 = <10 km with good road access.",
    },
    {
      id: "land_tenure",
      parameter: "Land Tenure Security",
      indicator:
        "% of landholders with secure rights / documented land access",
      criteria:
        "0 = <40%; 1 = 40–70%; 2 = >70% of landholders with secure / documented tenure.",
    },
    {
      id: "labour",
      parameter: "Labour Availability",
      indicator: "% of working-age population available",
      criteria:
        "0 = <40%; 1 = 40–60%; 2 = ≥60% of working-age population available for agriculture.",
    },
    {
      id: "education",
      parameter: "Education & Training Levels",
      indicator:
        "% literacy among farmers / vocational training presence",
      criteria:
        "0 = <40%; 1 = 40–70%; 2 = >70% farmers with basic education or access to training.",
    },
    {
      id: "institutions",
      parameter: "Institutional Support",
      indicator:
        "Presence of agri-extension, coops, technical suppliers, or water user groups",
      criteria:
        "0 = no active institutions; 1 = limited / irregular support; 2 = strong community institutions and support.",
    },
    {
      id: "gender_youth",
      parameter: "Gender & Youth Inclusion",
      indicator:
        "Women/youth share in ag labour and decision-making",
      criteria:
        "0 = <20% women/youth; 1 = 20–40%; 2 = ≥40% participation in labour and decisions.",
    },
    {
      id: "credit",
      parameter: "Access to Credit & Finance",
      indicator: "% of farmers with access to loans",
      criteria:
        "0 = <20% farmers with credit access; 1 = 20–50%; 2 = >50% with reliable financial services.",
    },
    {
      id: "infrastructure",
      parameter: "Existing Infrastructure",
      indicator:
        "Presence of feeder roads, electricity, boreholes, etc.",
      criteria:
        "0 = little/no infrastructure; 1 = partial or limited; 2 = good basic infrastructure in place.",
    },
    {
      id: "crop_value",
      parameter: "Crop Value Potential",
      indicator:
        "Existing/planned high-value crops (e.g., vegetables, fruits)",
      criteria:
        "0 = mainly low-value staples; 1 = mixed; 2 = high share of high-value crops.",
    },
    {
      id: "service_availability",
      parameter: "Availability of Service Providers",
      indicator:
        "Number of service providers available in a ward",
      criteria:
        "0 = unavailable; 1 = fairly accessible; 2 = highly accessible and responsive services.",
    },
    {
      id: "service_expertise",
      parameter: "Expertise of Service Providers",
      indicator:
        "Level of knowledge in irrigation design and system diagnostics",
      criteria:
        "0 = no relevant expertise; 1 = fairly knowledgeable; 2 = very knowledgeable and specialised.",
    },
  ];

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

      // cache for socio-modal
      this._socioModal = null;
      this._socioModalEl = null;
      this._socioModalSaveHandler = null;
    }

    // ----------------- Suitability selection -----------------
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

    // ----------------- Geometry helper -----------------
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

    // ----------------- Freehand poly analysis (soil suitability) -----------------
    async runFreehandAnalysis() {
      // If a WaPOR layer is active, drawing a polygon should run the WaPOR
      // time-series analysis instead of suitability.
      const waporCb = Array.from(
        document.querySelectorAll('input[name="layer"][type="checkbox"]:checked')
      ).find((cb) => (cb.value || "").startsWith("WAPOR_SA_"));
      if (waporCb) {
        // Chart every drawn polygon together (supports 3+), not just the last.
        return this.runMultiWaporTimeseries();
      }

      if (!this.currentSuitability) {
        this.setStatus(_t("status_select_suit", "Select a suitability map first."), true);
        return;
      }
      const fc = this.draw && this.draw.getAll ? this.draw.getAll() : null;
      if (!fc || !fc.features || !fc.features.length) {
        this.setStatus(_t("status_draw_polygon_first", "Draw a polygon first."), true);
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
        this.setStatus(_t("status_running_analysis", "Running analysis…"), false);

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
          this.setStatus(
            "Analysis complete (no classes / outside coverage).",
            false
          );
          return;
        }

        this.renderAnalysis("Polygon", items);
        this.setStatus(_t("status_analysis_complete", "Analysis complete."), false);
      } catch (err) {
        console.error("Freehand analysis failed", err);
        this.setStatus(_t("status_analysis_failed", "Analysis failed."), true);
      }
    }

    // ----------------- Boundary-based analysis -----------------
    /**
     * Boundary-based analysis.
     * mode = "soil"  -> existing suitability area analysis
     * mode = "socio" -> socio-economic editor (no backend yet)
     */
    async runBoundaryAnalysis(feature, label, mode) {
      if (!this.currentSuitability) {
        this.setStatus(_t("status_select_suit", "Select a suitability map first."), true);
        return;
      }
      if (!feature || !feature.geometry) {
        this.setStatus(_t("status_click_boundary_first", "Click a boundary polygon first."), true);
        return;
      }

      // --- New socio-economic mode: just render editor table ---
      if (mode === "socio") {
        const props = feature.properties || {};
        const name =
          label ||
          props.name ||
          props.ADM1_NAME ||
          props.ADM2_NAME ||
          props.ADM3_NAME ||
          "Boundary";

        this.renderSocioEconomicEditor(name);
        this.setStatus(
          "Socio-economic editor loaded. Click the ? icon to see scoring criteria and set scores.",
          false
        );
        return;
      }

      // --- Existing soil-suitability flow ---
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
        this.setStatus(_t("status_running_boundary_analysis", "Running boundary analysis…"), false);

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
          this.setStatus(
            `Boundary analysis request failed (${resp.status})`,
            true
          );
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
        this.setStatus(_t("status_boundary_analysis_complete", "Boundary analysis complete."), false);
      } catch (err) {
        console.error("Boundary analysis failed", err);
        this.setStatus(_t("status_boundary_analysis_failed", "Boundary analysis failed."), true);
      }
    }

    // ----------------- Boundary-based irrigation-area analysis -----------------
    /**
     * Sum irrigated hectares inside a boundary using the currently-enabled
     * irrigation layer (raw / filtered / probability). Resolves the active
     * layer by scanning the layer checkboxes for the IRR_SA_<iso>?<band>
     * pattern, so the user controls period/band via the existing date picker.
     */
    async runBoundaryIrrigationAnalysis(feature, label) {
      if (!feature || !feature.geometry) {
        this.setStatus(_t("status_click_boundary_first", "Click a boundary polygon first."), true);
        return;
      }

      const checked = Array.from(
        document.querySelectorAll('input[name="layer"][type="checkbox"]:checked')
      );
      const irrCb = checked.find(
        (cb) => (cb.value || "").startsWith("IRR_SA_")
      );
      if (!irrCb) {
        this.setStatus(
          "Enable a South Africa irrigation layer (monthly) first.",
          true
        );
        this.setAnalysisHtml(
          "<em>Enable the 'South Africa — Irrigation (monthly)' layer, pick a period and band, then click 'Run analysis'.</em>"
        );
        return;
      }

      const m = (irrCb.value || "").match(/^IRR_SA_([^?]+)\?(.+)$/);
      if (!m) {
        this.setStatus("Could not parse irrigation layer selection.", true);
        return;
      }
      const isoPeriod = m[1];
      const band = m[2];
      const name = label || (feature.properties && (feature.properties.name || feature.properties.NAME)) || "Boundary";

      try {
        this.setStatus(_t("status_running_boundary_analysis", "Running boundary analysis…"), false);
        const resp = await fetch("/api/gee/analyze-irrigation/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            geometry: feature.geometry,
            iso_period: isoPeriod,
            band,
          }),
        });
        if (!resp.ok) {
          this.setStatus(`Irrigation analysis failed (${resp.status})`, true);
          return;
        }
        const data = await resp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
          this.setAnalysisHtml(`<em>${data.message || "No data."}</em>`);
          return;
        }
        this.renderIrrigationAnalysis(name, items, {
          iso_period: data.iso_period || isoPeriod,
          band: data.band || band,
          threshold: data.threshold,
        });
        this.setStatus(_t("status_boundary_analysis_complete", "Boundary analysis complete."), false);
      } catch (err) {
        console.error("Boundary irrigation analysis failed", err);
        this.setStatus("Irrigation analysis failed.", true);
      }
    }

    renderIrrigationAnalysis(label, items, meta) {
      // Irrigation/WaPOR results are a table, not a bar chart — clear the
      // chart so its card hides instead of showing an empty box below.
      if (window.IrrChart && typeof window.IrrChart.clear === "function") {
        window.IrrChart.clear();
      }
      const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
      const rows = items
        .map((it) => {
          const pct = Number(it.share_pct) || 0;
          return `
            <tr>
              <td>${it.label}</td>
              <td class="text-end">${fmt(it.area_ha)}</td>
              <td class="text-end">${pct.toFixed(1)}%</td>
            </tr>
          `;
        })
        .join("");
      const thr = meta && meta.threshold != null
        ? ` · threshold ${Number(meta.threshold).toFixed(2)}`
        : "";
      const sub = meta
        ? `<div class="small text-secondary mb-2">Period ${meta.iso_period} · band ${meta.band}${thr}</div>`
        : "";
      this.setAnalysisHtml(`
        <div class="mb-1 fw-semibold">Irrigated area — ${label}</div>
        ${sub}
        <div class="table-responsive">
          <table class="table table-sm table-dark table-striped align-middle mb-2">
            <thead>
              <tr>
                <th>Class</th>
                <th class="text-end">Area&nbsp;(ha)</th>
                <th class="text-end">Share</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `);
      const box = document.getElementById("analysisBox");
      if (box && box.scrollIntoView) {
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }

    // ----------------- Multi-polygon irrigated-area analysis -----------------
    // Run the irrigated-area (ha) analysis for EVERY drawn polygon and show a
    // comparison (bar chart + table). One polygon → original single table.
    async runMultiIrrigationAnalysis() {
      const fc = this.draw && this.draw.getAll ? this.draw.getAll() : null;
      const polys = (fc && fc.features ? fc.features : []).filter(
        (f) =>
          f && f.geometry &&
          (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      );
      if (!polys.length) {
        this.setStatus(_t("status_draw_polygon_first", "Draw a polygon first."), true);
        return;
      }

      // Resolve the active SA irrigation layer (period + band) from the checkboxes.
      const irrCb = Array.from(
        document.querySelectorAll('input[name="layer"][type="checkbox"]:checked')
      ).find((cb) => (cb.value || "").startsWith("IRR_SA_"));
      if (!irrCb) {
        this.setStatus("Enable a South Africa irrigation layer (monthly) first.", true);
        this.setAnalysisHtml(
          "<em>Enable the 'South Africa — Irrigation (monthly)' layer, pick a period and band, then run the analysis.</em>"
        );
        return;
      }
      const mm = (irrCb.value || "").match(/^IRR_SA_([^?]+)\?(.+)$/);
      if (!mm) {
        this.setStatus("Could not parse irrigation layer selection.", true);
        return;
      }
      const isoPeriod = mm[1];
      const band = mm[2];

      try {
        this.setStatus(
          polys.length === 1
            ? "Running irrigated-area analysis…"
            : `Running irrigated-area analysis on ${polys.length} polygons…`,
          false
        );
        const results = await Promise.all(
          polys.map((f, idx) =>
            fetch("/api/gee/analyze-irrigation/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ geometry: f.geometry, iso_period: isoPeriod, band }),
            })
              .then((r) => (r.ok ? r.json() : { items: [] }))
              .then((data) => {
                const items = Array.isArray(data.items) ? data.items : [];
                const totalItem = items.find((it) => /total/i.test(it.label || ""));
                const irrItem = items.find((it) => !/total/i.test(it.label || ""));
                return {
                  label: `Polygon ${idx + 1}`,
                  color: POLY_PALETTE[idx % POLY_PALETTE.length],
                  items,
                  irr_ha: irrItem ? Number(irrItem.area_ha) || 0 : 0,
                  total_ha: totalItem ? Number(totalItem.area_ha) || 0 : 0,
                  share: irrItem ? Number(irrItem.share_pct) || 0 : 0,
                  meta: {
                    iso_period: data.iso_period || isoPeriod,
                    band: data.band || band,
                    threshold: data.threshold,
                  },
                };
              })
              .catch((e) => {
                console.error("Irrigation analysis failed for one polygon", e);
                return null;
              })
          )
        );
        const valid = results.filter((r) => r && r.total_ha > 0);
        if (!valid.length) {
          this.setAnalysisHtml(
            "<em>No irrigation data inside the drawn polygon(s) for the selected period.</em>"
          );
          this.setStatus("No irrigation data inside polygons.", true);
          return;
        }
        if (valid.length === 1) {
          this.renderIrrigationAnalysis(valid[0].label, valid[0].items, valid[0].meta);
        } else {
          this.renderIrrigationMulti(valid, valid[0].meta);
        }
        this.setStatus(
          `Irrigated-area analysis complete (${valid.length} of ${polys.length} polygons).`,
          false
        );
      } catch (err) {
        console.error("Multi irrigation analysis failed", err);
        this.setStatus("Irrigation analysis failed.", true);
      }
    }

    renderIrrigationMulti(results, meta) {
      // Comparison view is its own table/bar chart — clear the bar-chart canvas.
      if (window.IrrChart && typeof window.IrrChart.clear === "function") {
        window.IrrChart.clear();
      }
      const fmt = (n) =>
        (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
      const maxIrr = Math.max(1, ...results.map((r) => r.irr_ha));

      const bars = results
        .map((r) => {
          const w = Math.max(2, (r.irr_ha / maxIrr) * 100);
          return `
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="small text-nowrap" style="width:64px">${r.label}</span>
              <div style="flex:1;background:rgba(148,163,184,.15);border-radius:4px;height:16px">
                <div style="width:${w}%;background:${r.color};height:100%;border-radius:4px"></div>
              </div>
              <span class="small text-nowrap" style="width:118px;text-align:right">
                ${fmt(r.irr_ha)} ha · ${fmt(r.share)}%
              </span>
            </div>`;
        })
        .join("");

      const rows = results
        .map(
          (r) => `
            <tr>
              <td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${r.color};margin-right:6px"></span>${r.label}</td>
              <td class="text-end">${fmt(r.total_ha)}</td>
              <td class="text-end">${fmt(r.irr_ha)}</td>
              <td class="text-end">${fmt(r.share)}%</td>
            </tr>`
        )
        .join("");

      const thr =
        meta && meta.threshold != null
          ? ` · threshold ${Number(meta.threshold).toFixed(2)}`
          : "";
      const sub = meta
        ? `<div class="small text-secondary mb-2">Period ${meta.iso_period} · band ${meta.band}${thr}</div>`
        : "";

      this.setAnalysisHtml(`
        <div class="mb-1 fw-semibold">Irrigated area — ${results.length} polygons</div>
        ${sub}
        <div class="mb-2">${bars}</div>
        <div class="table-responsive">
          <table class="table table-sm table-dark table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>Polygon</th>
                <th class="text-end">Total&nbsp;(ha)</th>
                <th class="text-end">Irrigated&nbsp;(ha)</th>
                <th class="text-end">Share</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `);

      const box = document.getElementById("analysisBox");
      if (box && box.scrollIntoView) {
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }

    // ----------------- Freehand WaPOR time-series analysis -----------------
    // POST one polygon geometry to the WaPOR endpoint; returns {items, message}.
    async _fetchWaporTimeseries(geom, opts = {}) {
      const resp = await fetch("/api/wapor/timeseries/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geometry: geom,
          dekad_date: opts.dekad_date || null,
          start_date: opts.start_date || null,
          end_date: opts.end_date || null,
        }),
      });
      if (!resp.ok) {
        const err = new Error(`WaPOR time series failed (${resp.status})`);
        err.status = resp.status;
        throw err;
      }
      const data = await resp.json();
      return {
        items: Array.isArray(data.items) ? data.items : [],
        message: data.message || "",
      };
    }

    async runFreehandWaporTimeseries(geom, opts = {}) {
      try {
        this.setStatus("Running WaPOR time-series on drawn polygon…", false);
        const { items, message } = await this._fetchWaporTimeseries(geom, opts);
        if (!items.length || items.every((it) => !it.n_pixels)) {
          this.setAnalysisHtml(
            `<em>${message || "No WaPOR pixels inside the drawn polygon for the selected date."}</em>`
          );
          this.setStatus("No WaPOR pixels inside polygon.", true);
          return;
        }
        this.renderWaporTimeseries("Drawn polygon", items);
        this.setStatus("WaPOR time-series complete.", false);
      } catch (err) {
        console.error("Freehand WaPOR time-series failed", err);
        this.setStatus(err.message || "WaPOR time series failed.", true);
      }
    }

    // Run the WaPOR time series for EVERY drawn polygon and overlay them as
    // colour-coded series (supports 3+). A single polygon keeps the original
    // single-series chart with error bars.
    async runMultiWaporTimeseries(opts = {}) {
      const fc = this.draw && this.draw.getAll ? this.draw.getAll() : null;
      const polys = (fc && fc.features ? fc.features : []).filter(
        (f) =>
          f && f.geometry &&
          (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      );
      if (!polys.length) {
        this.setStatus(_t("status_draw_polygon_first", "Draw a polygon first."), true);
        return;
      }
      if (polys.length === 1) {
        return this.runFreehandWaporTimeseries(polys[0].geometry, opts);
      }
      try {
        this.setStatus(`Running WaPOR time-series on ${polys.length} polygons…`, false);
        const results = await Promise.all(
          polys.map((f) =>
            this._fetchWaporTimeseries(f.geometry, opts)
              .then((r) => r.items)
              .catch((e) => {
                console.error("WaPOR time-series failed for one polygon", e);
                return [];
              })
          )
        );
        const series = results
          .map((items, i) => ({ label: `Polygon ${i + 1}`, items: items || [] }))
          .filter((s) =>
            s.items.some((it) => it.n_pixels && Number.isFinite(it.mean_eta))
          );
        if (!series.length) {
          this.setAnalysisHtml(
            "<em>No WaPOR pixels inside any of the drawn polygons for the selected dates.</em>"
          );
          this.setStatus("No WaPOR pixels inside polygons.", true);
          return;
        }
        this.renderWaporTimeseriesMulti(series, { totalPolys: polys.length });
        this.setStatus(
          `WaPOR time-series complete (${series.length} of ${polys.length} polygons).`,
          false
        );
      } catch (err) {
        console.error("Multi WaPOR time-series failed", err);
        this.setStatus("WaPOR time series failed.", true);
      }
    }

    // ----------------- Boundary-based WaPOR time-series analysis -----------------
    /**
     * Compute mean ETa per dekad inside a boundary across all locally-
     * available WaPOR mosaics, and render as a small table + inline bars.
     */
    async runBoundaryWaporTimeseries(feature, label, opts = {}) {
      if (!feature || !feature.geometry) {
        this.setStatus(_t("status_click_boundary_first", "Click a boundary polygon first."), true);
        return;
      }
      const name = label || (feature.properties && (feature.properties.name || feature.properties.NAME)) || "Boundary";
      try {
        this.setStatus("Running WaPOR time-series analysis…", false);
        const resp = await fetch("/api/wapor/timeseries/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            geometry: feature.geometry,
            dekad_date: opts.dekad_date || null,
            start_date: opts.start_date || null,
            end_date: opts.end_date || null,
          }),
        });
        if (!resp.ok) {
          this.setStatus(`WaPOR time series failed (${resp.status})`, true);
          return;
        }
        const data = await resp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length || items.every((it) => !it.n_pixels)) {
          this.setAnalysisHtml(`<em>${data.message || "No WaPOR mosaics available."}</em>`);
          this.setStatus("No WaPOR pixels inside polygon.", true);
          return;
        }
        this.renderWaporTimeseries(name, items);
        this.setStatus("WaPOR time-series complete.", false);
      } catch (err) {
        console.error("Boundary WaPOR time-series failed", err);
        this.setStatus("WaPOR time series failed.", true);
      }
    }

    // Backwards-compatible single-series entry point (boundary analysis and the
    // single-polygon freehand path both call this).
    renderWaporTimeseries(label, items) {
      this.renderWaporTimeseriesMulti([{ label, items }]);
    }

    // Render one or more WaPOR time series on a shared axis. Each series is a
    // drawn polygon; with >1 series they are colour-coded and a legend is shown.
    renderWaporTimeseriesMulti(series, meta = {}) {
      const PALETTE = POLY_PALETTE;
      const fmt = (n) => (n == null ? "—" : Number(n).toFixed(2));
      const cum = meta.mode === "cumulative";
      // Remember the data so the Per-dekad / Cumulative toggle can re-render.
      this._waporSeries = series;
      this._waporMeta = meta;

      // Keep ALL returned dekads per series (the backend returns one item per
      // dekad in range, with mean_eta:null when a dekad has no data). `fin` are
      // the plottable points; `all` drives the x-axis so a no-data dekad still
      // shows as a tick. `plot` carries the value actually drawn — the per-dekad
      // mean, or the running cumulative total when in cumulative mode. `total`
      // is the summed WaPOR use (mm) over the period.
      const sv = (series || [])
        .map((s, i) => {
          const all = (s.items || [])
            .slice()
            .sort((a, b) => (a.dekad_date || "").localeCompare(b.dekad_date || ""));
          const fin = all.filter((it) => Number.isFinite(it.mean_eta));
          let run = 0;
          const plot = fin.map((p) => {
            run += p.mean_eta;
            return {
              dekad_date: p.dekad_date, dekad: p.dekad,
              mean_eta: p.mean_eta, std_eta: p.std_eta,
              cum: run, val: cum ? run : p.mean_eta,
            };
          });
          return { label: s.label, color: PALETTE[i % PALETTE.length], all, fin, plot, total: run };
        })
        .filter((s) => s.fin.length);

      if (!sv.length) {
        this.setAnalysisHtml('<div class="small text-secondary">No valid dekads.</div>');
        return;
      }

      const multi = sv.length > 1;

      // Shared x-axis = sorted union of EVERY returned dekad (incl. no-data).
      const dateSet = new Set();
      sv.forEach((s) => s.all.forEach((it) => { if (it.dekad_date) dateSet.add(it.dekad_date); }));
      const dates = Array.from(dateSet).filter(Boolean).sort();
      const xIndex = new Map(dates.map((d, i) => [d, i]));
      const nX = dates.length || 1;
      // A dekad with no finite value in ANY series → render as a visible gap.
      const missingAll = (d) => !sv.some((s) => s.fin.some((p) => p.dekad_date === d));
      const hasGap = sv.some((s) => s.fin.length < nX);

      // Chart geometry — taller when dense so rotated x-labels stay readable.
      const W = 380;
      const H = nX > 12 ? 220 : 180;
      const m = { top: 16, right: 16, bottom: 50, left: cum ? 48 : 40 };
      const innerW = W - m.left - m.right;
      const innerH = H - m.top - m.bottom;

      // Y-range across the plotted values (± std only in per-dekad mode; the
      // cumulative curve has no meaningful per-point error and starts at 0).
      let dataMin = Infinity;
      let dataMax = -Infinity;
      sv.forEach((s) =>
        s.plot.forEach((p) => {
          const std = !cum && Number.isFinite(p.std_eta) ? p.std_eta : 0;
          dataMin = Math.min(dataMin, p.val - std);
          dataMax = Math.max(dataMax, p.val + std);
        })
      );
      if (cum) dataMin = Math.min(dataMin, 0);
      const pad = Math.max(0.5, (dataMax - dataMin) * 0.1);
      const yMin = cum ? 0 : dataMin - pad; // cumulative reads from a 0 baseline
      const yMax = dataMax + pad;
      const yRange = yMax - yMin || 1;

      const xAt = (d) =>
        m.left + (nX === 1 ? innerW / 2 : (innerW * (xIndex.get(d) || 0)) / (nX - 1));
      const yAt = (v) => m.top + innerH - (innerH * (v - yMin)) / yRange;

      // Y-axis tick lines (3 ticks)
      const yTicks = [yMin, (yMin + yMax) / 2, yMax];
      const gridLines = yTicks
        .map(
          (v) => `
            <line x1="${m.left}" x2="${W - m.right}"
                  y1="${yAt(v)}" y2="${yAt(v)}"
                  stroke="rgba(148,163,184,.2)" stroke-width="1"/>
            <text x="${m.left - 6}" y="${yAt(v) + 3}"
                  text-anchor="end" font-size="10" fill="#94a3b8">
              ${v.toFixed(1)}
            </text>
          `
        )
        .join("");

      const xAxis = `
        <line x1="${m.left}" x2="${W - m.right}"
              y1="${H - m.bottom}" y2="${H - m.bottom}"
              stroke="#475569" stroke-width="1"/>
      `;

      // Dashed vertical guides at dekads that have NO data in any series, so a
      // no-data dekad is visible rather than silently dropped from the axis.
      const gapGuides = dates
        .map((d) => {
          if (!missingAll(d)) return "";
          const x = xAt(d);
          return `<line x1="${x}" x2="${x}" y1="${m.top}" y2="${H - m.bottom}"
                        stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"/>`;
        })
        .join("");

      // Error bars only for the single-series, per-dekad case (cumulative has
      // no meaningful per-point spread; 3+ series would be cluttered).
      let errBars = "";
      if (!multi && !cum) {
        errBars = sv[0].fin
          .map((p) => {
            const std = Number.isFinite(p.std_eta) ? p.std_eta : 0;
            if (!std) return "";
            const x = xAt(p.dekad_date);
            return `
              <line x1="${x}" x2="${x}"
                    y1="${yAt(p.mean_eta - std)}" y2="${yAt(p.mean_eta + std)}"
                    stroke="#94a3b8" stroke-width="1.5"/>
              <line x1="${x - 3}" x2="${x + 3}" y1="${yAt(p.mean_eta - std)}" y2="${yAt(p.mean_eta - std)}" stroke="#94a3b8" stroke-width="1.5"/>
              <line x1="${x - 3}" x2="${x + 3}" y1="${yAt(p.mean_eta + std)}" y2="${yAt(p.mean_eta + std)}" stroke="#94a3b8" stroke-width="1.5"/>
            `;
          })
          .join("");
      }

      // One connected line + markers per series. The line joins finite points
      // in date order (bridging any no-data dekad); the missing marker plus the
      // dashed guide make the gap obvious.
      const seriesSvg = sv
        .map((s) => {
          const linePath =
            s.plot.length === 1
              ? ""
              : `<path d="${s.plot
                  .map(
                    (p, i) =>
                      `${i === 0 ? "M" : "L"} ${xAt(p.dekad_date)} ${yAt(p.val)}`
                  )
                  .join(" ")}" stroke="${s.color}" stroke-width="2" fill="none"/>`;
          const markers = s.plot
            .map(
              (p) => `
                <circle cx="${xAt(p.dekad_date)}" cy="${yAt(p.val)}" r="${multi ? 3.5 : 4}"
                        fill="${s.color}" stroke="#0f172a" stroke-width="1.5">
                  <title>${multi ? s.label + " — " : ""}${p.dekad_date || p.dekad}: ${
                cum
                  ? `Σ ${fmt(p.cum)} mm (dekad ${fmt(p.mean_eta)})`
                  : `${fmt(p.mean_eta)} ± ${fmt(p.std_eta)} mm`
              }</title>
                </circle>
              `
            )
            .join("");
          return linePath + markers;
        })
        .join("");

      // X-axis labels, rotated 45°, strided when dense.
      const maxLabels = 8;
      const stride = Math.max(1, Math.ceil(nX / maxLabels));
      const xLabels = dates
        .map((d, i) => {
          const miss = missingAll(d);
          // Always label a no-data dekad (in red) even when labels are strided.
          if (!miss && i % stride !== 0 && i !== nX - 1) return "";
          return `
            <text x="${xAt(d)}" y="${H - m.bottom + 14}"
                  text-anchor="end" font-size="10" fill="${miss ? "#fca5a5" : "#94a3b8"}"
                  transform="rotate(-45 ${xAt(d)} ${H - m.bottom + 14})">
              ${d}
            </text>
          `;
        })
        .join("");

      const svg = `
        <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}"
             preserveAspectRatio="xMidYMid meet" class="wapor-ts-chart">
          ${gridLines}
          ${gapGuides}
          ${xAxis}
          ${errBars}
          ${seriesSvg}
          ${xLabels}
          <text x="${m.left}" y="12" font-size="10" fill="#94a3b8">${cum ? "mm (cumulative)" : "mm / dekad"}</text>
        </svg>
      `;

      // Per-dekad / Cumulative toggle.
      const toggle = `
        <div class="btn-group btn-group-sm mb-2" role="group" aria-label="WaPOR mode">
          <button type="button" class="btn ${cum ? "btn-outline-secondary" : "btn-primary"} wapor-mode-btn" data-mode="dekad">Per dekad</button>
          <button type="button" class="btn ${cum ? "btn-primary" : "btn-outline-secondary"} wapor-mode-btn" data-mode="cumulative">Cumulative</button>
        </div>`;

      // Legend (when comparing multiple polygons) — includes each polygon's
      // cumulative total (Σ mm) over the period.
      const legend = multi
        ? `<div class="d-flex flex-wrap gap-2 mt-2 small text-secondary">` +
          sv
            .map(
              (s) =>
                `<span class="d-inline-flex align-items-center gap-1">
                   <span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:${s.color}"></span>
                   ${s.label} · Σ ${fmt(s.total)} mm
                 </span>`
            )
            .join("") +
          `</div>`
        : "";

      const titleLabel = multi
        ? `${sv.length} polygons`
        : (series[0] && series[0].label) || "Drawn polygon";
      const polyNote =
        multi && meta.totalPolys && meta.totalPolys !== sv.length
          ? ` · ${sv.length} of ${meta.totalPolys} with data`
          : multi
          ? ` · ${sv.length} polygons`
          : "";
      const totalNote = !multi ? ` · Σ ${fmt(sv[0].total)} mm total` : "";
      const metricLabel = cum
        ? "Cumulative WaPOR L1 AETI_D (mm)"
        : "Mean WaPOR L1 AETI_D (mm / dekad)";

      this.setAnalysisHtml(`
        <div class="mb-1 fw-semibold">Crop water use — ${titleLabel}</div>
        <div class="small text-secondary mb-2">
          ${metricLabel} · ${nX} dekad${nX === 1 ? "" : "s"}${polyNote}${totalNote}${hasGap ? " · dashed = no data" : ""}
        </div>
        ${toggle}
        ${svg}
        ${legend}
      `);

      // Wire the toggle to re-render the stored series in the chosen mode.
      setTimeout(() => {
        document.querySelectorAll(".wapor-mode-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            this.renderWaporTimeseriesMulti(
              this._waporSeries,
              Object.assign({}, this._waporMeta, { mode: btn.dataset.mode })
            );
          });
        });
      }, 0);

      const box = document.getElementById("analysisBox");
      if (box && box.scrollIntoView) {
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }

    // ----------------- Socio-economic editor UI -----------------
    /**
     * Builds the socio-economic suitability editor table.
     * Table only shows Indicator + Score button.
     * Scoring criteria and selection (0–2) are handled in a Bootstrap modal
     * opened by clicking the question-mark icon next to each indicator.
     */
  /**
 * Builds the socio-economic suitability editor table.
 * Table only shows Indicator + Score button.
 * Scoring criteria and selection (0–2) are handled in a Bootstrap modal
 * opened by clicking the question-mark icon next to each indicator.
 */
renderSocioEconomicEditor(label) {
  const rowsHtml = SOCIO_INDICATORS.map((cfg) => {
    return `
      <tr data-socio-id="${cfg.id}">
        <td>
          <div class="fw-semibold">${cfg.parameter}</div>
          <div class="small text-secondary">${cfg.indicator}</div>
        </td>
        <td class="text-end">
          <button type="button"
                  class="btn btn-outline-light btn-sm socio-score-btn"
                  data-socio-id="${cfg.id}"
                  data-score="">
            Set score
          </button>
          <button type="button"
                  class="btn btn-link btn-sm text-info p-0 ms-1 socio-info-btn"
                  data-socio-id="${cfg.id}"
                  title="Scoring criteria">
            <i class="bi bi-question-circle-fill"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  const html = `
    <div class="mb-2 fw-semibold">
      Socio-economic suitability – ${label}
    </div>
    <p class="small text-secondary mb-2">
      For each indicator below, click the <i class="bi bi-question-circle-fill"></i>
      icon to view scoring criteria (0–2) and assign a score.
    </p>

    <div class="table-responsive mb-2">
      <table class="table table-sm table-dark table-striped align-middle mb-0">
        <thead>
          <tr>
            <th>Indicator</th>
            <th class="text-end" style="width: 30%;">Score (0–2)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <div class="d-flex justify-content-end gap-2 mt-2">
      <button type="button"
              class="btn btn-outline-light btn-sm"
              id="socio_reset_btn">
        Reset
      </button>
      <button type="button"
              class="btn btn-primary btn-sm"
              id="socio_compute_btn">
        Compute suitability
      </button>
    </div>
    <div id="socio_summary" class="small text-secondary mt-2">
      <em>Scores are on a 0–2 scale. When ready, click “Compute suitability”.</em>
    </div>
  `;

  this.setAnalysisHtml(html);

  // Scroll analysis box into view
  const box = document.getElementById("analysisBox");
  if (box && box.scrollIntoView) {
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Wire up buttons
  setTimeout(() => {
    const resetBtn = document.getElementById("socio_reset_btn");
    const computeBtn = document.getElementById("socio_compute_btn");
    const summaryEl = document.getElementById("socio_summary");

    // Question-mark icons OR score buttons → open criteria modal
    document
      .querySelectorAll(".socio-info-btn, .socio-score-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-socio-id");
          const fromScoreButton = btn.classList.contains("socio-score-btn");
          this.openSocioCriteriaModal(id, fromScoreButton);
        });
      });

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        document
          .querySelectorAll(".socio-score-btn")
          .forEach((btn) => {
            btn.dataset.score = "";
            btn.textContent = "Set score";
          });

        if (summaryEl) {
          summaryEl.innerHTML =
            '<em>Scores cleared. Set scores again and click “Compute suitability”.</em>';
        }

        this.setStatus(_t("status_socio_scores_cleared", "Socio-economic scores cleared."), false);
      });
    }

    if (computeBtn) {
      computeBtn.addEventListener("click", () => {
        const scores = {};
        let total = 0;
        let filledCount = 0;
        let missingCount = 0;

        document
          .querySelectorAll(".socio-score-btn")
          .forEach((btn) => {
            const id = btn.getAttribute("data-socio-id");
            const raw = btn.dataset.score;
            const val = raw === "" ? null : Number(raw);

            scores[id] = val;

            if (val === null || Number.isNaN(val)) {
              missingCount += 1;
            } else {
              total += val;
              filledCount += 1;
            }
          });

        if (filledCount === 0) {
          if (summaryEl) {
            summaryEl.innerHTML =
              '<span class="text-warning">No scores set yet. Click the ? icons to assign scores.</span>';
          }
          this.setStatus(
            "No socio-economic scores set yet. Click the ? icons to assign scores.",
            true
          );
          return;
        }

        // ----- Total score classification -----
        let suitabilityClass = "Low";
        let desc =
          "Low socio-economic suitability (total score < 14).";

        if (total >= 20) {
          suitabilityClass = "High";
          desc =
            "High socio-economic suitability (total score 20–26).";
        } else if (total >= 14) {
          suitabilityClass = "Medium";
          desc =
            "Medium socio-economic suitability (total score 14–19).";
        }

        const maxPossible = SOCIO_INDICATORS.length * 2;
        const coveragePct =
          (total / Math.max(1, maxPossible)) * 100;

        const missingNote =
          missingCount > 0
            ? `<div class="mt-1">Note: ${missingCount} indicator(s) are still unscored and currently contribute <strong>0</strong> to the total.</div>`
            : "";

        if (summaryEl) {
          summaryEl.innerHTML = `
            <div class="mt-2 p-2 rounded-3 border border-secondary-subtle bg-dark">
              <div>
                <strong>Total socio-economic score:</strong> ${total}
                <span class="ms-2 badge bg-primary">${suitabilityClass}</span>
              </div>
              <div>${desc}</div>
              <div class="mt-1 small">
                Max possible with current indicator set: ${maxPossible}
                (${coveragePct.toFixed(0)}% of maximum).
              </div>
              ${missingNote}
            </div>
          `;
        }

        console.log("Socio-economic scores:", scores, "Total:", total);
        this.setStatus(
          `Socio-economic suitability: ${suitabilityClass} (total score ${total}).`,
          false
        );
      });
    }
  }, 0);
}


    // Ensure modal DOM exists
    ensureSocioModal() {
      if (this._socioModalEl && this._socioModal) return;

      // data-i18n attrs let ivApplyTranslations() retranslate this modal
      // each time the user switches languages — no rebuild needed.
      const modalHtml = `
        <div class="modal fade" id="socioCriteriaModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-dark text-light">
              <div class="modal-header border-secondary">
                <h5 class="modal-title" id="socioCriteriaModalLabel"
                    data-i18n="socio_modal_title">
                  Indicator scoring
                </h5>
                <button type="button"
                        class="btn-close btn-close-white"
                        data-bs-dismiss="modal"
                        aria-label="Close"></button>
              </div>
              <div class="modal-body small text-secondary" id="socioCriteriaModalBody">
                <!-- filled dynamically -->
              </div>
              <div class="modal-footer border-secondary">
                <button type="button"
                        class="btn btn-outline-light btn-sm"
                        data-bs-dismiss="modal"
                        data-i18n="socio_modal_cancel">
                  Cancel
                </button>
                <button type="button"
                        class="btn btn-primary btn-sm"
                        id="socioCriteriaSaveBtn"
                        data-i18n="socio_modal_save_score">
                  Save score
                </button>
              </div>
            </div>
          </div>
        </div>
      `;

      const wrapper = document.createElement("div");
      wrapper.innerHTML = modalHtml;
      document.body.appendChild(wrapper.firstElementChild);

      // Translate modal contents to the active language right after insert
      if (typeof window.ivApplyTranslations === "function") {
        window.ivApplyTranslations(window.ivCurrentLang || "en");
      }

      this._socioModalEl = document.getElementById("socioCriteriaModal");
      const titleEl = document.getElementById("socioCriteriaModalLabel");
      const bodyEl = document.getElementById("socioCriteriaModalBody");
      const saveBtn = document.getElementById("socioCriteriaSaveBtn");

      if (!this._socioModalEl || !titleEl || !bodyEl || !saveBtn) return;

      if (window.bootstrap && window.bootstrap.Modal) {
        this._socioModal = new bootstrap.Modal(this._socioModalEl);
      }

      // store references
      this._socioModalTitleEl = titleEl;
      this._socioModalBodyEl = bodyEl;
      this._socioModalSaveBtn = saveBtn;
    }

    /**
     * Opens the Bootstrap modal for the given indicator id.
     * User can see criteria and pick score 0–2.
     */
    openSocioCriteriaModal(indicatorId, focusScore) {
      this.ensureSocioModal();
      if (!this._socioModal || !this._socioModalBodyEl) return;

      const cfg = SOCIO_INDICATORS.find((x) => x.id === indicatorId);
      if (!cfg) return;

      const scoreBtn = document.querySelector(
        `.socio-score-btn[data-socio-id="${indicatorId}"]`
      );
      const currentScore = scoreBtn && scoreBtn.dataset.score !== ""
        ? Number(scoreBtn.dataset.score)
        : null;

      this._socioModalTitleEl.textContent = cfg.parameter;
      this._socioModalBodyEl.innerHTML = `
        <p class="mb-1 text-light fw-semibold">${cfg.indicator}</p>
        <p class="mb-2">${cfg.criteria}</p>

        <div class="mb-1 fw-semibold text-light">
          Select score (0 = low, 2 = high):
        </div>
        <div class="d-flex flex-column gap-1">
          <label class="form-check small">
            <input class="form-check-input" type="radio" name="socio_score_choice" value="0"
                   ${currentScore === 0 ? "checked" : ""}>
            <span class="form-check-label">Score 0</span>
          </label>
          <label class="form-check small">
            <input class="form-check-input" type="radio" name="socio_score_choice" value="1"
                   ${currentScore === 1 ? "checked" : ""}>
            <span class="form-check-label">Score 1</span>
          </label>
          <label class="form-check small">
            <input class="form-check-input" type="radio" name="socio_score_choice" value="2"
                   ${currentScore === 2 ? "checked" : ""}>
            <span class="form-check-label">Score 2</span>
          </label>
        </div>
      `;

      // Remove old handler if any
      if (this._socioModalSaveHandler) {
        this._socioModalSaveBtn.removeEventListener(
          "click",
          this._socioModalSaveHandler
        );
      }

      this._socioModalSaveHandler = () => {
        const choice = this._socioModalBodyEl.querySelector(
          'input[name="socio_score_choice"]:checked'
        );
        if (!scoreBtn) return;

        if (!choice) {
          scoreBtn.dataset.score = "";
          scoreBtn.textContent = "Set score";
        } else {
          const val = Number(choice.value);
          scoreBtn.dataset.score = String(val);
          scoreBtn.textContent = `Score: ${val}`;
        }

        this._socioModal.hide();
      };

      this._socioModalSaveBtn.addEventListener(
        "click",
        this._socioModalSaveHandler
      );

      this._socioModal.show();

      // optional: if user clicked the score button, auto focus the radio group
      if (focusScore) {
        const firstRadio = this._socioModalBodyEl.querySelector(
          'input[name="socio_score_choice"]'
        );
        if (firstRadio && firstRadio.focus) {
          setTimeout(() => firstRadio.focus(), 150);
        }
      }
    }

    // ----------------- Soil suitability analysis renderer -----------------
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

      // Scroll analysis box into view
      const box = document.getElementById("analysisBox");
      if (box && box.scrollIntoView) {
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      try {
        if (window.IrrChart && typeof window.IrrChart.update === "function") {
          window.IrrChart.update(processed, { title: `Suitability – ${label}` });
        }
      } catch (err) {
        console.error("IrrChart.update failed:", err);
      }
    }

    // ----------------- Draw-delete reset -----------------
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
