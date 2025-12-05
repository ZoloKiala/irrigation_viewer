/* global Chart */

(function () {
  const CANVAS_ID = "irr-chart";

  // Same colours as the map legend
  const CLASS_COLORS = {
    0: "#f1e5cd", // N
    1: "#166534", // S1
    2: "#22c55e", // S2
    3: "#fde047", // S3
  };

  function colourForItem(item) {
    // Prefer numeric class if available
    const cls = typeof item.class === "number"
      ? item.class
      : parseInt(item.class, 10);

    if (!Number.isNaN(cls) && CLASS_COLORS.hasOwnProperty(cls)) {
      return CLASS_COLORS[cls];
    }

    // Fallback based on label text
    const label = (item.label || "").toUpperCase();
    if (label.startsWith("N")) return CLASS_COLORS[0];
    if (label.startsWith("S1")) return CLASS_COLORS[1];
    if (label.startsWith("S2")) return CLASS_COLORS[2];
    if (label.startsWith("S3")) return CLASS_COLORS[3];

    // Generic grey fallback
    return "#6b7280";
  }

  const IrrChart = {
    _chart: null,

    _ensureChart() {
      if (this._chart) return this._chart;

      const canvas = document.getElementById(CANVAS_ID);
      if (!canvas) return null;

      const ctx = canvas.getContext("2d");
      this._chart = new Chart(ctx, {
        type: "pie",
        data: {
          labels: [],
          datasets: [
            {
              label: "Area (ha)",
              data: [],
              backgroundColor: [],
              borderColor: "#020617",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: "#e5e7eb",
                boxWidth: 10,
              },
            },
            title: {
              display: false,
            },
          },
        },
      });

      return this._chart;
    },

    update(items, opts) {
      const chart = this._ensureChart();
      if (!chart || !Array.isArray(items)) return;

      const labels = [];
      const data = [];
      const colors = [];

      items.forEach((item) => {
        const lbl = item.label || String(item.class);
        const val = Number(item.area_ha) || 0;
        if (val <= 0) return;

        labels.push(lbl);
        data.push(val);
        colors.push(colourForItem(item));
      });

      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].backgroundColor = colors;

      if (opts && opts.title) {
        chart.options.plugins.title.display = true;
        chart.options.plugins.title.text = opts.title;
        chart.options.plugins.title.color = "#e5e7eb";
        chart.options.plugins.title.font = { size: 13, weight: "600" };
      } else {
        chart.options.plugins.title.display = false;
      }

      chart.update("active");
    },

    clear() {
      const chart = this._ensureChart();
      if (!chart) return;

      chart.data.labels = [];
      chart.data.datasets[0].data = [];
      chart.data.datasets[0].backgroundColor = [];
      chart.options.plugins.title.display = false;
      chart.update("none");
    },
  };

  window.IrrChart = IrrChart;
})();
