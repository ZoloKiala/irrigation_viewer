/* global turf */

(function () {
  "use strict";

  const API = window.MAPVIEWER || (window.MAPVIEWER = {});

  // Translation helper — falls back to the English string if ivT() isn't loaded yet.
  const _t = (key, fallback) =>
    typeof window.ivT === "function" ? window.ivT(key, fallback) : fallback;

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
        const fc = this.draw && this.draw.getAll ? this.draw.getAll() : null;
        if (!fc || !fc.features || !fc.features.length) {
          this.setStatus(_t("status_draw_polygon_first", "Draw a polygon first."), true);
          return;
        }
        const geom = fc.features[fc.features.length - 1].geometry;
        return this.runFreehandWaporTimeseries(geom);
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

    // ----------------- Freehand WaPOR time-series analysis -----------------
    async runFreehandWaporTimeseries(geom, opts = {}) {
      try {
        this.setStatus("Running WaPOR time-series on drawn polygon…", false);
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
          this.setStatus(`WaPOR time series failed (${resp.status})`, true);
          return;
        }
        const data = await resp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length || items.every((it) => !it.n_pixels)) {
          this.setAnalysisHtml(
            `<em>${data.message || "No WaPOR pixels inside the drawn polygon for the selected date."}</em>`
          );
          this.setStatus("No WaPOR pixels inside polygon.", true);
          return;
        }
        this.renderWaporTimeseries("Drawn polygon", items);
        this.setStatus("WaPOR time-series complete.", false);
      } catch (err) {
        console.error("Freehand WaPOR time-series failed", err);
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

    renderWaporTimeseries(label, items) {
      const fmt = (n) => (n == null ? "—" : Number(n).toFixed(2));
      // Sort items chronologically by dekad_date so multi-year inputs render
      // left-to-right in time order regardless of backend ordering.
      const valid = items
        .filter((it) => Number.isFinite(it.mean_eta))
        .slice()
        .sort((a, b) => (a.dekad_date || "").localeCompare(b.dekad_date || ""));

      // Chart geometry — grow taller when there are lots of points so the
      // rotated date labels along the x-axis stay readable.
      const W = 380;
      const H = valid.length > 12 ? 220 : 180;
      const m = { top: 16, right: 16, bottom: 50, left: 40 };
      const innerW = W - m.left - m.right;
      const innerH = H - m.top - m.bottom;

      let svg = "";
      if (valid.length >= 1) {
        const stds = valid.map((it) => Number.isFinite(it.std_eta) ? it.std_eta : 0);
        const meansLo = valid.map((it, i) => it.mean_eta - stds[i]);
        const meansHi = valid.map((it, i) => it.mean_eta + stds[i]);
        const dataMin = Math.min(...meansLo);
        const dataMax = Math.max(...meansHi);
        const pad = Math.max(0.5, (dataMax - dataMin) * 0.1);
        const yMin = dataMin - pad;
        const yMax = dataMax + pad;
        const yRange = yMax - yMin || 1;

        const xAt = (i) =>
          m.left + (valid.length === 1
            ? innerW / 2
            : (innerW * i) / (valid.length - 1));
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

        // Error bars
        const errBars = valid
          .map((it, i) => {
            const std = stds[i];
            if (!std) return "";
            const x = xAt(i);
            return `
              <line x1="${x}" x2="${x}"
                    y1="${yAt(it.mean_eta - std)}" y2="${yAt(it.mean_eta + std)}"
                    stroke="#94a3b8" stroke-width="1.5"/>
              <line x1="${x - 3}" x2="${x + 3}" y1="${yAt(it.mean_eta - std)}" y2="${yAt(it.mean_eta - std)}" stroke="#94a3b8" stroke-width="1.5"/>
              <line x1="${x - 3}" x2="${x + 3}" y1="${yAt(it.mean_eta + std)}" y2="${yAt(it.mean_eta + std)}" stroke="#94a3b8" stroke-width="1.5"/>
            `;
          })
          .join("");

        // Connected mean line
        const linePath = valid.length === 1
          ? ""
          : `<path d="${valid.map((it, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(it.mean_eta)}`).join(" ")}"
                  stroke="#22d3ee" stroke-width="2" fill="none"/>`;

        // Markers with tooltip
        const markers = valid
          .map(
            (it, i) => `
              <circle cx="${xAt(i)}" cy="${yAt(it.mean_eta)}" r="4"
                      fill="#22d3ee" stroke="#0f172a" stroke-width="1.5">
                <title>${it.dekad_date || it.dekad}: ${fmt(it.mean_eta)} ± ${fmt(it.std_eta)} mm</title>
              </circle>
            `
          )
          .join("");

        // X-axis labels: full YYYY-MM-DD when sparse, year-tick-only when
        // dense. Rotated 45° so multi-year ranges don't overlap.
        const maxLabels = 8;
        const stride = Math.max(1, Math.ceil(valid.length / maxLabels));
        const xLabels = valid
          .map((it, i) => {
            if (i % stride !== 0 && i !== valid.length - 1) return "";
            const d = it.dekad_date || "";
            return `
              <text x="${xAt(i)}" y="${H - m.bottom + 14}"
                    text-anchor="end" font-size="10" fill="#94a3b8"
                    transform="rotate(-45 ${xAt(i)} ${H - m.bottom + 14})">
                ${d}
              </text>
            `;
          })
          .join("");

        const xAxis = `
          <line x1="${m.left}" x2="${W - m.right}"
                y1="${H - m.bottom}" y2="${H - m.bottom}"
                stroke="#475569" stroke-width="1"/>
        `;

        svg = `
          <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}"
               preserveAspectRatio="xMidYMid meet" class="wapor-ts-chart">
            ${gridLines}
            ${xAxis}
            ${errBars}
            ${linePath}
            ${markers}
            ${xLabels}
            <text x="${m.left}" y="12" font-size="10" fill="#94a3b8">mm / dekad</text>
          </svg>
        `;
      } else {
        svg = '<div class="small text-secondary">No valid dekads.</div>';
      }

      this.setAnalysisHtml(`
        <div class="mb-1 fw-semibold">Crop water use — ${label}</div>
        <div class="small text-secondary mb-2">
          Mean WaPOR L1 AETI_D (mm / dekad) · ${valid.length} dekad${valid.length === 1 ? "" : "s"}
        </div>
        ${svg}
      `);

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
