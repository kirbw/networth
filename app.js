const DEFAULT_GOAL_PERCENT = 10;
const page = document.body.dataset.page;
const NEXT_ALLOWED_PATHS = new Set(["/records.html", "/investments.html", "/precious-metals.html", "/real-estate.html", "/business-ventures.html", "/retirement-accounts.html", "/net-worth-report.html", "/admin-users.html", "/admin-email.html"]);

const authCard = document.getElementById("auth-card");
const appContent = document.getElementById("app-content");
const sessionName = document.getElementById("session-name");
const logoutBtn = document.getElementById("logout-btn");
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

function setText(el, text) {
  if (el) el.textContent = text;
}

function goalStorageKey() {
  return currentUser ? `giving-goal-percent:${currentUser.username}` : "giving-goal-percent:anonymous";
}

function getGoalPercent() {
  const parsed = Number(localStorage.getItem(goalStorageKey()));
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) return DEFAULT_GOAL_PERCENT;
  return parsed;
}

function setGoalPercent(value) {
  localStorage.setItem(goalStorageKey(), String(value));
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
  navAdmin?.classList.toggle("hidden", !(authenticated && currentUser.role === "admin"));
}

function ensureAdminPageAccess() {
  if (!["admin-users", "admin-email"].includes(page)) return;
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
  loginForm?.addEventListener("submit", handleLogin);
  signupForm?.addEventListener("submit", handleSignup);
  verifyForm?.addEventListener("submit", handleVerify);
  forgotPasswordForm?.addEventListener("submit", handleForgotPassword);
  logoutBtn?.addEventListener("click", handleLogout);
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
  const goalInput = document.getElementById("goal-percent-input");
  const goalIndicator = document.getElementById("goal-indicator");
  const yearInput = document.getElementById("year");
  const incomeInput = document.getElementById("income");
  const donationInput = document.getElementById("donation");
  const netWorthInput = document.getElementById("netWorth");
  const investmentsTotalEl = document.getElementById("investments-combined-total");

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
      options: { responsive: true, plugins: { legend: { display: false } } },
    });
    if (investmentsTotalEl) investmentsTotalEl.textContent = `Combined total: ${currency(summary.combinedTotal || 0)}`;
  }

  function renderCharts() {
    const goalPercent = getGoalPercent();
    const ratio = goalPercent / 100;
    goalInput.value = goalPercent.toFixed(1);

    destroy(incomeGivingChart);
    incomeGivingChart = new Chart(document.getElementById("income-giving-chart").getContext("2d"), {
      type: "line",
      data: { labels: records.map((r) => r.year), datasets: [{ label: "Income", data: records.map((r) => r.income), borderColor: "#3956f6", tension: 0.2 }, { label: "Donations", data: records.map((r) => r.donation), borderColor: "#00a76f", tension: 0.2 }] },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } },
    });

    const nw = records.filter((r) => r.netWorth != null);
    destroy(netWorthChart);
    netWorthChart = new Chart(document.getElementById("net-worth-chart").getContext("2d"), {
      type: "line",
      data: { labels: nw.map((r) => r.year), datasets: [{ label: "Net Worth", data: nw.map((r) => r.netWorth), borderColor: "#9747ff", tension: 0.2 }] },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } },
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
      options: { responsive: true, plugins: { legend: { position: "bottom" } } },
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
  });

  goalInput?.addEventListener("change", () => {
    const value = Number(goalInput.value);
    if (Number.isNaN(value) || value < 0 || value > 100) return;
    setGoalPercent(value);
    renderCharts();
  });

  return { render: async () => { renderCharts(); await renderInvestmentsSummary(); } };
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
      tableBody.innerHTML = `<tr><td colspan="10">No stocks yet.</td></tr>`;
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
      tr.innerHTML = `<td>${inv.ticker}</td><td>${companyName}</td><td>${inv.purchase_date}</td><td>${inv.shares}</td><td>${currency(inv.purchase_price)}</td><td>${currency(purchaseValue)}</td><td>${currentPriceText}</td><td>${gainLossCell}</td><td>${gainLossPctCell}</td><td><button class="edit-btn" data-id="${inv.id}" type="button">Edit</button><button class="delete-btn" data-id="${inv.id}" type="button">Delete</button></td>`;
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
    totalRow.innerHTML = `<td colspan="5"><strong>Totals (priced holdings)</strong></td><td><strong>${hasValuedData ? currency(totalPurchaseValue) : "N/A"}</strong></td><td><strong>${totalCurrentText}</strong></td><td><strong class="${totalGainLossClass}">${totalGainLossText}</strong></td><td><strong class="${totalGainLossClass}">${totalGainLossPctText}</strong></td><td></td>`;
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

  function fmtValue(value) {
    return value == null ? "N/A" : currency(value);
  }

  function renderCategory(title, items) {
    const section = document.createElement("section");
    section.className = "report-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);

    const table = document.createElement("table");
    table.className = "report-table";
    const tbody = document.createElement("tbody");

    let total = 0;
    for (const item of items) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="report-col-label">${item.description}</td><td class="report-col-value">${fmtValue(item.value)}</td>`;
      tbody.appendChild(tr);
      if (item.value != null) total += Number(item.value);
    }

    const totalRow = document.createElement("tr");
    totalRow.className = "totals-row";
    totalRow.innerHTML = `<td class="report-col-label"><strong>${title} Total</strong></td><td class="report-col-value"><strong>${currency(total)}</strong></td>`;
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    section.appendChild(table);

    return { section, total };
  }

  async function renderReport() {
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
      { title: "Real Estate", items: realEstate.map((x) => ({ description: `${x.description || x.address} (${x.address})`, value: Number(x.current_value) * (Number(x.percentage_owned) / 100) })) },
      { title: "Business Ventures", items: business.map((x) => ({ description: x.business_name, value: Number(x.business_value) * (Number(x.percentage_owned) / 100) })) },
      { title: "Retirement Accounts", items: retirement.map((x) => ({ description: `${x.description} — ${x.account_type} (${x.broker})`, value: Number(x.value) })) },
      { title: "Vehicles", items: vehicles.map((x) => ({ description: `${x.description} — ${x.model_year || ""} ${x.make} ${x.model}`.trim(), value: Number(x.value) })) },
      { title: "Guns", items: guns.map((x) => ({ description: `${x.description} — ${x.gun_type}`, value: Number(x.value) })) },
      { title: "Bank Accounts", items: bankAccounts.map((x) => ({ description: `${x.description} — ${x.institution} (${x.account_type})`, value: Number(x.balance) })) },
      { title: "Cash", items: cash.map((x) => ({ description: x.description, value: Number(x.amount) })) },
    ];

    const liabilityCategories = [
      { title: "Mortgages", items: mortgages.map((x) => ({ description: `${x.description}${x.real_estate_address ? ` (${x.real_estate_address})` : ""}`, value: Number(x.current_balance) })) },
      { title: "Credit Cards", items: creditCards.map((x) => ({ description: x.description, value: Number(x.current_balance) })) },
      { title: "Loans", items: loans.map((x) => ({ description: `${x.description} — ${x.loan_type}`, value: Number(x.current_balance) })) },
    ];

    content.innerHTML = "";
    let assetTotal = 0;
    for (const category of categories) {
      const { section, total } = renderCategory(category.title, category.items);
      content.appendChild(section);
      assetTotal += total;
    }

    const liabilitiesHeader = document.createElement("h3");
    liabilitiesHeader.textContent = "Liabilities";
    liabilitiesHeader.className = "report-liabilities-heading";
    content.appendChild(liabilitiesHeader);

    let liabilitiesTotal = 0;
    for (const category of liabilityCategories) {
      const { section, total } = renderCategory(category.title, category.items);
      content.appendChild(section);
      liabilitiesTotal += total;
    }

    const netWorth = assetTotal - liabilitiesTotal;
    if (titleEl) titleEl.textContent = `Net Worth Statement for ${currentUser?.fullName || currentUser?.username || "User"}`;
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString();
    totalEl.textContent = `Total Net Worth: ${currency(netWorth)} (Assets/Investments: ${currency(assetTotal)} − Liabilities: ${currency(liabilitiesTotal)})`;
    generated.textContent = `Generated on ${new Date().toLocaleString()}`;
  }

  printBtn?.addEventListener("click", () => window.print());

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
    emptyText: "No vehicles yet.", colspan: 7, totalLabelColspan: 5, savedText: "Vehicle saved.", deleteConfirm: "Delete this vehicle entry?",
    valueGetter: (x) => x.value,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.model_year || "—"}</td><td>${x.make}</td><td>${x.model}</td><td>${currency(x.value)}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("veh-description").value.trim(), year: document.getElementById("veh-year").value.trim(), make: document.getElementById("veh-make").value.trim(), model: document.getElementById("veh-model").value.trim(), value: Number(document.getElementById("veh-value").value) }),
    startEdit: (x) => { document.getElementById("veh-description").value = x.description; document.getElementById("veh-year").value = x.model_year || ""; document.getElementById("veh-make").value = x.make; document.getElementById("veh-model").value = x.model; document.getElementById("veh-value").value = x.value; },
  });
}

function initAssetsGunsPage() {
  return initAssetCrudPage({
    formId: "guns-form", messageId: "guns-message", bodyId: "guns-body", sortSelector: "[data-sort-guns]", submitBtnId: "guns-submit-btn",
    defaultSort: "description", sortDataset: "sortGuns", apiBase: "/api/assets/guns", addLabel: "Add Gun", updateLabel: "Update Gun",
    emptyText: "No guns yet.", colspan: 5, totalLabelColspan: 3, savedText: "Gun entry saved.", deleteConfirm: "Delete this gun entry?",
    valueGetter: (x) => x.value,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.gun_type}</td><td>${currency(x.value)}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("gun-description").value.trim(), type: document.getElementById("gun-type").value.trim(), value: Number(document.getElementById("gun-value").value) }),
    startEdit: (x) => { document.getElementById("gun-description").value = x.description; document.getElementById("gun-type").value = x.gun_type; document.getElementById("gun-value").value = x.value; },
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
    emptyText: "No mortgages yet.", colspan: 11, totalLabelColspan: 9, savedText: "Mortgage saved.", deleteConfirm: "Delete this mortgage entry?",
    balanceGetter: (x) => x.current_balance,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.real_estate_address || "—"}</td><td>${x.interest_rate}%</td><td>${x.monthly_payment ? currency(x.monthly_payment) : "—"}</td><td>${x.start_date || "—"}</td><td>${currency(x.initial_amount)}</td><td>${currency(x.current_balance)}</td><td>${x.interest_change_date || "—"}</td><td>${x.end_date || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("mort-description").value.trim(), realEstateId: document.getElementById("mort-real-estate-id").value, interestRate: Number(document.getElementById("mort-interest-rate").value), monthlyPayment: Number(document.getElementById("mort-monthly-payment").value || 0), startDate: document.getElementById("mort-start-date").value, initialAmount: Number(document.getElementById("mort-initial-amount").value), currentBalance: Number(document.getElementById("mort-current-balance").value), endDate: document.getElementById("mort-end-date").value, interestChangeDate: document.getElementById("mort-interest-change-date").value }),
    startEdit: (x) => { document.getElementById("mort-description").value = x.description; document.getElementById("mort-real-estate-id").value = x.real_estate_id || ""; document.getElementById("mort-interest-rate").value = x.interest_rate; document.getElementById("mort-monthly-payment").value = x.monthly_payment || ""; document.getElementById("mort-start-date").value = x.start_date || ""; document.getElementById("mort-initial-amount").value = x.initial_amount; document.getElementById("mort-current-balance").value = x.current_balance; document.getElementById("mort-end-date").value = x.end_date || ""; document.getElementById("mort-interest-change-date").value = x.interest_change_date || ""; },
    beforeLoad: loadRealEstateOptions,
  });
}

function initLiabilitiesCreditCardsPage() {
  return initLiabilityCrudPage({
    formId: "credit-cards-form", messageId: "credit-cards-message", bodyId: "credit-cards-body", sortSelector: "[data-sort-credit-cards]", submitBtnId: "credit-cards-submit-btn",
    defaultSort: "description", sortDataset: "sortCreditCards", apiBase: "/api/liabilities/credit-cards", addLabel: "Add Credit Card", updateLabel: "Update Credit Card",
    emptyText: "No credit cards yet.", colspan: 11, totalLabelColspan: 9, savedText: "Credit card saved.", deleteConfirm: "Delete this credit card entry?",
    balanceGetter: (x) => x.current_balance,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.interest_rate}%</td><td>${x.special_interest_rate == null ? "—" : `${x.special_interest_rate}%`}</td><td>${x.special_rate_end_date || "—"}</td><td>${x.monthly_payment ? currency(x.monthly_payment) : "—"}</td><td>${x.start_date || "—"}</td><td>${currency(x.initial_amount)}</td><td>${currency(x.current_balance)}</td><td>${currency(x.credit_limit)}</td><td>${x.end_date || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("cc-description").value.trim(), interestRate: Number(document.getElementById("cc-interest-rate").value), specialInterestRate: document.getElementById("cc-special-rate").value.trim(), specialRateEndDate: document.getElementById("cc-special-rate-end").value, monthlyPayment: Number(document.getElementById("cc-monthly-payment").value || 0), startDate: document.getElementById("cc-start-date").value, initialAmount: Number(document.getElementById("cc-initial-amount").value), currentBalance: Number(document.getElementById("cc-current-balance").value), endDate: document.getElementById("cc-end-date").value, creditLimit: Number(document.getElementById("cc-credit-limit").value) }),
    startEdit: (x) => { document.getElementById("cc-description").value = x.description; document.getElementById("cc-interest-rate").value = x.interest_rate; document.getElementById("cc-special-rate").value = x.special_interest_rate ?? ""; document.getElementById("cc-special-rate-end").value = x.special_rate_end_date || ""; document.getElementById("cc-monthly-payment").value = x.monthly_payment || ""; document.getElementById("cc-start-date").value = x.start_date || ""; document.getElementById("cc-initial-amount").value = x.initial_amount; document.getElementById("cc-current-balance").value = x.current_balance; document.getElementById("cc-end-date").value = x.end_date || ""; document.getElementById("cc-credit-limit").value = x.credit_limit; },
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
    emptyText: "No loans yet.", colspan: 11, totalLabelColspan: 9, savedText: "Loan saved.", deleteConfirm: "Delete this loan entry?",
    balanceGetter: (x) => x.current_balance,
    rowHtml: (x) => `<td>${x.description}</td><td>${x.loan_type}</td><td>${x.is_private ? "Yes" : "No"}</td><td>${x.vehicle_description || "—"}</td><td>${x.interest_rate}%</td><td>${x.monthly_payment ? currency(x.monthly_payment) : "—"}</td><td>${x.start_date || "—"}</td><td>${currency(x.initial_amount)}</td><td>${currency(x.current_balance)}</td><td>${x.end_date || "—"}</td><td><button class="edit-btn" data-id="${x.id}" type="button">Edit</button><button class="delete-btn" data-id="${x.id}" type="button">Delete</button></td>`,
    collectPayload: (id) => ({ id, description: document.getElementById("loan-description").value.trim(), loanType: document.getElementById("loan-type").value.trim(), isPrivate: document.getElementById("loan-is-private").value, vehicleId: document.getElementById("loan-vehicle-id").value, interestRate: Number(document.getElementById("loan-interest-rate").value), monthlyPayment: Number(document.getElementById("loan-monthly-payment").value || 0), startDate: document.getElementById("loan-start-date").value, initialAmount: Number(document.getElementById("loan-initial-amount").value), currentBalance: Number(document.getElementById("loan-current-balance").value), endDate: document.getElementById("loan-end-date").value }),
    startEdit: (x) => { document.getElementById("loan-description").value = x.description; document.getElementById("loan-type").value = x.loan_type; document.getElementById("loan-is-private").value = x.is_private ? "yes" : "no"; document.getElementById("loan-vehicle-id").value = x.vehicle_id || ""; document.getElementById("loan-interest-rate").value = x.interest_rate; document.getElementById("loan-monthly-payment").value = x.monthly_payment || ""; document.getElementById("loan-start-date").value = x.start_date || ""; document.getElementById("loan-initial-amount").value = x.initial_amount; document.getElementById("loan-current-balance").value = x.current_balance; document.getElementById("loan-end-date").value = x.end_date || ""; },
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
      tr.innerHTML = `<td>${user.fullName}</td><td>${user.username}</td><td>${user.email || "—"}</td><td>${user.role}</td><td>${user.isVerified ? "Yes" : "No"}</td><td><button class="delete-btn" data-user-id="${user.id}" data-username="${user.username}" type="button">Delete</button></td>`;
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

  if (page === "admin-users") {
    if (!pageController) pageController = initAdminUsersPage();
    return pageController.render();
  }

  if (page === "admin-email") {
    if (!pageController) pageController = initAdminEmailPage();
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
