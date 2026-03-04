const DEFAULT_GOAL_PERCENT = 10;
const page = document.body.dataset.page;
const NEXT_ALLOWED_PATHS = new Set(["/records.html", "/investments.html", "/admin-users.html", "/admin-email.html"]);

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
  if (sessionName) sessionName.textContent = authenticated ? `${currentUser.fullName || currentUser.username} (${currentUser.role})` : "Not signed in";
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

  const destroy = (c) => { if (c) c.destroy(); };

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
  });

  goalInput?.addEventListener("change", () => {
    const value = Number(goalInput.value);
    if (Number.isNaN(value) || value < 0 || value > 100) return;
    setGoalPercent(value);
    renderCharts();
  });

  return { render: renderCharts };
}

function initRecordsPage() {
  const tbody = document.getElementById("records-body");
  const clearBtn = document.getElementById("clear-data");
  const form = document.getElementById("edit-form");
  const msg = document.getElementById("records-message");
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
      return setText(msg, `Editing ${year}.`);
    }
    if (target.classList.contains("delete-btn")) {
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

  let investments = [];

  async function loadInvestments() {
    const response = await apiFetch("/api/investments");
    if (!response.ok) return;
    investments = await response.json();
  }

  async function quote(ticker) {
    const response = await apiFetch(`/api/quote?ticker=${encodeURIComponent(ticker)}`);
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "Quote unavailable");
    }
    return response.json();
  }

  async function renderTable() {
    tableBody.innerHTML = "";
    if (!investments.length) {
      tableBody.innerHTML = `<tr><td colspan="8">No investments yet.</td></tr>`;
      return;
    }

    let totalPurchaseValue = 0;
    let totalCurrentValue = 0;
    let missingCurrentValues = 0;

    for (const inv of investments) {
      let currentPriceText = "—";
      let gainLossText = "—";
      let currentValue = null;
      try {
        const q = await quote(inv.ticker);
        currentPriceText = currency(q.currentPrice);
        currentValue = Number(inv.shares) * Number(q.currentPrice);
      } catch {
        currentPriceText = "N/A";
      }

      const purchaseValue = Number(inv.shares) * Number(inv.purchase_price);
      totalPurchaseValue += purchaseValue;
      if (currentValue !== null) totalCurrentValue += currentValue;
      else missingCurrentValues += 1;

      if (currentValue !== null) {
        const gainLoss = currentValue - purchaseValue;
        gainLossText = `${gainLoss >= 0 ? "+" : ""}${currency(gainLoss)}`;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${inv.ticker}</td><td>${inv.purchase_date}</td><td>${inv.shares}</td><td>${currency(inv.purchase_price)}</td><td>${currency(purchaseValue)}</td><td>${currentPriceText}</td><td>${gainLossText}</td><td><button class="delete-btn" data-id="${inv.id}" type="button">Delete</button></td>`;
      tableBody.appendChild(tr);
    }

    const totalGainLoss = totalCurrentValue - totalPurchaseValue;
    const totalCurrentText = missingCurrentValues > 0 ? "N/A" : currency(totalCurrentValue);
    const totalGainLossText = missingCurrentValues > 0 ? "N/A" : `${totalGainLoss >= 0 ? "+" : ""}${currency(totalGainLoss)}`;
    const totalRow = document.createElement("tr");
    totalRow.className = "totals-row";
    totalRow.innerHTML = `<td colspan="4"><strong>Totals</strong></td><td><strong>${currency(totalPurchaseValue)}</strong></td><td><strong>${totalCurrentText}</strong></td><td><strong>${totalGainLossText}</strong></td><td></td>`;
    tableBody.appendChild(totalRow);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      ticker: document.getElementById("inv-ticker").value.trim().toUpperCase(),
      shares: Number(document.getElementById("inv-shares").value),
      purchasePrice: Number(document.getElementById("inv-price").value),
      purchaseDate: document.getElementById("inv-date").value,
    };
    const response = await apiFetch("/api/investments", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return setText(msg, data.error || "Unable to add investment.");
    form.reset();
    await loadInvestments();
    await renderTable();
    setText(msg, "Investment added.");
  });

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains("delete-btn")) return;
    const id = target.dataset.id;
    await apiFetch(`/api/investments/${id}`, { method: "DELETE" });
    await loadInvestments();
    await renderTable();
  });

  refreshBtn?.addEventListener("click", async () => {
    await loadInvestments();
    await renderTable();
    setText(msg, "Prices refreshed.");
  });

  return {
    render: async () => {
      await loadInvestments();
      await renderTable();
    },
  };
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
