/* Lightweight HTML bar-row chart for suitability-class areas.
   Same shape API as the previous Chart.js wrapper:
     - IrrChart.update(items, opts?) where items = [{class, label, area_ha}, …]
     - IrrChart.clear()
   Renders into #irr-chart. */

(function () {
  const CONTAINER_ID = "irr-chart";

  // Default palette (Verdant). Tweaks panel can override via IV_SUIT_PALETTE.
  const DEFAULT_PALETTE = {
    N: "#f1e5cd", S1: "#166534", S2: "#22c55e", S3: "#fde047",
  };

  function getPalette() {
    return window.IV_SUIT_PALETTE || DEFAULT_PALETTE;
  }

  function colourForItem(item) {
    const p = getPalette();
    const byIndex = [p.N, p.S1, p.S2, p.S3];
    const cls = typeof item.class === "number"
      ? item.class
      : parseInt(item.class, 10);
    if (!Number.isNaN(cls) && cls >= 0 && cls < byIndex.length) {
      return byIndex[cls];
    }
    const label = (item.label || "").toUpperCase();
    if (label.startsWith("N")) return p.N;
    if (label.startsWith("S1")) return p.S1;
    if (label.startsWith("S2")) return p.S2;
    if (label.startsWith("S3")) return p.S3;
    return "#6b7280";
  }

  function fmtHa(n) {
    return Math.round(n).toLocaleString();
  }

  function emptyMessage() {
    if (typeof window.ivT === "function") {
      return window.ivT(
        "chart_empty",
        "Choose a country and map layer, then draw an area or click a boundary to run analysis."
      );
    }
    return "Choose a country and map layer, then draw an area or click a boundary to run analysis.";
  }

  // Show/hide the bordered chart card so we never display an empty box
  // (e.g. irrigation/WaPOR analyses produce a table but no bar chart).
  function setCardHidden(container, hidden) {
    const card = container && container.closest(".iv-chart-card");
    if (card) card.classList.toggle("is-hidden", !!hidden);
  }

  function renderEmpty(container) {
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "iv-chart-empty";
    empty.setAttribute("data-i18n", "chart_empty");
    empty.textContent = emptyMessage();
    container.appendChild(empty);
    setCardHidden(container, true);
  }

  const IrrChart = {
    update(items, opts) {
      const container = document.getElementById(CONTAINER_ID);
      if (!container || !Array.isArray(items)) return;

      const visible = items.filter((it) => (Number(it.area_ha) || 0) > 0);
      if (!visible.length) {
        renderEmpty(container);
        return;
      }
      setCardHidden(container, false);  // there's data — reveal the chart card

      const max = Math.max(...visible.map((it) => Number(it.area_ha) || 0));
      container.innerHTML = "";

      if (opts && opts.title) {
        const title = document.createElement("div");
        title.className = "iv-chart-title";
        title.textContent = opts.title;
        container.appendChild(title);
      }

      visible.forEach((item) => {
        const val = Number(item.area_ha) || 0;
        const widthPct = max > 0 ? (val / max) * 100 : 0;
        const color = colourForItem(item);

        const row = document.createElement("div");
        row.className = "iv-chart-row";

        const lbl = document.createElement("span");
        lbl.className = "iv-chart-lbl";
        lbl.textContent = item.label || String(item.class);

        const wrap = document.createElement("div");
        wrap.className = "iv-chart-bar-wrap";
        const bar = document.createElement("div");
        bar.className = "iv-chart-bar";
        bar.style.width = widthPct + "%";
        bar.style.background = color;
        wrap.appendChild(bar);

        const num = document.createElement("span");
        num.className = "iv-chart-val";
        num.textContent = fmtHa(val) + " ha";

        row.appendChild(lbl);
        row.appendChild(wrap);
        row.appendChild(num);
        container.appendChild(row);
      });
    },

    clear() {
      const container = document.getElementById(CONTAINER_ID);
      if (!container) return;
      renderEmpty(container);
    },
  };

  window.IrrChart = IrrChart;

  // Re-render the empty-state copy when the user switches languages.
  document.addEventListener("iv:languagechange", () => {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    if (container.querySelector(".iv-chart-empty")) {
      renderEmpty(container);
    }
  });

  // Repaint bars when the palette tweak changes.
  document.addEventListener("iv:tweak-palette-changed", () => {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    // Re-color any rendered bars in place (no need to rebuild the row layout).
    container.querySelectorAll(".iv-chart-row").forEach((row) => {
      const lbl = row.querySelector(".iv-chart-lbl");
      const bar = row.querySelector(".iv-chart-bar");
      if (!lbl || !bar) return;
      const text = (lbl.textContent || "").trim().toUpperCase();
      const fakeItem = { label: text };
      bar.style.background = colourForItem(fakeItem);
    });
  });
})();
