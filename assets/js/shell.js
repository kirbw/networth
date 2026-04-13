import { getPageMeta } from "./page-meta.js";

function classifySections(page, family) {
  const appContent = document.getElementById("app-content");
  if (!appContent) return;
  appContent.classList.remove("dashboard-surface", "report-surface", "profile-surface", "admin-surface", "sandy-surface");
  appContent.classList.add("app-surface");
  appContent.querySelectorAll(":scope > section").forEach((section) => {
    section.classList.remove("panel-subnav", "panel-form", "panel-table", "panel-report-header", "panel-full");
    if (section.querySelector(".admin-subnav, .sandy-subnav")) {
      section.classList.add("panel-subnav", "panel-full");
      return;
    }
    if (section.classList.contains("report-header")) {
      section.classList.add("panel-report-header", "panel-full");
      return;
    }
    if (section.querySelector("table")) {
      section.classList.add("panel-table");
      return;
    }
    if (section.querySelector("form") && !section.querySelector("table")) {
      section.classList.add("panel-form");
      return;
    }
    section.classList.add("panel-full");
  });

  if (page === "home") appContent.classList.add("dashboard-surface");
  if (family === "report") appContent.classList.add("report-surface");
  if (family === "profile") appContent.classList.add("profile-surface");
  if (family === "admin") appContent.classList.add("admin-surface");
  if (family === "sandy") appContent.classList.add("sandy-surface");
}

export function decoratePageShell(page) {
  const meta = getPageMeta(page);
  Array.from(document.body.classList).forEach((className) => {
    if (className.startsWith("page-family-") || className.startsWith("page-id-")) {
      document.body.classList.remove(className);
    }
  });
  document.body.classList.add(`page-family-${meta.family}`);
  document.body.classList.add(`page-id-${page}`);

  const container = document.querySelector(".container");
  if (page !== "home") {
    document.getElementById("home-kpi-strip")?.remove();
  }
  if (page === "home" && container && !document.getElementById("home-kpi-strip")) {
    const kpis = document.createElement("section");
    kpis.className = "surface-kpi-strip";
    kpis.id = "home-kpi-strip";
    kpis.innerHTML = `
      <article class="surface-kpi">
        <span class="surface-kpi-label">Latest income</span>
        <strong id="home-kpi-income">$0</strong>
        <small id="home-kpi-income-note">No records yet</small>
      </article>
      <article class="surface-kpi">
        <span class="surface-kpi-label">Latest net worth</span>
        <strong id="home-kpi-networth">$0</strong>
        <small id="home-kpi-networth-note">Add a net worth record to compare trends</small>
      </article>
      <article class="surface-kpi">
        <span class="surface-kpi-label">Giving rate</span>
        <strong id="home-kpi-giving">0%</strong>
        <small id="home-kpi-giving-note">Cumulative giving across saved years</small>
      </article>
      <article class="surface-kpi">
        <span class="surface-kpi-label">Tracked balance sheet</span>
        <strong id="home-kpi-balance-sheet">$0</strong>
        <small id="home-kpi-balance-note">Assets + investments minus liabilities</small>
      </article>
    `;
    const appContent = document.getElementById("app-content");
    if (appContent) {
      container.insertBefore(kpis, appContent);
    }
  }

  classifySections(page, meta.family);
}

export function updateHomeKpis(summary) {
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  if (!summary) return;
  setText("home-kpi-income", summary.latestIncome || "$0");
  setText("home-kpi-income-note", summary.incomeNote || "No records yet");
  setText("home-kpi-networth", summary.latestNetWorth || "$0");
  setText("home-kpi-networth-note", summary.netWorthNote || "No net worth data yet");
  setText("home-kpi-giving", summary.givingRate || "0%");
  setText("home-kpi-giving-note", summary.givingNote || "Cumulative giving rate");
  setText("home-kpi-balance-sheet", summary.balanceSheet || "$0");
  setText("home-kpi-balance-note", summary.balanceNote || "Assets + investments minus liabilities");
}
