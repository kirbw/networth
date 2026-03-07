const DEFAULT_GOAL_PERCENT = 10;
const page = document.body.dataset.page;
const NEXT_ALLOWED_PATHS = new Set(["/records.html", "/investments.html", "/precious-metals.html", "/real-estate.html", "/business-ventures.html", "/retirement-accounts.html", "/net-worth-report.html", "/monthly-payments-report.html", "/admin-users.html", "/admin-email.html", "/admin-backups.html", "/admin-updates.html", "/admin-notifications.html", "/notifications.html", "/liquid-cash-report.html", "/goals.html", "/taxes.html", "/liabilities-recurring-expenses.html"]);

const authCard = document.getElementById("auth-card");
const appContent = document.getElementById("app-content");
const sessionName = document.getElementById("session-name");
const logoutBtn = document.getElementById("logout-btn");
let notificationsBtn = document.getElementById("notifications-btn");
let notificationsBadge = document.getElementById("notifications-badge");
const navAdmin = document.getElementById("nav-admin");
const versionInfo = document.getElementById("version-info");

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const verifyForm = document.getElementById("verify-form");
const forgotPasswordForm = document.getElementById("forgot-password-form");
const toggleSignupBtn = document.getElementById("toggle-signup-btn");
const toggleLoginBtn = document.getElementById("toggle-login-btn");
const toggleVerifyBtn = document.getElementById("toggle-verify-btn");
const toggleForgotBtn = document.getElementById("toggle-forgot-btn");
const authMessage = document.getElementById("auth-message");

let currentUser = null;
let records = [];
let editingYear = null;
let incomeGivingChart;
let netWorthChart;
let goalProgressChart;
let investmentsSummaryChart;
let liabilitiesSummaryChart;
let assetsSummaryChart;

function apiFetch(url, options = {}) {
  const headers = options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : (options.headers || {});
  return fetch(url, { ...options, headers });
}

function currency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}


function formatCompactCurrency(value) {
  const num = Number(value || 0);
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function setText(el, text) {
  if (el) el.textContent = text;
}

function getGoalPercent() {
  const parsed = Number(currentUser?.givingGoalPercent);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) return DEFAULT_GOAL_PERCENT;
  return parsed;
}

function showAuthMode(mode) {
  const forms = { login: loginForm, signup: signupForm, verify: verifyForm, forgot: forgotPasswordForm };
  Object.entries(forms).forEach(([k, f]) => f?.classList.toggle("hidden", k !== mode));
}

function renderAuthState() {
  const authenticated = Boolean(currentUser);
  authCard?.classList.toggle("hidden", authenticated);
  appContent?.classList.toggle("hidden", !authenticated);
  if (sessionName) {
    sessionName.textContent = authenticated ? `${currentUser.fullName || currentUser.username} (${currentUser.role})` : "Not signed in";
    sessionName.style.cursor = authenticated ? "pointer" : "default";
    sessionName.title = authenticated ? "Open profile" : "";
  }
  if (notificationsBtn) {
    notificationsBtn.classList.toggle("hidden", !authenticated);
    const unread = Number(currentUser?.unreadNotifications || 0);
    notificationsBtn.classList.toggle("has-unread", unread > 0);
    notificationsBtn.title = unread > 0 ? `${unread} unread notifications` : "Notifications";
  }
  if (notificationsBadge) {
    const unread = Number(currentUser?.unreadNotifications || 0);
    notificationsBadge.textContent = unread > 99 ? "99+" : String(unread);
    notificationsBadge.classList.toggle("hidden", unread <= 0);
  }
  navAdmin?.classList.toggle("hidden", !(authenticated && currentUser.role === "admin"));
  document.body.classList.toggle("dark-mode", Boolean(currentUser?.darkMode));
}

function ensureAdminPageAccess() {
  if (!["admin-users", "admin-email", "admin-backups", "admin-updates", "admin-notifications"].includes(page)) return;
  if (!currentUser || currentUser.role !== "admin") window.location.href = "/";
}

function sortRecords() { records.sort((a, b) => a.year - b.year); }

function populateYearOptions() {
  const yearOptions = document.getElementById("year-options");
  if (!yearOptions) return;
  yearOptions.innerHTML = "";
  const currentYear = new Date().getFullYear();
  for (let y = currentYear + 1; y >= 1970; y -= 1) {
    const option = document.createElement("option");
    option.value = String(y);
    yearOptions.appendChild(option);
  }
}

async function loadVersion() {
  try {
    const response = await apiFetch("/api/version");
    const payload = await response.json();
    setText(versionInfo, `Version ${payload.version || "unknown"}`);
  } catch {
    setText(versionInfo, "Version unknown");
  }
}

async function loadCurrentUser() {
  const response = await apiFetch("/api/me");
  const payload = await response.json();
  currentUser = payload.authenticated ? payload.user : null;
  renderAuthState();
  ensureAdminPageAccess();
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const response = await apiFetch("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  const payload = await response.json();
  if (!response.ok) return setText(authMessage, payload.error || "Login failed.");
  currentUser = payload.user;
  setText(authMessage, "Logged in successfully.");
  renderAuthState();
  ensureAdminPageAccess();
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (NEXT_ALLOWED_PATHS.has(next)) {
    window.location.href = next;
    return;
  }
  await initPageData();
}

async function handleSignup(event) {
  event.preventDefault();
  const fullName = document.getElementById("signup-full-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;
  const response = await apiFetch("/api/signup", { method: "POST", body: JSON.stringify({ fullName, email, username, password }) });
  const payload = await response.json();
  if (!response.ok) return setText(authMessage, payload.error || "Unable to create account.");
  setText(authMessage, "Account created. Check your email for verification code.");
  signupForm.reset();
  showAuthMode("verify");
  const verifyUsername = document.getElementById("verify-username");
  if (verifyUsername) verifyUsername.value = username;
}

async function handleVerify(event) {
  event.preventDefault();
  const username = document.getElementById("verify-username").value.trim();
  const code = document.getElementById("verify-code").value.trim();
  const response = await apiFetch("/api/verify-account", { method: "POST", body: JSON.stringify({ username, code }) });
  const payload = await response.json();
  if (!response.ok) return setText(authMessage, payload.error || "Verification failed.");
  setText(authMessage, "Account verified. You can now log in.");
  verifyForm.reset();
  showAuthMode("login");
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const identifier = document.getElementById("forgot-identifier").value.trim();
  const response = await apiFetch("/api/forgot-password", { method: "POST", body: JSON.stringify({ identifier }) });
  const payload = await response.json();
  if (!response.ok) return setText(authMessage, payload.error || "Unable to send reset request.");
  setText(authMessage, payload.message || "If an account exists, reset email sent.");
  forgotPasswordForm.reset();
  showAuthMode("login");
}

async function handleLogout() {
  await apiFetch("/api/logout", { method: "POST", body: JSON.stringify({}) });
  currentUser = null;
  records = [];
  renderAuthState();
}

function bindAuthUI() {
  if (!notificationsBtn) {
    const controls = document.querySelector(".session-controls");
    if (controls) {
      notificationsBtn = document.createElement("button");
      notificationsBtn.id = "notifications-btn";
      notificationsBtn.type = "button";
      notificationsBtn.className = "hidden";
      notificationsBtn.innerHTML = '🔔 <span id="notifications-badge" class="hidden">0</span>';
      controls.insertBefore(notificationsBtn, logoutBtn || null);
      notificationsBadge = notificationsBtn.querySelector("#notifications-badge");
    }
  }
  loginForm?.addEventListener("submit", handleLogin);
  signupForm?.addEventListener("submit", handleSignup);
  verifyForm?.addEventListener("submit", handleVerify);
  forgotPasswordForm?.addEventListener("submit", handleForgotPassword);
  logoutBtn?.addEventListener("click", handleLogout);
  notificationsBtn?.addEventListener("click", () => { if (currentUser) window.location.href = "/notifications.html"; });
  sessionName?.addEventListener("click", () => { if (currentUser) window.location.href = "/profile.html"; });
  toggleSignupBtn?.addEventListener("click", () => showAuthMode("signup"));
  toggleLoginBtn?.addEventListener("click", () => showAuthMode("login"));
  toggleVerifyBtn?.addEventListener("click", () => showAuthMode("verify"));
  toggleForgotBtn?.addEventListener("click", () => showAuthMode("forgot"));
}

async function loadRecords() {
  const response = await apiFetch("/api/records");
  if (!response.ok) throw new Error("Unable to load records.");
  records = await response.json();
  sortRecords();
}

function initHomePage() {
  const form = document.getElementById("finance-form");
  const formMessage = document.getElementById("form-message");
  const goalIndicator = document.getElementById("goal-indicator");
  const yearInput = document.getElementById("year");
  const incomeInput = document.getElementById("income");
  const donationInput = document.getElementById("donation");
  const netWorthInput = document.getElementById("netWorth");
  const investmentsTotalEl = document.getElementById("investments-combined-total");
  const liabilitiesTotalEl = document.getElementById("liabilities-combined-total");
  const assetsTotalEl = document.getElementById("assets-combined-total");

  const destroy = (c) => { if (c) c.destroy(); };

  async function renderInvestmentsSummary() {
    const chartEl = document.getElementById("investments-summary-chart");
    if (!chartEl) return;
    const response = await apiFetch("/api/investments/summary");
    if (!response.ok) return;
    const summary = await response.json();
    const entries = [
      { label: "Stocks", value: summary.stocks || 0, color: "#3956f6" },
      { label: "Precious Metals", value: summary.preciousMetals || 0, color: "#00a76f" },
      { label: "Real Estate", value: summary.realEstateMyValue || 0, color: "#9747ff" },
      { label: "Business Ventures", value: summary.businessVenturesMyValue || 0, color: "#f08c00" },
      { label: "Retirement Accounts", value: summary.retirementAccounts || 0, color: "#0090d8" },
    ].sort((a, b) => b.value - a.value);
    destroy(investmentsSummaryChart);
    investmentsSummaryChart = new Chart(chartEl.getContext("2d"), {
      type: "bar",
      data: {
        labels: entries.map((e) => e.label),
        datasets: [{ label: "Total Value", data: entries.map((e) => e.value), backgroundColor: entries.map((e) => e.color) }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => formatCompactCurrency(v) } } } },
    });
    if (investmentsTotalEl) investmentsTotalEl.textContent = `Combined total: ${currency(summary.combinedTotal || 0)}`;
  }


  async function renderLiabilitiesSummary() {
    const chartEl = document.getElementById("liabilities-summary-chart");
    if (!chartEl) return;
    const response = await apiFetch("/api/liabilities/summary");
    if (!response.ok) return;
    const summary = await response.json();
    const entries = [
      { label: "Mortgages", value: summary.mortgages || 0, color: "#c94b4b" },
      { label: "Credit Cards", value: summary.creditCards || 0, color: "#e07474" },
      { label: "Loans", value: summary.loans || 0, color: "#a94442" },
    ].sort((a, b) => b.value - a.value);
    destroy(liabilitiesSummaryChart);
    liabilitiesSummaryChart = new Chart(chartEl.getContext("2d"), {
      type: "bar",
      data: {
        labels: entries.map((e) => e.label),
        datasets: [{ label: "Total Liability", data: entries.map((e) => e.value), backgroundColor: entries.map((e) => e.color) }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => formatCompactCurrency(v) } } } },
    });
    if (liabilitiesTotalEl) liabilitiesTotalEl.textContent = `Combined liabilities: ${currency(summary.combinedTotal || 0)}`;
  }

  async function renderAssetsSummary() {
    const chartEl = document.getElementById("assets-summary-chart");
    if (!chartEl) return;
    const [vehiclesRes, gunsRes, bankRes, cashRes] = await Promise.all([
      apiFetch("/api/assets/vehicles"),
      apiFetch("/api/assets/guns"),
      apiFetch("/api/assets/bank-accounts"),
      apiFetch("/api/assets/cash"),
    ]);
    if (![vehiclesRes, gunsRes, bankRes, cashRes].every((r) => r.ok)) return;
    const vehicles = await vehiclesRes.json();
    const guns = await gunsRes.json();
    const bankAccounts = await bankRes.json();
    const cash = await cashRes.json();

    const entries = [
      { label: "Bank Accounts", value: bankAccounts.reduce((sum, x) => sum + Number(x.balance || 0), 0), color: "#0090d8" },
      { label: "Vehicles", value: vehicles.reduce((sum, x) => sum + Number(x.value || 0), 0), color: "#3956f6" },
      { label: "Guns", value: guns.reduce((sum, x) => sum + Number(x.value || 0), 0), color: "#9747ff" },
      { label: "Cash", value: cash.reduce((sum, x) => sum + Number(x.amount || 0), 0), color: "#00a76f" },
    ].sort((a, b) => b.value - a.value);

    destroy(assetsSummaryChart);
    assetsSummaryChart = new Chart(chartEl.getContext("2d"), {
      type: "bar",
      data: {
        labels: entries.map((e) => e.label),
        datasets: [{ label: "Total Asset Value", data: entries.map((e) => e.value), backgroundColor: entries.map((e) => e.color) }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => formatCompactCurrency(v) } } } },
    });

    if (assetsTotalEl) {
      const combined = entries.reduce((sum, e) => sum + e.value, 0);
      assetsTotalEl.textContent = `Combined assets: ${currency(combined)}`;
    }
  }
  function renderCharts() {
    const goalPercent = getGoalPercent();
    const ratio = goalPercent / 100;

    destroy(incomeGivingChart);
    incomeGivingChart = new Chart(document.getElementById("income-giving-chart").getContext("2d"), {
      type: "line",
      data: { labels: records.map((r) => r.year), datasets: [{ label: "Income", data: records.map((r) => r.income), borderColor: "#3956f6", tension: 0.2 }, { label: "Donations", data: records.map((r) => r.donation), borderColor: "#00a76f", tension: 0.2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v) => formatCompactCurrency(v) } } } },
    });

    const nw = records.filter((r) => r.netWorth != null);
    destroy(netWorthChart);
    netWorthChart = new Chart(document.getElementById("net-worth-chart").getContext("2d"), {
      type: "line",
      data: { labels: nw.map((r) => r.year), datasets: [{ label: "Net Worth", data: nw.map((r) => r.netWorth), borderColor: "#9747ff", tension: 0.2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v) => formatCompactCurrency(v) } } } },
    });

    let cumIncome = 0;
    let cumDonation = 0;
    const cumIncomeSeries = [];
    const cumDonationSeries = [];
    const targetSeries = [];
    for (const r of records) {
      cumIncome += Number(r.income);
      cumDonation += Number(r.donation);
      cumIncomeSeries.push(cumIncome);
      cumDonationSeries.push(cumDonation);
      targetSeries.push(cumIncome * ratio);
    }

    const targetAmount = cumIncome * ratio;
    const needed = Math.max(0, targetAmount - cumDonation);
    const givingRate = cumIncome > 0 ? cumDonation / cumIncome : 0;
    goalIndicator.className = `goal-indicator ${givingRate >= ratio ? "on-track" : "off-track"}`;
    goalIndicator.innerHTML = `<div>Cumulative giving rate: ${percent(givingRate)} (${currency(cumDonation)} of ${currency(cumIncome)} income).</div><div>Goal: ${goalPercent.toFixed(1)}% (${currency(targetAmount)} target). Needed: ${currency(needed)}.</div>`;

    destroy(goalProgressChart);
    goalProgressChart = new Chart(document.getElementById("goal-progress-chart").getContext("2d"), {
      type: "line",
      data: { labels: records.map((r) => r.year), datasets: [{ label: "Cumulative Income", data: cumIncomeSeries, borderColor: "#3956f6" }, { label: "Cumulative Donations", data: cumDonationSeries, borderColor: "#00a76f" }, { label: `${goalPercent.toFixed(1)}% Target`, data: targetSeries, borderColor: "#f08c00", borderDash: [6, 6], pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v) => formatCompactCurrency(v) } } } },
    });
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const year = Number(yearInput.value);
    const income = Number(incomeInput.value);
    const donation = Number(donationInput.value);
    const nw = netWorthInput.value.trim();
    const netWorth = nw === "" ? null : Number(nw);
    if (!year || year < 1970 || income < 0 || donation < 0 || (netWorth !== null && Number.isNaN(netWorth))) {
      return setText(formMessage, "Please enter valid values.");
    }
    const response = await apiFetch("/api/records", { method: "POST", body: JSON.stringify({ year, income, donation, netWorth }) });
    const payload = await response.json();
    if (!response.ok) return setText(formMessage, payload.error || "Unable to save record.");
    setText(formMessage, "Saved.");
    form.reset();
    await loadRecords();
    renderCharts();
    await renderInvestmentsSummary();
    await renderLiabilitiesSummary();
    await renderAssetsSummary();
  });


  return { render: async () => { renderCharts(); await renderInvestmentsSummary(); await renderLiabilitiesSummary(); await renderAssetsSummary(); } };
}

function initRecordsPage() {
  const tbody = document.getElementById("records-body");
  const clearBtn = document.getElementById("clear-data");
  const form = document.getElementById("edit-form");
  const msg = document.getElementById("records-message");
  const editorCard = document.getElementById("record-editor-card");
  const yearInput = document.getElementById("edit-year");
  const incomeInput = document.getElementById("edit-income");
  const donationInput = document.getElementById("edit-donation");
  const netWorthInput = document.getElementById("edit-netWorth");

  function renderTable() {
    tbody.innerHTML = "";
    if (!records.length) {
      tbody.innerHTML = `<tr><td colspan="5">No annual records yet.</td></tr>`;
      return;
    }
    for (const r of records) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.year}</td><td>${currency(r.income)}</td><td>${currency(r.donation)}</td><td>${r.netWorth == null ? "—" : currency(r.netWorth)}</td><td><button class="edit-btn" data-year="${r.year}" type="button">Edit</button><button class="delete-btn" data-year="${r.year}" type="button">Delete</button></td>`;
      tbody.appendChild(tr);
    }
  }

  tbody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const year = Number(target.dataset.year);
    if (target.classList.contains("edit-btn")) {
      const rec = records.find((x) => x.year === year);
      if (!rec) return;
      editingYear = year;
      yearInput.value = rec.year;
      incomeInput.value = rec.income;
      donationInput.value = rec.donation;
      netWorthInput.value = rec.netWorth ?? "";
      editorCard?.scrollIntoView({ behavior: "smooth", block: "start" });
      yearInput.focus();
      return setText(msg, `Editing ${year}.`);
    }
    if (target.classList.contains("delete-btn")) {
      if (!window.confirm(`Delete record for ${year}?`)) return;
      await apiFetch(`/api/records/${year}`, { method: "DELETE" });
      await loadRecords();
      renderTable();
      setText(msg, `Deleted ${year}.`);
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const year = Number(yearInput.value);
    const income = Number(incomeInput.value);
    const donation = Number(donationInput.value);
    const nw = netWorthInput.value.trim();
    const netWorth = nw === "" ? null : Number(nw);
    await apiFetch("/api/records", { method: "POST", body: JSON.stringify({ year, income, donation, netWorth }) });
    if (editingYear !== null && editingYear !== year) await apiFetch(`/api/records/${editingYear}`, { method: "DELETE" });
    editingYear = null;
    form.reset();
    await loadRecords();
    renderTable();
    setText(msg, "Record updated.");
  });

  clearBtn?.addEventListener("click", async () => {
    if (!window.confirm("Clear all records? This cannot be undone.")) return;
    await apiFetch("/api/records", { method: "DELETE" });
    await loadRecords();
    renderTable();
    setText(msg, "All records cleared.");
  });

  return { render: renderTable };
}

function initInvestmentsPage() {
  const form = document.getElementById("investment-form");
  const msg = document.getElementById("investments-message");
  const tableBody = document.getElementById("investments-body");
  const refreshBtn = document.getElementById("refresh-prices-btn");
  const sortHeaders = document.querySelectorAll("[data-sort-investments]");
  const submitBtn = document.getElementById("stocks-submit-btn");
  const lastRefreshedEl = document.getElementById("last-refreshed");

  let investments = [];
  let sortKey = "purchase_date";
  let sortDirection = "desc";
  let editingId = null;

  async function loadInvestments() {
    const response = await apiFetch("/api/investments");
    if (!response.ok) return;
    investments = await response.json();
  }

  function applySort() {
    const direction = sortDirection === "asc" ? 1 : -1;
    investments.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return (aNum - bNum) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }

  function startEdit(item) {
    editingId = item.id;
    document.getElementById("inv-ticker").value = item.ticker;
    document.getElementById("inv-broker").value = item.broker || "";
    document.getElementById("inv-company-name").value = item.company_name || "";
    document.getElementById("inv-current-price").value = item.current_price ?? "";
    document.getElementById("inv-manual-quote").checked = Boolean(item.manual_quote);
    document.getElementById("inv-shares").value = item.shares;
    document.getElementById("inv-price").value = item.purchase_price;
    document.getElementById("inv-date").value = item.purchase_date;
    if (submitBtn) submitBtn.textContent = "Update Stock";
    setText(msg, `Editing ${item.ticker}.`);
  }

  function resetEditState() {
    editingId = null;
    if (submitBtn) submitBtn.textContent = "Add Stock";
  }

  async function renderTable() {
    applySort();
    tableBody.innerHTML = "";
    if (!investments.length) {
      tableBody.innerHTML = `<tr><td colspan="12">No stocks yet.</td></tr>`;
      return;
    }

    let totalPurchaseValue = 0;
    let totalCurrentValue = 0;
    let valuedPositions = 0;

    for (const inv of investments) {
      const purchaseValue = Number(inv.shares) * Number(inv.purchase_price);
      const currentPrice = inv.current_price == null ? null : Number(inv.current_price);
      const currentValue = currentPrice == null ? null : Number(inv.shares) * currentPrice;
      const companyName = inv.company_name || "—";
      const currentPriceText = currentPrice == null ? "N/A" : currency(currentPrice);

      let gainLossCell = '<span>—</span>';
      let gainLossPctCell = '<span>—</span>';
      if (currentValue !== null) {
        totalPurchaseValue += purchaseValue;
        totalCurrentValue += currentValue;
        valuedPositions += 1;
        const gainLoss = currentValue - purchaseValue;
        const gainLossPct = purchaseValue > 0 ? (gainLoss / purchaseValue) * 100 : 0;
        const cls = gainLoss >= 0 ? "gain-positive" : "gain-negative";
        gainLossCell = `<span class="${cls}">${gainLoss >= 0 ? "+" : ""}${currency(gainLoss)}</span>`;
        gainLossPctCell = `<span class="${cls}">${gainLossPct >= 0 ? "+" : ""}${gainLossPct.toFixed(2)}%</span>`;
      }

      const tr = document.createElement("tr");
      const quoteSource = inv.manual_quote ? "Manual" : "Market";
      tr.innerHTML = `<td>${inv.ticker}</td><td>${inv.broker || "—"}</td><td>${companyName}</td><td>${inv.purchase_date}</td><td>${inv.shares}</td><td>${currency(inv.purchase_price)}</td><td>${currency(purchaseValue)}</td><td>${currentPriceText}</td><td>${quoteSource}</td><td>${gainLossCell}</td><td>${gainLossPctCell}</td><td><button class="edit-btn" data-id="${inv.id}" type="button">Edit</button><button class="delete-btn" data-id="${inv.id}" type="button">Delete</button></td>`;
      tableBody.appendChild(tr);
    }

    const totalGainLoss = totalCurrentValue - totalPurchaseValue;
    const hasValuedData = valuedPositions > 0;
    const totalCurrentText = hasValuedData ? currency(totalCurrentValue) : "N/A";
    const totalGainLossText = hasValuedData ? `${totalGainLoss >= 0 ? "+" : ""}${currency(totalGainLoss)}` : "N/A";
    const totalGainLossPct = hasValuedData && totalPurchaseValue > 0 ? (totalGainLoss / totalPurchaseValue) * 100 : null;
    const totalGainLossPctText = totalGainLossPct == null ? "N/A" : `${totalGainLossPct >= 0 ? "+" : ""}${totalGainLossPct.toFixed(2)}%`;
    const totalGainLossClass = !hasValuedData ? "" : (totalGainLoss >= 0 ? "gain-positive" : "gain-negative");
    const totalRow = document.createElement("tr");
    totalRow.className = "totals-row";
    totalRow.innerHTML = `<td colspan="6"><strong>Totals (priced holdings)</strong></td><td><strong>${hasValuedData ? currency(totalPurchaseValue) : "N/A"}</strong></td><td><strong>${totalCurrentText}</strong></td><td></td><td><strong class="${totalGainLossClass}">${totalGainLossText}</strong></td><td><strong class="${totalGainLossClass}">${totalGainLossPctText}</strong></td><td></td>`;
    tableBody.appendChild(totalRow);

    if (lastRefreshedEl) {
      const latest = investments
        .map((x) => x.price_refreshed_at)
        .filter(Boolean)
        .sort()
        .slice(-1)[0];
      lastRefreshedEl.textContent = `Last refreshed: ${latest ? new Date(latest).toLocaleString() : "Never"}`;
    }
  }

  sortHeaders.forEach((header) => {
    header.addEventListener("click", async () => {
      const key = header.dataset.sortInvestments;
      if (!key) return;
      sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
      sortKey = key;
      await renderTable();
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      id: editingId,
      ticker: document.getElementById("inv-ticker").value.trim().toUpperCase(),
      broker: document.getElementById("inv-broker").value.trim(),
      companyName: document.getElementById("inv-company-name").value.trim(),
      currentPrice: document.getElementById("inv-current-price").value,
      manualQuote: document.getElementById("inv-manual-quote").checked,
      shares: Number(document.getElementById("inv-shares").value),
      purchasePrice: Number(document.getElementById("inv-price").value),
      purchaseDate: document.getElementById("inv-date").value,
    };
    const response = await apiFetch("/api/investments", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save stock.");
    form.reset();
    resetEditState();
    await loadInvestments();
    await renderTable();
    setText(msg, "Stock saved.");
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const item = investments.find((x) => x.id === id);
      if (item) startEdit(item);
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm("Delete this stock entry?")) return;
    await apiFetch(`/api/investments/${id}`, { method: "DELETE" });
    if (editingId === id) {
      form?.reset();
      resetEditState();
    }
    await loadInvestments();
    await renderTable();
  });

  refreshBtn?.addEventListener("click", async () => {
    const response = await apiFetch("/api/investments/refresh", { method: "POST", body: JSON.stringify({}) });
    const payload = await response.json();
    await loadInvestments();
    await renderTable();
    if (!response.ok) {
      setText(msg, payload.error || "Unable to refresh prices.");
      return;
    }
    if (lastRefreshedEl && payload.refreshedAt) {
      lastRefreshedEl.textContent = `Last refreshed: ${new Date(payload.refreshedAt).toLocaleString()}`;
    }
    setText(msg, `Prices refreshed (${payload.updated} updated${payload.failed ? `, ${payload.failed} failed` : ""}).`);
  });

  return {
    render: async () => {
      await loadInvestments();
      await renderTable();
    },
  };
}

function initPreciousMetalsPage() {
  const form = document.getElementById("metals-form");
  const msg = document.getElementById("metals-message");
  const tableBody = document.getElementById("metals-body");
  const sortHeaders = document.querySelectorAll("[data-sort-metals]");
  const submitBtn = document.getElementById("metals-submit-btn");

  let metals = [];
  let sortKey = "purchase_date";
  let sortDirection = "desc";
  let editingId = null;

  async function loadMetals() {
    const response = await apiFetch("/api/precious-metals");
    if (!response.ok) return;
    metals = await response.json();
  }

  function applySort() {
    const direction = sortDirection === "asc" ? 1 : -1;
    metals.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return (aNum - bNum) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }

  function startEdit(item) {
    editingId = item.id;
    document.getElementById("metal-type").value = item.metal_type;
    document.getElementById("metal-description").value = item.description;
    document.getElementById("metal-quantity").value = item.quantity;
    document.getElementById("metal-weight").value = item.weight;
    document.getElementById("metal-date").value = item.purchase_date;
    document.getElementById("metal-where").value = item.where_purchased;
    document.getElementById("metal-purchase-price").value = item.purchase_price;
    document.getElementById("metal-current-value").value = item.current_value;
    if (submitBtn) submitBtn.textContent = "Update Item";
    setText(msg, `Editing ${item.description}.`);
  }

  function resetEditState() {
    editingId = null;
    if (submitBtn) submitBtn.textContent = "Add Item";
  }

  function renderTable() {
    applySort();
    tableBody.innerHTML = "";
    if (!metals.length) {
      tableBody.innerHTML = `<tr><td colspan="11">No precious metals yet.</td></tr>`;
      return;
    }

    let totalPurchase = 0;
    let totalCurrent = 0;

    for (const item of metals) {
      totalPurchase += Number(item.purchase_price);
      totalCurrent += Number(item.current_value);
      const gainLoss = Number(item.current_value) - Number(item.purchase_price);
      const gainLossPct = Number(item.purchase_price) > 0 ? (gainLoss / Number(item.purchase_price)) * 100 : 0;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${item.metal_type}</td><td>${item.description}</td><td>${item.quantity}</td><td>${item.weight}</td><td>${item.purchase_date}</td><td>${item.where_purchased}</td><td>${currency(item.purchase_price)}</td><td>${currency(item.current_value)}</td><td>${gainLoss >= 0 ? `<span class="gain-positive">+${currency(gainLoss)}</span>` : `<span class="gain-negative">${currency(gainLoss)}</span>`}</td><td>${gainLossPct >= 0 ? `<span class="gain-positive">+${gainLossPct.toFixed(2)}%</span>` : `<span class="gain-negative">${gainLossPct.toFixed(2)}%</span>`}</td><td><button class="edit-btn" data-id="${item.id}" type="button">Edit</button><button class="delete-btn" data-id="${item.id}" type="button">Delete</button></td>`;
      tableBody.appendChild(tr);
    }

    const totalGainLoss = totalCurrent - totalPurchase;
    const totalGainLossPct = totalPurchase > 0 ? (totalGainLoss / totalPurchase) * 100 : 0;
    const totalRow = document.createElement("tr");
    totalRow.className = "totals-row";
    totalRow.innerHTML = `<td colspan="6"><strong>Totals</strong></td><td><strong>${currency(totalPurchase)}</strong></td><td><strong>${currency(totalCurrent)}</strong></td><td><strong>${totalGainLoss >= 0 ? `<span class="gain-positive">+${currency(totalGainLoss)}</span>` : `<span class="gain-negative">${currency(totalGainLoss)}</span>`}</strong></td><td><strong>${totalGainLossPct >= 0 ? `<span class="gain-positive">+${totalGainLossPct.toFixed(2)}%</span>` : `<span class="gain-negative">${totalGainLossPct.toFixed(2)}%</span>`}</strong></td><td></td>`;
    tableBody.appendChild(totalRow);
  }

  sortHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sortMetals;
      if (!key) return;
      sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
      sortKey = key;
      renderTable();
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      id: editingId,
      type: document.getElementById("metal-type").value.trim(),
      description: document.getElementById("metal-description").value.trim(),
      quantity: Number(document.getElementById("metal-quantity").value),
      weight: Number(document.getElementById("metal-weight").value),
      datePurchased: document.getElementById("metal-date").value,
      wherePurchased: document.getElementById("metal-where").value.trim(),
      purchasePrice: Number(document.getElementById("metal-purchase-price").value),
      currentValue: Number(document.getElementById("metal-current-value").value),
    };
    const response = await apiFetch("/api/precious-metals", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save precious metal record.");
    form.reset();
    resetEditState();
    await loadMetals();
    renderTable();
    setText(msg, "Precious metal record saved.");
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const item = metals.find((x) => x.id === id);
      if (item) startEdit(item);
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm("Delete this precious metals entry?")) return;
    await apiFetch(`/api/precious-metals/${id}`, { method: "DELETE" });
    if (editingId === id) {
      form?.reset();
      resetEditState();
    }
    await loadMetals();
    renderTable();
  });

  return {
    render: async () => {
      await loadMetals();
      renderTable();
    },
  };
}

function initRealEstatePage() {
  const form = document.getElementById("real-estate-form");
  const msg = document.getElementById("real-estate-message");
  const tableBody = document.getElementById("real-estate-body");
  const sortHeaders = document.querySelectorAll("[data-sort-real-estate]");
  const submitBtn = document.getElementById("real-estate-submit-btn");
  let rows = [];
  let sortKey = "description";
  let sortDirection = "asc";
  let editingId = null;

  async function loadRows() {
    const response = await apiFetch("/api/real-estate");
    if (!response.ok) return;
    rows = await response.json();
  }

  function applySort() {
    const direction = sortDirection === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return (aNum - bNum) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }

  function mapsLink(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  function startEdit(item) {
    editingId = item.id;
    document.getElementById("re-address").value = item.address;
    document.getElementById("re-description").value = item.description || "";
    document.getElementById("re-owned").value = item.percentage_owned;
    document.getElementById("re-purchase-price").value = item.purchase_price;
    document.getElementById("re-current-value").value = item.current_value;
    if (submitBtn) submitBtn.textContent = "Update Real Estate";
    setText(msg, `Editing ${item.description || item.address}.`);
  }

  function resetEditState() {
    editingId = null;
    if (submitBtn) submitBtn.textContent = "Add Real Estate";
  }

  function renderTable() {
    applySort();
    tableBody.innerHTML = "";
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="7">No real estate records yet.</td></tr>`;
      return;
    }
    for (const item of rows) {
      const myValue = Number(item.current_value) * (Number(item.percentage_owned) / 100);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${item.description || "—"}</td><td><a href="${mapsLink(item.address)}" target="_blank" rel="noopener noreferrer">${item.address}</a></td><td>${item.percentage_owned}%</td><td>${currency(item.purchase_price)}</td><td>${currency(item.current_value)}</td><td>${myValue >= 0 ? `<span class="gain-positive">${currency(myValue)}</span>` : `<span class="gain-negative">${currency(myValue)}</span>`}</td><td><button class="edit-btn" data-id="${item.id}" type="button">Edit</button><button class="delete-btn" data-id="${item.id}" type="button">Delete</button></td>`;
      tableBody.appendChild(tr);
    }
  }

  sortHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sortRealEstate;
      if (!key) return;
      sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
      sortKey = key;
      renderTable();
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      id: editingId,
      address: document.getElementById("re-address").value.trim(),
      description: document.getElementById("re-description").value.trim(),
      percentageOwned: Number(document.getElementById("re-owned").value),
      purchasePrice: Number(document.getElementById("re-purchase-price").value),
      currentValue: Number(document.getElementById("re-current-value").value),
    };
    const response = await apiFetch("/api/real-estate", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save real estate record.");
    form.reset();
    resetEditState();
    await loadRows();
    renderTable();
    setText(msg, "Real estate record saved.");
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const item = rows.find((x) => x.id === id);
      if (item) startEdit(item);
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm("Delete this real estate entry?")) return;
    await apiFetch(`/api/real-estate/${id}`, { method: "DELETE" });
    if (editingId === id) {
      form?.reset();
      resetEditState();
    }
    await loadRows();
    renderTable();
  });

  return { render: async () => { await loadRows(); renderTable(); } };
}

function initBusinessVenturesPage() {
  const form = document.getElementById("business-ventures-form");
  const msg = document.getElementById("business-ventures-message");
  const tableBody = document.getElementById("business-ventures-body");
  const sortHeaders = document.querySelectorAll("[data-sort-business]");
  const submitBtn = document.getElementById("business-ventures-submit-btn");
  let rows = [];
  let sortKey = "business_name";
  let sortDirection = "asc";
  let editingId = null;

  async function loadRows() {
    const response = await apiFetch("/api/business-ventures");
    if (!response.ok) return;
    rows = await response.json();
  }

  function applySort() {
    const direction = sortDirection === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return (aNum - bNum) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }

  function startEdit(item) {
    editingId = item.id;
    document.getElementById("bv-name").value = item.business_name;
    document.getElementById("bv-owned").value = item.percentage_owned;
    document.getElementById("bv-value").value = item.business_value;
    if (submitBtn) submitBtn.textContent = "Update Business Venture";
    setText(msg, `Editing ${item.business_name}.`);
  }

  function resetEditState() {
    editingId = null;
    if (submitBtn) submitBtn.textContent = "Add Business Venture";
  }

  function renderTable() {
    applySort();
    tableBody.innerHTML = "";
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="5">No business ventures yet.</td></tr>`;
      return;
    }
    for (const item of rows) {
      const myValue = Number(item.business_value) * (Number(item.percentage_owned) / 100);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${item.business_name}</td><td>${item.percentage_owned}%</td><td>${currency(item.business_value)}</td><td>${myValue >= 0 ? `<span class="gain-positive">${currency(myValue)}</span>` : `<span class="gain-negative">${currency(myValue)}</span>`}</td><td><button class="edit-btn" data-id="${item.id}" type="button">Edit</button><button class="delete-btn" data-id="${item.id}" type="button">Delete</button></td>`;
      tableBody.appendChild(tr);
    }
  }

  sortHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sortBusiness;
      if (!key) return;
      sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
      sortKey = key;
      renderTable();
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      id: editingId,
      businessName: document.getElementById("bv-name").value.trim(),
      percentageOwned: Number(document.getElementById("bv-owned").value),
      businessValue: Number(document.getElementById("bv-value").value),
    };
    const response = await apiFetch("/api/business-ventures", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save business venture.");
    form.reset();
    resetEditState();
    await loadRows();
    renderTable();
    setText(msg, "Business venture saved.");
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const item = rows.find((x) => x.id === id);
      if (item) startEdit(item);
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm("Delete this business venture entry?")) return;
    await apiFetch(`/api/business-ventures/${id}`, { method: "DELETE" });
    if (editingId === id) {
      form?.reset();
      resetEditState();
    }
    await loadRows();
    renderTable();
  });

  return { render: async () => { await loadRows(); renderTable(); } };
}

function initRetirementAccountsPage() {
  const form = document.getElementById("retirement-form");
  const msg = document.getElementById("retirement-message");
  const tableBody = document.getElementById("retirement-body");
  const sortHeaders = document.querySelectorAll("[data-sort-retirement]");
  const submitBtn = document.getElementById("retirement-submit-btn");
  let rows = [];
  let sortKey = "description";
  let sortDirection = "asc";
  let editingId = null;

  async function loadRows() {
    const response = await apiFetch("/api/retirement-accounts");
    if (!response.ok) return;
    rows = await response.json();
  }

  function applySort() {
    const direction = sortDirection === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return (aNum - bNum) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }

  function startEdit(item) {
    editingId = item.id;
    document.getElementById("ret-description").value = item.description;
    document.getElementById("ret-type").value = item.account_type;
    document.getElementById("ret-broker").value = item.broker;
    document.getElementById("ret-taxable").value = Number(item.taxable) === 1 ? "yes" : "no";
    document.getElementById("ret-value").value = item.value;
    if (submitBtn) submitBtn.textContent = "Update Retirement Account";
    setText(msg, `Editing ${item.description}.`);
  }

  function resetEditState() {
    editingId = null;
    if (submitBtn) submitBtn.textContent = "Add Retirement Account";
  }

  function renderTable() {
    applySort();
    tableBody.innerHTML = "";
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="6">No retirement accounts yet.</td></tr>`;
      return;
    }
    let totalValue = 0;
    for (const item of rows) {
      totalValue += Number(item.value);
      const taxableLabel = Number(item.taxable) === 1 ? "Yes" : "No";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${item.description}</td><td>${item.account_type}</td><td>${item.broker}</td><td>${taxableLabel}</td><td>${currency(item.value)}</td><td><button class="edit-btn" data-id="${item.id}" type="button">Edit</button><button class="delete-btn" data-id="${item.id}" type="button">Delete</button></td>`;
      tableBody.appendChild(tr);
    }
    const totalRow = document.createElement("tr");
    totalRow.className = "totals-row";
    totalRow.innerHTML = `<td colspan="4"><strong>Totals</strong></td><td><strong>${currency(totalValue)}</strong></td><td></td>`;
    tableBody.appendChild(totalRow);
  }

  sortHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sortRetirement;
      if (!key) return;
      sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
      sortKey = key;
      renderTable();
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      id: editingId,
      description: document.getElementById("ret-description").value.trim(),
      type: document.getElementById("ret-type").value.trim(),
      broker: document.getElementById("ret-broker").value.trim(),
      taxable: document.getElementById("ret-taxable").value,
      value: Number(document.getElementById("ret-value").value),
    };
    const response = await apiFetch("/api/retirement-accounts", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save retirement account.");
    form.reset();
    resetEditState();
    await loadRows();
    renderTable();
    setText(msg, "Retirement account saved.");
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const item = rows.find((x) => x.id === id);
      if (item) startEdit(item);
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm("Delete this retirement account entry?")) return;
    await apiFetch(`/api/retirement-accounts/${id}`, { method: "DELETE" });
    if (editingId === id) {
      form?.reset();
      resetEditState();
    }
    await loadRows();
    renderTable();
  });

  return { render: async () => { await loadRows(); renderTable(); } };
}

function initNetWorthReportPage() {
  const content = document.getElementById("networth-report-content");
  const generated = document.getElementById("networth-report-generated");
  const titleEl = document.getElementById("networth-report-title");
  const dateEl = document.getElementById("networth-report-date");
  const totalEl = document.getElementById("networth-grand-total");
  const printBtn = document.getElementById("print-networth-btn");
  const condensedToggle = document.getElementById("networth-condensed");

  function fmtValue(value) {
    return value == null ? "N/A" : currency(value);
  }

  function renderCategory(title, items, condensed = false, group = "assets") {
    const section = document.createElement("section");
    section.className = `report-section report-${group}${condensed ? " condensed" : ""}`;
    if (!condensed) {
      const heading = document.createElement("h3");
      heading.textContent = title;
      section.appendChild(heading);
    }

    const table = document.createElement("table");
    table.className = "report-table";
    const tbody = document.createElement("tbody");

    let total = 0;
    if (!condensed) {
      for (const item of items) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="report-col-label">${item.description}</td><td class="report-col-value">${fmtValue(item.value)}</td>`;
        tbody.appendChild(tr);
        if (item.value != null) total += Number(item.value);
      }
    } else {
      for (const item of items) {
        if (item.value != null) total += Number(item.value);
      }
    }

    const totalRow = document.createElement("tr");
    totalRow.className = "totals-row";
    totalRow.innerHTML = condensed
      ? `<td class="report-col-label">${title}</td><td class="report-col-value">${currency(total)}</td>`
      : `<td class="report-col-label"><strong>${title} Total</strong></td><td class="report-col-value"><strong>${currency(total)}</strong></td>`;
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    section.appendChild(table);

    return { section, total };
  }

  function appendSubtotalRow(label, value) {
    const section = document.createElement("section");
    section.className = "report-section report-subtotal-section";
    const table = document.createElement("table");
    table.className = "report-table";
    const tbody = document.createElement("tbody");
    const tr = document.createElement("tr");
    tr.className = "totals-row";
    tr.innerHTML = `<td class="report-col-label"><strong>${label}</strong></td><td class="report-col-value"><strong>${currency(value)}</strong></td>`;
    tbody.appendChild(tr);
    table.appendChild(tbody);
    section.appendChild(table);
    content.appendChild(section);
  }

  async function renderReport() {
    const condensed = Boolean(condensedToggle?.checked);
    const [stocksRes, metalsRes, realEstateRes, businessRes, retirementRes, vehiclesRes, gunsRes, bankRes, cashRes, mortgagesRes, cardsRes, loansRes] = await Promise.all([
      apiFetch("/api/investments"),
      apiFetch("/api/precious-metals"),
      apiFetch("/api/real-estate"),
      apiFetch("/api/business-ventures"),
      apiFetch("/api/retirement-accounts"),
      apiFetch("/api/assets/vehicles"),
      apiFetch("/api/assets/guns"),
      apiFetch("/api/assets/bank-accounts"),
      apiFetch("/api/assets/cash"),
      apiFetch("/api/liabilities/mortgages"),
      apiFetch("/api/liabilities/credit-cards"),
      apiFetch("/api/liabilities/loans"),
    ]);
    if (![stocksRes, metalsRes, realEstateRes, businessRes, retirementRes, vehiclesRes, gunsRes, bankRes, cashRes, mortgagesRes, cardsRes, loansRes].every((r) => r.ok)) return;

    const stocks = await stocksRes.json();
    const metals = await metalsRes.json();
    const realEstate = await realEstateRes.json();
    const business = await businessRes.json();
    const retirement = await retirementRes.json();
    const vehicles = await vehiclesRes.json();
    const guns = await gunsRes.json();
    const bankAccounts = await bankRes.json();
    const cash = await cashRes.json();
    const mortgages = await mortgagesRes.json();
    const creditCards = await cardsRes.json();
    const loans = await loansRes.json();

    const categories = [
      {
        title: "Stocks",
        items: stocks.map((x) => ({ description: `${x.ticker}${x.company_name ? ` — ${x.company_name}` : ""}`, value: x.current_price == null ? null : Number(x.shares) * Number(x.current_price) })),
      },
      { title: "Precious Metals", items: metals.map((x) => ({ description: `${x.metal_type} — ${x.description}`, value: Number(x.current_value) })) },
      { title: "Real Estate", items: realEstate.map((x) => ({ description: `${x.description || x.address} (${x.address})${Number(x.percentage_owned) < 100 ? ` (${Number(x.percentage_owned).toFixed(0)}% owned)` : ""}`, value: Number(x.current_value) * (Number(x.percentage_owned) / 100) })) },
      { title: "Business Ventures", items: business.map((x) => ({ description: x.business_name, value: Number(x.business_value) * (Number(x.percentage_owned) / 100) })) },
      { title: "Retirement Accounts", items: retirement.map((x) => ({ description: `${x.description} — ${x.account_type} (${x.broker})`, value: Number(x.value) })) },
      { title: "Vehicles", items: vehicles.map((x) => ({ description: `${x.description} — ${x.model_year || ""} ${x.make} ${x.model}`.trim(), value: Number(x.value) })) },
      { title: "Guns", items: guns.map((x) => ({ description: `${x.description} — ${x.gun_type}`, value: Number(x.value) })) },
      { title: "Bank Accounts", items: bankAccounts.map((x) => ({ description: `${x.description} — ${x.institution} (${x.account_type})`, value: Number(x.balance) })) },
      { title: "Cash", items: cash.map((x) => ({ description: x.description, value: Number(x.amount) })) },
    ];

    const liabilityCategories = [
      { title: "Mortgages", items: mortgages.map((x) => {
        const ownedPct = x.real_estate_percentage_owned == null ? null : Number(x.real_estate_percentage_owned);
        const effectivePct = ownedPct == null || Number.isNaN(ownedPct) ? 100 : ownedPct;
        const scaledValue = Number(x.current_balance) * (effectivePct / 100);
        const ownershipNote = x.real_estate_percentage_owned == null ? "" : ` (${effectivePct.toFixed(0)}% owned)`;
        return {
          description: `${x.description}${x.real_estate_address ? ` (${x.real_estate_address})` : ""}${ownershipNote}`,
          value: scaledValue,
        };
      }) },
      { title: "Credit Cards", items: creditCards.map((x) => ({ description: x.description, value: Number(x.current_balance) })) },
      { title: "Loans", items: loans.map((x) => ({ description: `${x.description} — ${x.loan_type}`, value: Number(x.current_balance) })) },
    ];

    content.innerHTML = "";
    let assetTotal = 0;
    for (const category of categories) {
      const { section, total } = renderCategory(category.title, category.items, condensed, "assets");
      content.appendChild(section);
      assetTotal += total;
    }
    appendSubtotalRow("Assets & Investments Subtotal", assetTotal);

    const liabilitiesHeader = document.createElement("h3");
    liabilitiesHeader.textContent = "Liabilities";
    liabilitiesHeader.className = "report-liabilities-heading";
    content.appendChild(liabilitiesHeader);

    let liabilitiesTotal = 0;
    for (const category of liabilityCategories) {
      const { section, total } = renderCategory(category.title, category.items, condensed, "liabilities");
      content.appendChild(section);
      liabilitiesTotal += total;
    }
    appendSubtotalRow("Liabilities Subtotal", liabilitiesTotal);

    const netWorth = assetTotal - liabilitiesTotal;
    if (titleEl) titleEl.textContent = `Net Worth Statement for ${currentUser?.fullName || currentUser?.username || "User"}`;
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString();
    totalEl.textContent = `Total Net Worth: ${currency(netWorth)} (Assets/Investments: ${currency(assetTotal)} − Liabilities: ${currency(liabilitiesTotal)})`;
    generated.textContent = `Generated on ${new Date().toLocaleString()}`;
  }

  printBtn?.addEventListener("click", () => window.print());
  condensedToggle?.addEventListener("change", renderReport);

  return { render: renderReport };
}

function initProfilePage() {
  const form = document.getElementById("profile-form");
  const msg = document.getElementById("profile-message");
  const fullNameInput = document.getElementById("profile-full-name");
  const usernameInput = document.getElementById("profile-username");
  const emailInput = document.getElementById("profile-email");
  const phoneInput = document.getElementById("profile-phone");

  const streetAddressInput = document.getElementById("profile-street-address");
  const cityInput = document.getElementById("profile-city");
  const stateInput = document.getElementById("profile-state");
  const zipInput = document.getElementById("profile-zip");
  const currentPasswordInput = document.getElementById("profile-current-password");
  const newPasswordInput = document.getElementById("profile-new-password");
  const settingsForm = document.getElementById("profile-settings-form");
  const settingsMsg = document.getElementById("profile-settings-message");
  const givingGoalInput = document.getElementById("profile-giving-goal-percent");
  const darkModeInput = document.getElementById("profile-dark-mode");
  const notifCreditCardPromoInput = document.getElementById("notif-credit-card-promo");
  const notifVehicleInspectionInput = document.getElementById("notif-vehicle-inspection");
  const notifSystemInput = document.getElementById("notif-system");

  async function render() {
    if (!currentUser) return;
    fullNameInput.value = currentUser.fullName || "";
    usernameInput.value = currentUser.username || "";
    emailInput.value = currentUser.email || "";
    phoneInput.value = currentUser.phone || "";
    if (streetAddressInput) streetAddressInput.value = currentUser.streetAddress || "";
    if (cityInput) cityInput.value = currentUser.city || "";
    if (stateInput) stateInput.value = currentUser.state || "";
    if (zipInput) zipInput.value = currentUser.zip || "";
    if (givingGoalInput) givingGoalInput.value = String(getGoalPercent());
    if (darkModeInput) darkModeInput.checked = Boolean(currentUser.darkMode);
    if (notifCreditCardPromoInput) notifCreditCardPromoInput.checked = currentUser?.notificationSettings?.creditCardPromo ?? true;
    if (notifVehicleInspectionInput) notifVehicleInspectionInput.checked = currentUser?.notificationSettings?.vehicleInspection ?? true;
    if (notifSystemInput) notifSystemInput.checked = currentUser?.notificationSettings?.system ?? true;
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      fullName: fullNameInput.value.trim(),
      email: emailInput.value.trim(),
      phone: phoneInput.value.trim(),
      streetAddress: streetAddressInput?.value.trim() || "",
      city: cityInput?.value.trim() || "",
      state: stateInput?.value.trim() || "",
      zip: zipInput?.value.trim() || "",
      currentPassword: currentPasswordInput?.value || "",
      newPassword: newPasswordInput?.value || "",
    };
    const response = await apiFetch("/api/profile", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save profile.");
    await loadCurrentUser();
    if (currentPasswordInput) currentPasswordInput.value = "";
    if (newPasswordInput) newPasswordInput.value = "";
    setText(msg, "Profile updated.");
  });

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const givingGoalPercent = Number(givingGoalInput?.value || DEFAULT_GOAL_PERCENT);
    const darkMode = Boolean(darkModeInput?.checked);
    const notifications = {
      creditCardPromo: Boolean(notifCreditCardPromoInput?.checked),
      vehicleInspection: Boolean(notifVehicleInspectionInput?.checked),
      system: Boolean(notifSystemInput?.checked),
    };
    const response = await apiFetch("/api/user-settings", { method: "POST", body: JSON.stringify({ givingGoalPercent, darkMode, notifications }) });
    const data = await response.json();
    if (!response.ok) return setText(settingsMsg, data.error || "Unable to save settings.");
    await loadCurrentUser();
    if (givingGoalInput) givingGoalInput.value = String(getGoalPercent());
    if (darkModeInput) darkModeInput.checked = Boolean(currentUser.darkMode);
    if (notifCreditCardPromoInput) notifCreditCardPromoInput.checked = currentUser?.notificationSettings?.creditCardPromo ?? true;
    if (notifVehicleInspectionInput) notifVehicleInspectionInput.checked = currentUser?.notificationSettings?.vehicleInspection ?? true;
    if (notifSystemInput) notifSystemInput.checked = currentUser?.notificationSettings?.system ?? true;
    setText(settingsMsg, "Settings updated.");
  });

  return { render };
}

function initAssetCrudPage(config) {
  const form = document.getElementById(config.formId);
  const msg = document.getElementById(config.messageId);
  const tableBody = document.getElementById(config.bodyId);
  const sortHeaders = document.querySelectorAll(config.sortSelector);
  const submitBtn = document.getElementById(config.submitBtnId);
  let rows = [];
  let sortKey = config.defaultSort;
  let sortDirection = "asc";
  let editingId = null;

  async function loadRows() {
    const response = await apiFetch(config.apiBase);
    if (!response.ok) return;
    rows = await response.json();
  }

  function applySort() {
    const direction = sortDirection === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return (aNum - bNum) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }

  function resetEdit() { editingId = null; if (submitBtn) submitBtn.textContent = config.addLabel; }

  function renderTable() {
    applySort();
    tableBody.innerHTML = "";
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="${config.colspan}">${config.emptyText}</td></tr>`;
      return;
    }
    let total = 0;
    for (const row of rows) {
      total += Number(config.valueGetter(row));
      const tr = document.createElement("tr");
      tr.innerHTML = config.rowHtml(row);
      tableBody.appendChild(tr);
    }
    const tr = document.createElement("tr");
    tr.className = "totals-row";
    tr.innerHTML = `<td colspan="${config.totalLabelColspan}"><strong>Totals</strong></td><td><strong>${currency(total)}</strong></td><td></td>`;
    tableBody.appendChild(tr);
  }

  sortHeaders.forEach((header) => header.addEventListener("click", () => {
    const key = header.dataset[config.sortDataset];
    if (!key) return;
    sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
    sortKey = key;
    renderTable();
  }));

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = config.collectPayload(editingId);
    const response = await apiFetch(config.apiBase, { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save record.");
    form.reset();
    resetEdit();
    await loadRows();
    renderTable();
    setText(msg, config.savedText);
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const item = rows.find((x) => x.id === id);
      if (!item) return;
      config.startEdit(item);
      editingId = id;
      if (submitBtn) submitBtn.textContent = config.updateLabel;
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm(config.deleteConfirm)) return;
    await apiFetch(`${config.apiBase}/${id}`, { method: "DELETE" });
    if (editingId === id) { form?.reset(); resetEdit(); }
    await loadRows();
    renderTable();
  });

  return { render: async () => { await loadRows(); renderTable(); } };
}

function initAssetsVehiclesPage() {
  return initAssetCrudPage({
    formId: "vehicles-form", messageId: "vehicles-message", bodyId: "vehicles-body", sortSelector: "[data-sort-vehicles]", submitBtnId: "vehicles-submit-btn",
    defaultSort: "description", sortDataset: "sortVehicles", apiBase: "/api/assets/vehicles", addLabel: "Add Vehicle", updateLabel: "Update Vehicle",
    emptyText: "No vehicles yet.", colspan: 9, totalLabelColspan: 5, savedText: "Vehicle saved.", deleteConfirm: "Delete this vehicle entry?",
    valueGetter: (x) => x.value,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.model_year || "—"}</td><td>${x.make}</td><td>${x.model}</td><td>${currency(x.value)}</td><td>${x.date_purchased || "—"}</td><td>${x.inspection_expires_on || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("veh-description").value.trim(), year: document.getElementById("veh-year").value.trim(), make: document.getElementById("veh-make").value.trim(), model: document.getElementById("veh-model").value.trim(), datePurchased: document.getElementById("veh-date-purchased").value, inspectionExpiresOn: document.getElementById("veh-inspection-expires-on").value, value: Number(document.getElementById("veh-value").value) }),
    startEdit: (x) => { document.getElementById("veh-description").value = x.description; document.getElementById("veh-year").value = x.model_year || ""; document.getElementById("veh-make").value = x.make; document.getElementById("veh-model").value = x.model; document.getElementById("veh-date-purchased").value = x.date_purchased || ""; document.getElementById("veh-inspection-expires-on").value = x.inspection_expires_on || ""; document.getElementById("veh-value").value = x.value; },
  });
}

function initAssetsGunsPage() {
  return initAssetCrudPage({
    formId: "guns-form", messageId: "guns-message", bodyId: "guns-body", sortSelector: "[data-sort-guns]", submitBtnId: "guns-submit-btn",
    defaultSort: "description", sortDataset: "sortGuns", apiBase: "/api/assets/guns", addLabel: "Add Gun", updateLabel: "Update Gun",
    emptyText: "No guns yet.", colspan: 9, totalLabelColspan: 7, savedText: "Gun entry saved.", deleteConfirm: "Delete this gun entry?",
    valueGetter: (x) => x.value,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.gun_type}</td><td>${x.manufacturer || "—"}</td><td>${x.model || "—"}</td><td>${x.year_acquired || "—"}</td><td>${x.notes || "—"}</td><td>${currency(x.value)}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("gun-description").value.trim(), type: document.getElementById("gun-type").value, manufacturer: document.getElementById("gun-manufacturer").value.trim(), model: document.getElementById("gun-model").value.trim(), yearAcquired: document.getElementById("gun-year-acquired").value, notes: document.getElementById("gun-notes").value.trim(), value: Number(document.getElementById("gun-value").value) }),
    startEdit: (x) => { document.getElementById("gun-description").value = x.description; document.getElementById("gun-type").value = x.gun_type; document.getElementById("gun-manufacturer").value = x.manufacturer || ""; document.getElementById("gun-model").value = x.model || ""; document.getElementById("gun-year-acquired").value = x.year_acquired || ""; document.getElementById("gun-notes").value = x.notes || ""; document.getElementById("gun-value").value = x.value; },
  });
}

function initAssetsBankAccountsPage() {

  return initAssetCrudPage({
    formId: "bank-form", messageId: "bank-message", bodyId: "bank-body", sortSelector: "[data-sort-bank]", submitBtnId: "bank-submit-btn",
    defaultSort: "description", sortDataset: "sortBank", apiBase: "/api/assets/bank-accounts", addLabel: "Add Bank Account", updateLabel: "Update Bank Account",
    emptyText: "No bank accounts yet.", colspan: 6, totalLabelColspan: 4, savedText: "Bank account saved.", deleteConfirm: "Delete this bank account entry?",
    valueGetter: (x) => x.balance,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.institution}</td><td>${x.account_type}</td><td>${currency(x.balance)}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("bank-description").value.trim(), institution: document.getElementById("bank-institution").value.trim(), type: document.getElementById("bank-type").value.trim(), balance: Number(document.getElementById("bank-balance").value) }),
    startEdit: (x) => { document.getElementById("bank-description").value = x.description; document.getElementById("bank-institution").value = x.institution; document.getElementById("bank-type").value = x.account_type; document.getElementById("bank-balance").value = x.balance; },
  });
}

function initAssetsCashPage() {
  return initAssetCrudPage({
    formId: "cash-form", messageId: "cash-message", bodyId: "cash-body", sortSelector: "[data-sort-cash]", submitBtnId: "cash-submit-btn",
    defaultSort: "description", sortDataset: "sortCash", apiBase: "/api/assets/cash", addLabel: "Add Cash Entry", updateLabel: "Update Cash Entry",
    emptyText: "No cash entries yet.", colspan: 4, totalLabelColspan: 2, savedText: "Cash entry saved.", deleteConfirm: "Delete this cash entry?",
    valueGetter: (x) => x.amount,
    rowHtml: (x) => `<td>${x.description}</td><td>${currency(x.amount)}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("cash-description").value.trim(), amount: Number(document.getElementById("cash-amount").value) }),
    startEdit: (x) => { document.getElementById("cash-description").value = x.description; document.getElementById("cash-amount").value = x.amount; },
  });
}

function initLiabilityCrudPage(config) {
  const form = document.getElementById(config.formId);
  const msg = document.getElementById(config.messageId);
  const tableBody = document.getElementById(config.bodyId);
  const sortHeaders = document.querySelectorAll(config.sortSelector);
  const submitBtn = document.getElementById(config.submitBtnId);
  let rows = [];
  let sortKey = config.defaultSort;
  let sortDirection = "asc";
  let editingId = null;

  async function loadRows() {
    const response = await apiFetch(config.apiBase);
    if (!response.ok) return;
    rows = await response.json();
  }

  function applySort() {
    const direction = sortDirection === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return (aNum - bNum) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }

  function resetEdit() { editingId = null; if (submitBtn) submitBtn.textContent = config.addLabel; }

  function renderTable() {
    applySort();
    tableBody.innerHTML = "";
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="${config.colspan}">${config.emptyText}</td></tr>`;
      return;
    }
    let total = 0;
    for (const row of rows) {
      total += Number(config.balanceGetter(row));
      const tr = document.createElement("tr");
      tr.innerHTML = config.rowHtml(row);
      tableBody.appendChild(tr);
    }
    const t = document.createElement("tr");
    t.className = "totals-row";
    t.innerHTML = `<td colspan="${config.totalLabelColspan}"><strong>Total Current Balance</strong></td><td><strong>${currency(total)}</strong></td><td></td>`;
    tableBody.appendChild(t);
  }

  sortHeaders.forEach((h) => h.addEventListener("click", () => {
    const key = h.dataset[config.sortDataset];
    if (!key) return;
    sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
    sortKey = key;
    renderTable();
  }));

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = config.collectPayload(editingId);
    const response = await apiFetch(config.apiBase, { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save.");
    form.reset();
    resetEdit();
    await loadRows();
    renderTable();
    setText(msg, config.savedText);
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const row = rows.find((x) => x.id === id);
      if (!row) return;
      config.startEdit(row);
      editingId = id;
      if (submitBtn) submitBtn.textContent = config.updateLabel;
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm(config.deleteConfirm)) return;
    await apiFetch(`${config.apiBase}/${id}`, { method: "DELETE" });
    if (editingId === id) { form?.reset(); resetEdit(); }
    await loadRows();
    renderTable();
  });

  return { render: async () => { await config.beforeLoad?.(); await loadRows(); renderTable(); } };
}

function initLiabilitiesMortgagesPage() {
  const realEstateSelect = document.getElementById("mort-real-estate-id");
  async function loadRealEstateOptions() {
    const response = await apiFetch("/api/real-estate");
    if (!response.ok || !realEstateSelect) return;
    const rows = await response.json();
    realEstateSelect.innerHTML = '<option value="">(optional)</option>';
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = String(row.id);
      option.textContent = `${row.description || row.address} (${row.address})`;
      realEstateSelect.appendChild(option);
    }
  }
  return initLiabilityCrudPage({
    formId: "mortgages-form", messageId: "mortgages-message", bodyId: "mortgages-body", sortSelector: "[data-sort-mortgages]", submitBtnId: "mortgages-submit-btn",
    defaultSort: "description", sortDataset: "sortMortgages", apiBase: "/api/liabilities/mortgages", addLabel: "Add Mortgage", updateLabel: "Update Mortgage",
    emptyText: "No mortgages yet.", colspan: 12, totalLabelColspan: 10, savedText: "Mortgage saved.", deleteConfirm: "Delete this mortgage entry?",
    balanceGetter: (x) => x.current_balance,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.real_estate_address || "—"}</td><td>${x.account_number || "—"}</td><td>${x.interest_rate}%</td><td>${x.monthly_payment ? currency(x.monthly_payment) : "—"}</td><td>${x.start_date || "—"}</td><td>${currency(x.initial_amount)}</td><td>${currency(x.current_balance)}</td><td>${x.interest_change_date || "—"}</td><td>${x.end_date || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("mort-description").value.trim(), realEstateId: document.getElementById("mort-real-estate-id").value, accountNumber: document.getElementById("mort-account-number").value.trim(), interestRate: Number(document.getElementById("mort-interest-rate").value), monthlyPayment: Number(document.getElementById("mort-monthly-payment").value || 0), startDate: document.getElementById("mort-start-date").value, initialAmount: Number(document.getElementById("mort-initial-amount").value), currentBalance: Number(document.getElementById("mort-current-balance").value), endDate: document.getElementById("mort-end-date").value, interestChangeDate: document.getElementById("mort-interest-change-date").value }),
    startEdit: (x) => { document.getElementById("mort-description").value = x.description; document.getElementById("mort-real-estate-id").value = x.real_estate_id || ""; document.getElementById("mort-account-number").value = x.account_number || ""; document.getElementById("mort-interest-rate").value = x.interest_rate; document.getElementById("mort-monthly-payment").value = x.monthly_payment || ""; document.getElementById("mort-start-date").value = x.start_date || ""; document.getElementById("mort-initial-amount").value = x.initial_amount; document.getElementById("mort-current-balance").value = x.current_balance; document.getElementById("mort-end-date").value = x.end_date || ""; document.getElementById("mort-interest-change-date").value = x.interest_change_date || ""; },
    beforeLoad: loadRealEstateOptions,
  });
}

function initLiabilitiesCreditCardsPage() {
  return initLiabilityCrudPage({
    formId: "credit-cards-form", messageId: "credit-cards-message", bodyId: "credit-cards-body", sortSelector: "[data-sort-credit-cards]", submitBtnId: "credit-cards-submit-btn",
    defaultSort: "description", sortDataset: "sortCreditCards", apiBase: "/api/liabilities/credit-cards", addLabel: "Add Credit Card", updateLabel: "Update Credit Card",
    emptyText: "No credit cards yet.", colspan: 12, totalLabelColspan: 10, savedText: "Credit card saved.", deleteConfirm: "Delete this credit card entry?",
    balanceGetter: (x) => x.current_balance,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.account_number_last4 ? `•••• ${x.account_number_last4}` : "—"}</td><td>${x.interest_rate}%</td><td>${x.special_interest_rate == null ? "—" : `${x.special_interest_rate}%`}</td><td>${x.special_rate_end_date || "—"}</td><td>${x.monthly_payment ? currency(x.monthly_payment) : "—"}</td><td>${x.start_date || "—"}</td><td>${currency(x.initial_amount)}</td><td>${currency(x.current_balance)}</td><td>${currency(x.credit_limit)}</td><td>${x.end_date || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("cc-description").value.trim(), accountNumberLast4: document.getElementById("cc-account-number-last4").value.trim(), interestRate: Number(document.getElementById("cc-interest-rate").value), specialInterestRate: document.getElementById("cc-special-rate").value.trim(), specialRateEndDate: document.getElementById("cc-special-rate-end").value, monthlyPayment: Number(document.getElementById("cc-monthly-payment").value || 0), startDate: document.getElementById("cc-start-date").value, initialAmount: Number(document.getElementById("cc-initial-amount").value), currentBalance: Number(document.getElementById("cc-current-balance").value), endDate: document.getElementById("cc-end-date").value, creditLimit: Number(document.getElementById("cc-credit-limit").value) }),
    startEdit: (x) => { document.getElementById("cc-description").value = x.description; document.getElementById("cc-account-number-last4").value = x.account_number_last4 || ""; document.getElementById("cc-interest-rate").value = x.interest_rate; document.getElementById("cc-special-rate").value = x.special_interest_rate ?? ""; document.getElementById("cc-special-rate-end").value = x.special_rate_end_date || ""; document.getElementById("cc-monthly-payment").value = x.monthly_payment || ""; document.getElementById("cc-start-date").value = x.start_date || ""; document.getElementById("cc-initial-amount").value = x.initial_amount; document.getElementById("cc-current-balance").value = x.current_balance; document.getElementById("cc-end-date").value = x.end_date || ""; document.getElementById("cc-credit-limit").value = x.credit_limit; },
  });
}

function initLiabilitiesLoansPage() {
  const vehicleSelect = document.getElementById("loan-vehicle-id");
  async function loadVehicleOptions() {
    const response = await apiFetch("/api/assets/vehicles");
    if (!response.ok || !vehicleSelect) return;
    const rows = await response.json();
    vehicleSelect.innerHTML = '<option value="">(optional)</option>';
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = String(row.id);
      option.textContent = `${row.description} (${row.make} ${row.model})`;
      vehicleSelect.appendChild(option);
    }
  }
  return initLiabilityCrudPage({
    formId: "loans-form", messageId: "loans-message", bodyId: "loans-body", sortSelector: "[data-sort-loans]", submitBtnId: "loans-submit-btn",
    defaultSort: "description", sortDataset: "sortLoans", apiBase: "/api/liabilities/loans", addLabel: "Add Loan", updateLabel: "Update Loan",
    emptyText: "No loans yet.", colspan: 15, totalLabelColspan: 13, savedText: "Loan saved.", deleteConfirm: "Delete this loan entry?",
    balanceGetter: (x) => x.current_balance,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.loan_type}</td><td>${x.account_number || "—"}</td><td>${x.is_private ? "Yes" : "No"}</td><td>${x.is_secured ? "Yes" : "No"}</td><td>${x.interest_only ? "Yes" : "No"}</td><td>${x.vehicle_description || "—"}</td><td>${x.interest_rate}%</td><td>${x.payment_amount ? currency(x.payment_amount) : "—"}</td><td>${x.payment_frequency || "monthly"}</td><td>${x.start_date || "—"}</td><td>${currency(x.initial_amount)}</td><td>${currency(x.current_balance)}</td><td>${x.end_date || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("loan-description").value.trim(), loanType: document.getElementById("loan-type").value.trim(), accountNumber: document.getElementById("loan-account-number").value.trim(), isPrivate: document.getElementById("loan-is-private").value, isSecured: document.getElementById("loan-is-secured").value, interestOnly: document.getElementById("loan-interest-only").value, vehicleId: document.getElementById("loan-vehicle-id").value, interestRate: Number(document.getElementById("loan-interest-rate").value), paymentAmount: Number(document.getElementById("loan-payment-amount").value || 0), paymentFrequency: document.getElementById("loan-payment-frequency").value, startDate: document.getElementById("loan-start-date").value, initialAmount: Number(document.getElementById("loan-initial-amount").value), currentBalance: Number(document.getElementById("loan-current-balance").value), endDate: document.getElementById("loan-end-date").value }),
    startEdit: (x) => { document.getElementById("loan-description").value = x.description; document.getElementById("loan-type").value = x.loan_type; document.getElementById("loan-account-number").value = x.account_number || ""; document.getElementById("loan-is-private").value = x.is_private ? "yes" : "no"; document.getElementById("loan-is-secured").value = x.is_secured ? "yes" : "no"; document.getElementById("loan-interest-only").value = x.interest_only ? "yes" : "no"; document.getElementById("loan-vehicle-id").value = x.vehicle_id || ""; document.getElementById("loan-interest-rate").value = x.interest_rate; document.getElementById("loan-payment-amount").value = x.payment_amount || ""; document.getElementById("loan-payment-frequency").value = x.payment_frequency || "monthly"; document.getElementById("loan-start-date").value = x.start_date || ""; document.getElementById("loan-initial-amount").value = x.initial_amount; document.getElementById("loan-current-balance").value = x.current_balance; document.getElementById("loan-end-date").value = x.end_date || ""; },
    beforeLoad: loadVehicleOptions,
  });
}

function initAdminUsersPage() {
  const createForm = document.getElementById("create-user-form");
  const resetForm = document.getElementById("reset-password-form");
  const userSelect = document.getElementById("reset-user-id");
  const tableBody = document.getElementById("users-body");
  const adminMessage = document.getElementById("admin-message");

  async function loadUsers() {
    const response = await apiFetch("/api/admin/users");
    if (!response.ok) return;
    const users = await response.json();
    userSelect.innerHTML = "";
    tableBody.innerHTML = "";
    for (const user of users) {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = `${user.fullName} (${user.username})`;
      userSelect.appendChild(option);

      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${user.fullName}</td><td>${user.username}</td><td>${user.email || "—"}</td><td>${user.role}</td><td>${user.isVerified ? "Yes" : "No"}</td><td>${user.dbUsageHuman || "0 B"}</td><td><button class="delete-btn" data-user-id="${user.id}" data-username="${user.username}" type="button">Delete</button></td>`;
      tableBody.appendChild(tr);
    }
  }

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains("delete-btn")) return;
    const userId = target.dataset.userId;
    const username = target.dataset.username;
    if (!window.confirm(`Delete user '${username}'? This cannot be undone.`)) return;
    const response = await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) return setText(adminMessage, payload.error || "Unable to delete user.");
    setText(adminMessage, `Deleted user ${username}.`);
    await loadUsers();
  });

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      fullName: document.getElementById("new-full-name").value.trim(),
      username: document.getElementById("new-username").value.trim(),
      email: document.getElementById("new-email").value.trim(),
      password: document.getElementById("new-password").value,
      role: document.getElementById("new-role").value,
    };
    const response = await apiFetch("/api/admin/users", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(adminMessage, data.error || "Unable to create user.");
    createForm.reset();
    setText(adminMessage, "User created.");
    await loadUsers();
  });

  resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = userSelect.value;
    const password = document.getElementById("reset-password").value;
    const response = await apiFetch(`/api/admin/users/${userId}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
    const data = await response.json();
    if (!response.ok) return setText(adminMessage, data.error || "Unable to reset password.");
    resetForm.reset();
    setText(adminMessage, "Password reset.");
  });

  return { render: loadUsers };
}

function initAdminEmailPage() {
  const form = document.getElementById("smtp-settings-form");
  const msg = document.getElementById("email-settings-message");

  async function render() {
    const response = await apiFetch("/api/admin/smtp-settings");
    if (!response.ok) return;
    const s = await response.json();
    document.getElementById("smtp-host").value = s.smtpHost || "";
    document.getElementById("smtp-port").value = s.smtpPort || "587";
    document.getElementById("smtp-username").value = s.smtpUsername || "";
    document.getElementById("smtp-password").value = s.smtpPassword || "";
    document.getElementById("smtp-from-email").value = s.smtpFromEmail || "";
    document.getElementById("smtp-use-ssl").checked = Boolean(s.smtpUseSsl);
    document.getElementById("website-host").value = s.websiteHost || "http://localhost:3000";
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      smtpHost: document.getElementById("smtp-host").value.trim(),
      smtpPort: document.getElementById("smtp-port").value.trim(),
      smtpUsername: document.getElementById("smtp-username").value.trim(),
      smtpPassword: document.getElementById("smtp-password").value,
      smtpFromEmail: document.getElementById("smtp-from-email").value.trim(),
      smtpUseSsl: document.getElementById("smtp-use-ssl").checked,
      websiteHost: document.getElementById("website-host").value.trim(),
    };
    const response = await apiFetch("/api/admin/smtp-settings", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save settings.");
    setText(msg, "Settings saved.");
  });

  return { render };
}

function initAdminBackupsPage() {
  const form = document.getElementById("backup-settings-form");
  const runBtn = document.getElementById("run-backup-btn");
  const msg = document.getElementById("backup-settings-message");
  const listBody = document.getElementById("backup-files-body");

  async function loadBackups() {
    const response = await apiFetch("/api/admin/backups");
    if (!response.ok) return;
    const files = await response.json();
    if (!listBody) return;
    listBody.innerHTML = "";
    files.forEach((file) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${file.name}</td><td>${file.sizeHuman}</td><td>${new Date(file.createdAt).toLocaleString()}</td><td><a href="/api/admin/backups/download?name=${encodeURIComponent(file.name)}">Download</a> <button class="delete-backup-btn" data-name="${file.name}" type="button">Delete</button></td>`;
      listBody.appendChild(tr);
    });
  }

  async function render() {
    const response = await apiFetch("/api/admin/backup-settings");
    if (response.ok) {
      const s = await response.json();
      document.getElementById("backup-enabled").checked = Boolean(s.enabled);
      document.getElementById("backup-interval-hours").value = s.intervalHours || 24;
      document.getElementById("backup-keep-count").value = s.keepCount || 10;
      document.getElementById("backup-next-run").textContent = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "Not scheduled";
    }
    await loadBackups();
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      enabled: document.getElementById("backup-enabled").checked,
      intervalHours: Number(document.getElementById("backup-interval-hours").value),
      keepCount: Number(document.getElementById("backup-keep-count").value),
    };
    const response = await apiFetch("/api/admin/backup-settings", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save backup settings.");
    setText(msg, "Backup settings saved.");
    await render();
  });

  listBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.classList.contains("delete-backup-btn")) return;
    const name = target.dataset.name;
    if (!name) return;
    if (!window.confirm(`Delete backup ${name}?`)) return;
    const response = await apiFetch(`/api/admin/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!response.ok) return;
    await loadBackups();
  });

  runBtn?.addEventListener("click", async () => {
    const response = await apiFetch("/api/admin/backups/run", { method: "POST", body: JSON.stringify({}) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Backup failed.");
    setText(msg, `Backup created: ${data.name}`);
    await loadBackups();
  });

  return { render };
}

function initAdminUpdatesPage() {
  const updateRepoInput = document.getElementById("update-repo");
  const updateTokenInput = document.getElementById("update-token");
  const clearTokenInput = document.getElementById("update-clear-token");
  const saveBtn = document.getElementById("save-update-settings-btn");
  const checkUpdatesBtn = document.getElementById("check-updates-btn");
  const applyUpdateBtn = document.getElementById("apply-update-btn");
  const restartServiceBtn = document.getElementById("restart-service-btn");
  const updatesMsg = document.getElementById("updates-message");
  const updateCurrent = document.getElementById("update-current-version");
  const updateLatest = document.getElementById("update-latest-version");
  const updateHasToken = document.getElementById("update-has-token");

  async function loadSettings() {
    const response = await apiFetch("/api/admin/update-settings");
    if (!response.ok) return;
    const settings = await response.json();
    if (updateRepoInput) updateRepoInput.value = settings.repo || "";
    if (updateCurrent) updateCurrent.textContent = settings.currentVersion || "unknown";
    if (updateHasToken) updateHasToken.textContent = settings.hasToken ? "Saved" : "Not saved";
  }

  saveBtn?.addEventListener("click", async () => {
    const payload = {
      repo: updateRepoInput?.value.trim() || "",
      token: updateTokenInput?.value.trim() || "",
      clearToken: Boolean(clearTokenInput?.checked),
    };
    const response = await apiFetch("/api/admin/update-settings", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(updatesMsg, data.error || "Unable to save update settings.");
    if (updateTokenInput) updateTokenInput.value = "";
    if (clearTokenInput) clearTokenInput.checked = false;
    if (updateHasToken) updateHasToken.textContent = data.hasToken ? "Saved" : "Not saved";
    setText(updatesMsg, "Update settings saved.");
  });

  checkUpdatesBtn?.addEventListener("click", async () => {
    const response = await apiFetch("/api/admin/updates/check");
    const data = await response.json();
    if (!response.ok) return setText(updatesMsg, data.error || "Unable to check updates.");
    if (updateCurrent) updateCurrent.textContent = data.currentVersion || "unknown";
    if (updateLatest) updateLatest.textContent = data.latestVersion || data.currentVersion || "unknown";
    setText(updatesMsg, data.updateAvailable ? `Update available: ${data.latestVersion}` : "You are up to date.");
  });

  applyUpdateBtn?.addEventListener("click", async () => {
    if (!window.confirm("Apply latest update? A database backup will be created first and restart may be required.")) return;
    const response = await apiFetch("/api/admin/updates/apply", { method: "POST", body: JSON.stringify({ confirm: true }) });
    const data = await response.json();
    if (!response.ok) return setText(updatesMsg, data.error || "Update failed.");
    if (updateLatest) updateLatest.textContent = data.appliedVersion || "unknown";
    setText(updatesMsg, `Update applied (${data.appliedVersion}). Backup: ${data.backup}. Click Restart Service to apply.`);
  });

  restartServiceBtn?.addEventListener("click", async () => {
    if (!window.confirm("Restart service now? Active sessions may disconnect briefly.")) return;
    const response = await apiFetch("/api/admin/restart-service", { method: "POST", body: JSON.stringify({}) });
    const data = await response.json();
    if (!response.ok) return setText(updatesMsg, data.error || "Unable to restart service.");
    setText(updatesMsg, data.message || "Service restart initiated.");
  });

  return { render: loadSettings };
}

function initMonthlyPaymentsReportPage() {
  const monthInput = document.getElementById("report-month");
  const runBtn = document.getElementById("run-monthly-report-btn");
  const printBtn = document.getElementById("print-monthly-report-btn");
  const printTitle = document.getElementById("monthly-print-title");
  const monthlyBody = document.getElementById("monthly-payments-body");
  const periodicBody = document.getElementById("periodic-payments-body");

  async function render() {
    const current = new Date();
    if (!monthInput.value) monthInput.value = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
    const response = await apiFetch(`/api/reports/monthly-payments?month=${encodeURIComponent(monthInput.value)}`);
    if (!response.ok) return;
    const data = await response.json();
    if (printTitle) {
      const [yy, mm] = (data.month || monthInput.value || "").split("-");
      const monthName = yy && mm ? new Date(Number(yy), Number(mm) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" }) : monthInput.value;
      printTitle.textContent = `Monthly Payments Report for ${monthName}`;
    }

    monthlyBody.innerHTML = "";
    data.monthlyPayments.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${item.dueDate}</td><td>${item.category}</td><td>${item.description}</td><td>${currency(item.amount)}</td>`;
      monthlyBody.appendChild(tr);
    });

    periodicBody.innerHTML = "";
    data.periodicPayments.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${item.dueDate}</td><td>${item.frequency}</td><td>${item.description}</td><td>${currency(item.amount)}</td>`;
      periodicBody.appendChild(tr);
    });
  }

  runBtn?.addEventListener("click", render);
  return { render };
}


function initLiquidCashReportPage() {
  const bankBody = document.getElementById("liquid-bank-body");
  const cashBody = document.getElementById("liquid-cash-body");
  const printBtn = document.getElementById("print-liquid-report-btn");
  const printTitle = document.getElementById("liquid-print-title");
  async function render() {
    const response = await apiFetch("/api/reports/liquid-cash");
    if (printTitle) printTitle.textContent = "Liquid Cash Report";
    if (!response.ok) return;
    const data = await response.json();
    bankBody.innerHTML = "";
    (data.bankAccounts || []).forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.description}</td><td>${row.institution}</td><td>${row.account_type}</td><td>${currency(row.balance)}</td>`;
      bankBody.appendChild(tr);
    });
    cashBody.innerHTML = "";
    (data.cashAccounts || []).forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.description}</td><td>${currency(row.amount)}</td>`;
      cashBody.appendChild(tr);
    });
  }
  return { render };
}

function initNotificationsPage() {
  const body = document.getElementById("notifications-body");
  const msg = document.getElementById("notifications-message");

  async function loadAndRender() {
    const response = await apiFetch("/api/notifications");
    if (!response.ok) return;
    const items = await response.json();
    body.innerHTML = "";
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="5">No notifications.</td></tr>';
      return;
    }
    items.forEach((n) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${new Date(n.created_at).toLocaleString()}</td><td>${n.title}</td><td>${n.message}</td><td>${n.status}</td><td><div class="notifications-actions"><button class="mark-read-btn" data-id="${n.id}" type="button">Mark Read</button><button class="mark-unread-btn" data-id="${n.id}" type="button">Mark Unread</button><button class="delete-btn" data-id="${n.id}" type="button">Delete</button></div></td>`;
      body.appendChild(tr);
    });
  }

  body?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("delete-btn")) {
      await apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
    } else if (target.classList.contains("mark-read-btn")) {
      await apiFetch("/api/notifications/mark", { method: "POST", body: JSON.stringify({ id, status: "read" }) });
    } else if (target.classList.contains("mark-unread-btn")) {
      await apiFetch("/api/notifications/mark", { method: "POST", body: JSON.stringify({ id, status: "unread" }) });
    } else return;
    await loadCurrentUser();
    await loadAndRender();
    setText(msg, "Notification updated.");
  });

  return { render: loadAndRender };
}

function initAdminNotificationsPage() {
  const form = document.getElementById("admin-notification-form");
  const msg = document.getElementById("admin-notification-message");
  const body = document.getElementById("admin-notification-history-body");

  async function renderHistory() {
    const response = await apiFetch("/api/admin/notifications-broadcasts");
    if (!response.ok || !body) return;
    const rows = await response.json();
    body.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${new Date(r.created_at).toLocaleString()}</td><td>${r.title}</td><td>${r.message}</td><td>${r.sender_username}</td>`;
      body.appendChild(tr);
    });
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: document.getElementById("admin-notification-title").value.trim(),
      message: document.getElementById("admin-notification-body").value.trim(),
    };
    const response = await apiFetch("/api/admin/notifications-broadcasts", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to send notification.");
    form.reset();
    setText(msg, "Notification sent to all users.");
    await loadCurrentUser();
    await renderHistory();
  });

  return { render: renderHistory };
}


function initRecurringExpensesPage() {
  const form = document.getElementById("recurring-expenses-form");
  const msg = document.getElementById("recurring-expenses-message");
  const body = document.getElementById("recurring-expenses-body");
  const submitBtn = document.getElementById("recurring-expenses-submit-btn");
  const categorySelect = document.getElementById("rec-category");
  const newCategoryWrap = document.getElementById("rec-new-category-wrap");
  const newCategoryInput = document.getElementById("rec-new-category");
  const addCategoryBtn = document.getElementById("rec-add-category-btn");
  let rows = [];
  let editingId = null;

  function resetEdit() {
    editingId = null;
    if (submitBtn) submitBtn.textContent = "Add Recurring Expense";
  }

  async function loadCategories() {
    if (!categorySelect) return;
    const response = await apiFetch("/api/liabilities/recurring-expense-categories");
    if (!response.ok) return;
    const categories = await response.json();
    const current = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Select category</option>';
    categories.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      categorySelect.appendChild(option);
    });
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "+ Add New Category";
    categorySelect.appendChild(newOpt);
    if (current) categorySelect.value = current;
  }

  async function loadRows() {
    const response = await apiFetch("/api/liabilities/recurring-expenses");
    if (!response.ok) return;
    rows = await response.json();
  }

  function renderTable() {
    body.innerHTML = "";
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7">No recurring expenses yet.</td></tr>';
      return;
    }
    let total = 0;
    rows.forEach((x) => {
      total += Number(x.amount || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${x.description}</td><td>${x.category || "—"}</td><td>${currency(x.amount)}</td><td>${x.frequency}</td><td>${x.start_date || "—"}</td><td>${x.end_date || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`;
      body.appendChild(tr);
    });
    const tr = document.createElement("tr");
    tr.className = "totals-row";
    tr.innerHTML = `<td colspan="2"><strong>Totals</strong></td><td><strong>${currency(total)}</strong></td><td colspan="4"></td>`;
    body.appendChild(tr);
  }

  categorySelect?.addEventListener("change", () => {
    if (!newCategoryWrap) return;
    newCategoryWrap.classList.toggle("hidden", categorySelect.value !== "__new__");
  });

  addCategoryBtn?.addEventListener("click", async () => {
    const name = newCategoryInput?.value.trim() || "";
    if (!name) return setText(msg, "Enter a category name.");
    const response = await apiFetch("/api/liabilities/recurring-expense-categories", { method: "POST", body: JSON.stringify({ name }) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to add category.");
    await loadCategories();
    if (categorySelect) categorySelect.value = name;
    if (newCategoryInput) newCategoryInput.value = "";
    if (newCategoryWrap) newCategoryWrap.classList.add("hidden");
    setText(msg, "Category added.");
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const category = categorySelect?.value || "";
    if (!category || category === "__new__") return setText(msg, "Select a category.");
    const payload = {
      id: editingId,
      description: document.getElementById("rec-description").value.trim(),
      category,
      amount: Number(document.getElementById("rec-amount").value),
      frequency: document.getElementById("rec-frequency").value,
      startDate: document.getElementById("rec-start-date").value,
      endDate: document.getElementById("rec-end-date").value,
    };
    const response = await apiFetch("/api/liabilities/recurring-expenses", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save recurring expense.");
    form.reset();
    resetEdit();
    await loadRows();
    renderTable();
    setText(msg, "Recurring expense saved.");
  });

  body?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    if (target.classList.contains("edit-btn")) {
      const row = rows.find((x) => x.id === id);
      if (!row) return;
      document.getElementById("rec-description").value = row.description || "";
      document.getElementById("rec-amount").value = row.amount || "";
      document.getElementById("rec-frequency").value = row.frequency || "monthly";
      document.getElementById("rec-start-date").value = row.start_date || "";
      document.getElementById("rec-end-date").value = row.end_date || "";
      if (categorySelect) categorySelect.value = row.category || "";
      editingId = id;
      if (submitBtn) submitBtn.textContent = "Update Recurring Expense";
      return;
    }
    if (!target.classList.contains("delete-btn")) return;
    if (!window.confirm("Delete this recurring expense?")) return;
    await apiFetch(`/api/liabilities/recurring-expenses/${id}`, { method: "DELETE" });
    if (editingId === id) { form?.reset(); resetEdit(); }
    await loadRows();
    renderTable();
  });

  return {
    render: async () => {
      await loadCategories();
      await loadRows();
      renderTable();
      if (newCategoryWrap) newCategoryWrap.classList.add("hidden");
    },
  };
}

function initGoalsPage() {
  const form = document.getElementById("goals-form");
  const body = document.getElementById("goals-body");
  const msg = document.getElementById("goals-message");
  const categorySelect = document.getElementById("goal-target-category");
  const subtypeSelect = document.getElementById("goal-target-subtype");

  const subtypeOptions = {
    asset: [
      { value: "bank-accounts", label: "Bank Accounts" },
      { value: "cash", label: "Cash" },
      { value: "vehicles", label: "Vehicles" },
      { value: "guns", label: "Guns" },
    ],
    investment: [
      { value: "stocks", label: "Stocks" },
      { value: "precious-metals", label: "Precious Metals" },
      { value: "real-estate", label: "Real Estate" },
      { value: "business-ventures", label: "Business Ventures" },
      { value: "retirement-accounts", label: "Retirement Accounts" },
    ],
    liability: [
      { value: "mortgages", label: "Mortgages" },
      { value: "credit-cards", label: "Credit Cards" },
      { value: "loans", label: "Loans" },
      { value: "recurring-expenses", label: "Recurring Expenses" },
    ],
  };

  function renderSubtypeOptions() {
    if (!categorySelect || !subtypeSelect) return;
    const category = categorySelect.value;
    const options = subtypeOptions[category] || [];
    subtypeSelect.innerHTML = "";
    options.forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      subtypeSelect.appendChild(option);
    });
  }

  async function render() {
    const response = await apiFetch("/api/goals");
    if (!response.ok) return;
    const rows = await response.json();
    body.innerHTML = "";
    if (!rows.length) { body.innerHTML = '<tr><td colspan="6">No goals yet.</td></tr>'; return; }
    rows.forEach((x) => {
      const pct = x.target_amount > 0 ? Math.min(100, (Number(x.progress_amount || 0) / Number(x.target_amount)) * 100) : 0;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${x.name}</td><td>${x.goal_type}</td><td>${currency(x.target_amount)}</td><td><div class="goal-progress-wrap"><progress max="100" value="${pct}"></progress><span>${pct.toFixed(1)}%</span></div></td><td>${x.goal_date || "—"}</td><td><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`;
      body.appendChild(tr);
    });
  }

  categorySelect?.addEventListener("change", renderSubtypeOptions);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      name: document.getElementById("goal-name").value.trim(),
      goalType: document.getElementById("goal-type").value,
      targetAmount: Number(document.getElementById("goal-target-amount").value),
      targetCategory: categorySelect?.value || "investment",
      targetSubtype: subtypeSelect?.value || "retirement-accounts",
      goalDate: document.getElementById("goal-date").value,
    };
    const response = await apiFetch("/api/goals", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to save goal.");
    form.reset();
    renderSubtypeOptions();
    await render();
    setText(msg, "Goal saved.");
  });

  body?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains("delete-btn")) return;
    await apiFetch(`/api/goals/${target.dataset.id}`, { method: "DELETE" });
    await render();
  });

  renderSubtypeOptions();
  setInterval(() => { render(); }, 10000);
  return { render };
}

function initTaxesPage() {
  const form = document.getElementById("taxes-form");
  const submitBtn = document.getElementById("taxes-submit-btn");
  const fileInput = document.getElementById("tax-file");
  const federalInput = document.getElementById("tax-federal");
  const stateInput = document.getElementById("tax-state");
  const localInput = document.getElementById("tax-local");
  const body = document.getElementById("taxes-body");
  const msg = document.getElementById("taxes-message");
  const totalEl = document.getElementById("tax-total-paid");
  let rowsById = new Map();
  let editingId = null;

  function resetEdit() {
    editingId = null;
    if (submitBtn) submitBtn.textContent = "Save Tax Year";
  }

  async function render() {
    const response = await apiFetch("/api/taxes");
    if (!response.ok) {
      setText(msg, "Unable to load taxes.");
      return;
    }
    const rows = await response.json();
    rowsById = new Map(rows.map((x) => [Number(x.id), x]));
    body.innerHTML = "";
    let totalTax = 0;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6">No tax years yet.</td></tr>';
      if (totalEl) totalEl.textContent = currency(0);
      return;
    }
    rows.forEach((x) => {
      const federal = Number(x.federal_tax || 0);
      const state = Number(x.state_tax || 0);
      const local = Number(x.local_tax || 0);
      totalTax += federal + state + local;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${x.tax_year}</td><td>${currency(federal)}</td><td>${currency(state)}</td><td>${currency(local)}</td><td>${x.document_id ? `<a href="/api/taxes/documents/${x.document_id}/download">${x.file_name || "Download"}</a>` : "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`;
      body.appendChild(tr);
    });
    if (totalEl) totalEl.textContent = currency(totalTax);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const year = Number(document.getElementById("tax-year").value);
    const federalTax = Number(federalInput?.value || 0);
    const stateTax = Number(stateInput?.value || 0);
    const localTax = Number(localInput?.value || 0);
    const file = fileInput?.files?.[0] || null;

    try {
      let fileBase64 = "";
      if (file) {
        fileBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      const payload = {
        taxYear: year,
        federalTax,
        stateTax,
        localTax,
        fileName: file ? file.name : "",
        contentType: file?.type || "application/pdf",
        fileBase64,
        notes: document.getElementById("tax-notes").value.trim(),
      };
      const response = await apiFetch("/api/taxes", { method: "POST", body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) return setText(msg, data.error || "Unable to save tax year.");
      form.reset();
      resetEdit();
      await render();
      setText(msg, "Tax year saved.");
    } catch {
      setText(msg, "Unable to read or upload file.");
    }
  });

  body?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number(target.dataset.id);
    const row = rowsById.get(id);
    if (!row) return;

    if (target.classList.contains("edit-btn")) {
      document.getElementById("tax-year").value = row.tax_year || "";
      if (federalInput) federalInput.value = row.federal_tax ?? "";
      if (stateInput) stateInput.value = row.state_tax ?? "";
      if (localInput) localInput.value = row.local_tax ?? "";
      document.getElementById("tax-notes").value = row.notes || "";
      if (fileInput) fileInput.value = "";
      editingId = id;
      if (submitBtn) submitBtn.textContent = "Update Tax Year";
      return;
    }

    if (target.classList.contains("delete-btn")) {
      await apiFetch(`/api/taxes/${target.dataset.id}`, { method: "DELETE" });
      if (editingId === id) { form?.reset(); resetEdit(); }
      await render();
    }
  });

  return { render };
}

function initResetPasswordPage() {
  const form = document.getElementById("reset-password-page-form");
  const msg = document.getElementById("reset-password-page-message");
  const tokenInput = document.getElementById("reset-token");
  tokenInput.value = new URLSearchParams(window.location.search).get("token") || "";
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    const password = document.getElementById("reset-password-page-new").value;
    const response = await apiFetch("/api/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to reset password.");
    setText(msg, "Password reset successful. Return to login page.");
    form.reset();
  });
  return { render: async () => {} };
}

let pageController = null;

async function initPageData() {
  if (page === "reset-password") {
    if (!pageController) pageController = initResetPasswordPage();
    return pageController.render();
  }

  if (!currentUser) return;

  if (page === "home") {
    await loadRecords();
    if (!pageController) pageController = initHomePage();
    return pageController.render();
  }

  if (page === "records") {
    await loadRecords();
    if (!pageController) pageController = initRecordsPage();
    return pageController.render();
  }

  if (page === "investments") {
    if (!pageController) pageController = initInvestmentsPage();
    return pageController.render();
  }

  if (page === "precious-metals") {
    if (!pageController) pageController = initPreciousMetalsPage();
    return pageController.render();
  }

  if (page === "real-estate") {
    if (!pageController) pageController = initRealEstatePage();
    return pageController.render();
  }

  if (page === "business-ventures") {
    if (!pageController) pageController = initBusinessVenturesPage();
    return pageController.render();
  }

  if (page === "retirement-accounts") {
    if (!pageController) pageController = initRetirementAccountsPage();
    return pageController.render();
  }

  if (page === "net-worth-report") {
    if (!pageController) pageController = initNetWorthReportPage();
    return pageController.render();
  }

  if (page === "monthly-payments-report") {
    if (!pageController) pageController = initMonthlyPaymentsReportPage();
    return pageController.render();
  }

  if (page === "liquid-cash-report") {
    if (!pageController) pageController = initLiquidCashReportPage();
    return pageController.render();
  }

  if (page === "profile") {
    if (!pageController) pageController = initProfilePage();
    return pageController.render();
  }

  if (page === "assets-vehicles") {
    if (!pageController) pageController = initAssetsVehiclesPage();
    return pageController.render();
  }

  if (page === "assets-guns") {
    if (!pageController) pageController = initAssetsGunsPage();
    return pageController.render();
  }

  if (page === "assets-bank-accounts") {
    if (!pageController) pageController = initAssetsBankAccountsPage();
    return pageController.render();
  }

  if (page === "assets-cash") {
    if (!pageController) pageController = initAssetsCashPage();
    return pageController.render();
  }

  if (page === "liabilities-mortgages") {
    if (!pageController) pageController = initLiabilitiesMortgagesPage();
    return pageController.render();
  }

  if (page === "liabilities-credit-cards") {
    if (!pageController) pageController = initLiabilitiesCreditCardsPage();
    return pageController.render();
  }

  if (page === "liabilities-loans") {
    if (!pageController) pageController = initLiabilitiesLoansPage();
    return pageController.render();
  }

  if (page === "liabilities-recurring-expenses") {
    if (!pageController) pageController = initRecurringExpensesPage();
    return pageController.render();
  }

  if (page === "goals") {
    if (!pageController) pageController = initGoalsPage();
    return pageController.render();
  }

  if (page === "taxes") {
    if (!pageController) pageController = initTaxesPage();
    return pageController.render();
  }

  if (page === "admin-users") {
    if (!pageController) pageController = initAdminUsersPage();
    return pageController.render();
  }

  if (page === "admin-email") {
    if (!pageController) pageController = initAdminEmailPage();
    return pageController.render();
  }

  if (page === "admin-backups") {
    if (!pageController) pageController = initAdminBackupsPage();
    return pageController.render();
  }

  if (page === "admin-updates") {
    if (!pageController) pageController = initAdminUpdatesPage();
    return pageController.render();
  }

  if (page === "admin-notifications") {
    if (!pageController) pageController = initAdminNotificationsPage();
    return pageController.render();
  }

  if (page === "notifications") {
    if (!pageController) pageController = initNotificationsPage();
    return pageController.render();
  }
}

async function bootstrap() {
  bindAuthUI();
  populateYearOptions();
  showAuthMode("login");
  await loadVersion();
  if (page !== "reset-password") {
    await loadCurrentUser();
    if (currentUser && page === "home") {
      const next = new URLSearchParams(window.location.search).get("next") || "";
      if (NEXT_ALLOWED_PATHS.has(next)) {
        window.location.replace(next);
        return;
      }
    }
  } else {
    renderAuthState();
  }
  await initPageData();
}

bootstrap();
