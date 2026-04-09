let chartLoaderPromise = null;

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function chartPalette() {
  return {
    accent: cssVar("--chart-accent", "#2f7df4"),
    accentAlt: cssVar("--chart-accent-alt", "#67b2ff"),
    positive: cssVar("--chart-positive", "#1ea672"),
    warning: cssVar("--chart-warning", "#e29b2c"),
    danger: cssVar("--chart-danger", "#d45d4c"),
    muted: cssVar("--chart-muted", "#7d8ea8"),
    violet: cssVar("--chart-violet", "#7b6cf6"),
    grid: cssVar("--chart-grid", "rgba(125, 142, 168, 0.2)"),
    text: cssVar("--chart-text", "#516079"),
  };
}

export function syncChartTheme() {
  if (!window.Chart) return;
  const palette = chartPalette();
  window.Chart.defaults.color = palette.text;
  window.Chart.defaults.borderColor = palette.grid;
  window.Chart.defaults.font.family = '"IBM Plex Sans", "Inter", "Segoe UI", sans-serif';
}

export async function ensureChartJs() {
  if (window.Chart) {
    syncChartTheme();
    return window.Chart;
  }
  if (!chartLoaderPromise) {
    chartLoaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-networth-chartjs="true"]');
      if (existing) {
        existing.addEventListener("load", () => {
          syncChartTheme();
          resolve(window.Chart);
        }, { once: true });
        existing.addEventListener("error", () => reject(new Error("Unable to load charts.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      script.async = true;
      script.dataset.networthChartjs = "true";
      script.onload = () => {
        syncChartTheme();
        resolve(window.Chart);
      };
      script.onerror = () => reject(new Error("Unable to load charts."));
      document.head.appendChild(script);
    });
  }
  return chartLoaderPromise;
}

window.addEventListener("networth:themechange", () => {
  syncChartTheme();
});
