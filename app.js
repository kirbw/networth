const DEFAULT_GOAL_PERCENT = 10;

const authCard = document.getElementById("auth-card");
const appShell = document.getElementById("app-shell");
const adminCard = document.getElementById("admin-card");
const sessionUser = document.getElementById("session-user");

const loginForm = document.getElementById("login-form");
const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");
const loginMessage = document.getElementById("login-message");
const logoutBtn = document.getElementById("logout-btn");

const createUserForm = document.getElementById("create-user-form");
const resetPasswordForm = document.getElementById("reset-password-form");
const newUsername = document.getElementById("new-username");
const newPassword = document.getElementById("new-password");
const newRole = document.getElementById("new-role");
const resetUserId = document.getElementById("reset-user-id");
const resetPassword = document.getElementById("reset-password");
const adminMessage = document.getElementById("admin-message");

const form = document.getElementById("finance-form");
const recordsBody = document.getElementById("records-body");
const clearButton = document.getElementById("clear-data");
const formMessage = document.getElementById("form-message");
const goalIndicator = document.getElementById("goal-indicator");
const goalPercentInput = document.getElementById("goal-percent-input");
const yearInput = document.getElementById("year");
const yearOptions = document.getElementById("year-options");
const incomeInput = document.getElementById("income");
const donationInput = document.getElementById("donation");
const netWorthInput = document.getElementById("netWorth");
const saveButton = document.getElementById("save-btn");

let currentUser = null;
let records = [];
let users = [];
let incomeGivingChart;
let netWorthChart;
let goalProgressChart;
let editingYear = null;
let goalPercent = DEFAULT_GOAL_PERCENT;

function goalStorageKey() {
  return currentUser ? `giving-goal-percent:${currentUser.username}` : "giving-goal-percent:anonymous";
}

function getStoredGoalPercent() {
  const parsed = Number(localStorage.getItem(goalStorageKey()));
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) return DEFAULT_GOAL_PERCENT;
  return parsed;
}

function setStoredGoalPercent(value) {
  localStorage.setItem(goalStorageKey(), String(value));
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
}

function currency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function goalRatio() {
  return goalPercent / 100;
}

function setMessage(el, text) {
  el.textContent = text;
}

function populateYearOptions() {
  const startYear = 1970;
  const currentYearValue = new Date().getFullYear();
  yearOptions.innerHTML = "";
  for (let year = currentYearValue + 1; year >= startYear; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    yearOptions.appendChild(option);
  }
}

function sortRecords() {
  records.sort((a, b) => a.year - b.year);
}

function destroyIfExists(chart) {
  if (chart) chart.destroy();
}

function formatNetWorth(value) {
  return value === null || value === undefined ? "—" : currency(value);
}

function setFormModeDefault() {
  editingYear = null;
  saveButton.textContent = "Save Year";
}

function startEditingRecord(year) {
  const record = records.find((entry) => entry.year === year);
  if (!record) return;
  editingYear = year;
  yearInput.value = String(record.year);
  incomeInput.value = String(record.income);
  donationInput.value = String(record.donation);
  netWorthInput.value = record.netWorth == null ? "" : String(record.netWorth);
  saveButton.textContent = "Update Year";
  setMessage(formMessage, `Editing ${year}. Update fields then click Update Year.`);
}

function renderTable() {
  sortRecords();
  recordsBody.innerHTML = "";
  if (!records.length) {
    recordsBody.innerHTML = `<tr><td colspan="5">No annual records yet.</td></tr>`;
    return;
  }

  for (const record of records) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${record.year}</td><td>${currency(record.income)}</td><td>${currency(record.donation)}</td><td>${formatNetWorth(record.netWorth)}</td><td><button class="edit-btn" data-year="${record.year}" type="button">Edit</button><button class="delete-btn" data-year="${record.year}" type="button">Delete</button></td>`;
    recordsBody.appendChild(row);
  }
}

function createIncomeGivingChart() {
  destroyIfExists(incomeGivingChart);
  incomeGivingChart = new Chart(document.getElementById("income-giving-chart").getContext("2d"), {
    type: "line",
    data: {
      labels: records.map((r) => r.year),
      datasets: [
        { label: "Income", data: records.map((r) => r.income), borderColor: "#3956f6", backgroundColor: "#3956f633", tension: 0.2 },
        { label: "Donations", data: records.map((r) => r.donation), borderColor: "#00a76f", backgroundColor: "#00a76f33", tension: 0.2 },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v) => currency(v) } } } },
  });
}

function createNetWorthChart() {
  destroyIfExists(netWorthChart);
  const nw = records.filter((r) => r.netWorth != null);
  netWorthChart = new Chart(document.getElementById("net-worth-chart").getContext("2d"), {
    type: "line",
    data: { labels: nw.map((r) => r.year), datasets: [{ label: "Net Worth", data: nw.map((r) => r.netWorth), borderColor: "#9747ff", backgroundColor: "#9747ff33", tension: 0.2 }] },
    options: { responsive: true, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v) => currency(v) } } } },
  });
}

function createGoalChartAndIndicator() {
  let cumulativeIncome = 0;
  let cumulativeDonations = 0;
  const incomeSeries = [];
  const donationSeries = [];
  const targetSeries = [];

  for (const r of records) {
    cumulativeIncome += Number(r.income);
    cumulativeDonations += Number(r.donation);
    incomeSeries.push(cumulativeIncome);
    donationSeries.push(cumulativeDonations);
    targetSeries.push(cumulativeIncome * goalRatio());
  }

  const targetAmount = cumulativeIncome * goalRatio();
  const needed = Math.max(0, targetAmount - cumulativeDonations);
  const givingRate = cumulativeIncome > 0 ? cumulativeDonations / cumulativeIncome : 0;

  goalIndicator.className = `goal-indicator ${givingRate >= goalRatio() ? "on-track" : "off-track"}`;
  goalIndicator.innerHTML = `<div>Cumulative giving rate: ${percent(givingRate)} (${currency(cumulativeDonations)} of ${currency(cumulativeIncome)} income).</div><div>Goal: ${goalPercent.toFixed(1)}% (${currency(targetAmount)} target). Needed to reach goal: ${currency(needed)}.</div>`;

  destroyIfExists(goalProgressChart);
  goalProgressChart = new Chart(document.getElementById("goal-progress-chart").getContext("2d"), {
    type: "line",
    data: {
      labels: records.map((r) => r.year),
      datasets: [
        { label: "Cumulative Income", data: incomeSeries, borderColor: "#3956f6", backgroundColor: "#3956f633", tension: 0.2 },
        { label: "Cumulative Donations", data: donationSeries, borderColor: "#00a76f", backgroundColor: "#00a76f33", tension: 0.2 },
        { label: `${goalPercent.toFixed(1)}% Giving Target`, data: targetSeries, borderColor: "#f08c00", borderDash: [6, 6], pointRadius: 0, tension: 0 },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v) => currency(v) } } } },
  });
}

function renderCharts() {
  sortRecords();
  createIncomeGivingChart();
  createNetWorthChart();
  createGoalChartAndIndicator();
}

async function loadRecords() {
  const response = await apiFetch("/api/records", { method: "GET", headers: {} });
  if (!response.ok) throw new Error("Unable to load records");
  records = await response.json();
  renderTable();
  renderCharts();
}

async function loadAdminUsers() {
  if (!currentUser || currentUser.role !== "admin") return;
  const response = await apiFetch("/api/admin/users", { method: "GET", headers: {} });
  if (!response.ok) throw new Error("Unable to load users");
  users = await response.json();

  resetUserId.innerHTML = "";
  for (const user of users) {
    const option = document.createElement("option");
    option.value = String(user.id);
    option.textContent = `${user.username} (${user.role})`;
    resetUserId.appendChild(option);
  }
}

function renderAuthState() {
  if (!currentUser) {
    authCard.classList.remove("hidden");
    appShell.classList.add("hidden");
    return;
  }

  authCard.classList.add("hidden");
  appShell.classList.remove("hidden");
  sessionUser.textContent = `Logged in as ${currentUser.username} (${currentUser.role})`;
  adminCard.classList.toggle("hidden", currentUser.role !== "admin");
  goalPercent = getStoredGoalPercent();
  goalPercentInput.value = goalPercent.toFixed(1);
}

async function bootstrap() {
  try {
    const me = await apiFetch("/api/me", { method: "GET", headers: {} });
    const payload = await me.json();
    currentUser = payload.authenticated ? payload.user : null;
    renderAuthState();
    if (currentUser) {
      await loadRecords();
      await loadAdminUsers();
    }
  } catch {
    setMessage(loginMessage, "Unable to connect to server.");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await apiFetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: loginUsername.value.trim(), password: loginPassword.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Login failed");

    currentUser = payload.user;
    loginForm.reset();
    setMessage(loginMessage, "");
    renderAuthState();
    await loadRecords();
    await loadAdminUsers();
  } catch (error) {
    setMessage(loginMessage, error.message || "Login failed");
  }
});

logoutBtn.addEventListener("click", async () => {
  await apiFetch("/api/logout", { method: "POST", body: JSON.stringify({}) });
  currentUser = null;
  records = [];
  users = [];
  setFormModeDefault();
  renderAuthState();
});

createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await apiFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: newUsername.value.trim(), password: newPassword.value, role: newRole.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to create user");

    createUserForm.reset();
    setMessage(adminMessage, "User created.");
    await loadAdminUsers();
  } catch (error) {
    setMessage(adminMessage, error.message || "Unable to create user");
  }
});

resetPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await apiFetch(`/api/admin/users/${resetUserId.value}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password: resetPassword.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to reset password");

    resetPasswordForm.reset();
    setMessage(adminMessage, "Password reset successfully.");
  } catch (error) {
    setMessage(adminMessage, error.message || "Unable to reset password");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const year = Number(yearInput.value);
  const income = Number(incomeInput.value);
  const donation = Number(donationInput.value);
  const netWorthRaw = netWorthInput.value.trim();
  const netWorth = netWorthRaw === "" ? null : Number(netWorthRaw);

  if (!year || year < 1970 || income < 0 || donation < 0 || (netWorth !== null && Number.isNaN(netWorth))) {
    setMessage(formMessage, "Please enter valid values for all fields.");
    return;
  }

  try {
    const saveResponse = await apiFetch("/api/records", {
      method: "POST",
      body: JSON.stringify({ year, income, donation, netWorth }),
    });
    const payload = await saveResponse.json();
    if (!saveResponse.ok) throw new Error(payload.error || "Unable to save");

    if (editingYear !== null && editingYear !== year) {
      await apiFetch(`/api/records/${editingYear}`, { method: "DELETE", headers: {} });
    }

    setMessage(formMessage, editingYear !== null ? "Record updated." : "Record saved.");
    form.reset();
    setFormModeDefault();
    await loadRecords();
  } catch (error) {
    setMessage(formMessage, error.message || "Unable to save record.");
  }
});

recordsBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const year = Number(target.dataset.year);
  if (target.classList.contains("edit-btn")) {
    startEditingRecord(year);
    return;
  }

  if (target.classList.contains("delete-btn")) {
    await apiFetch(`/api/records/${year}`, { method: "DELETE", headers: {} });
    if (editingYear === year) {
      form.reset();
      setFormModeDefault();
    }
    await loadRecords();
  }
});

clearButton.addEventListener("click", async () => {
  await apiFetch("/api/records", { method: "DELETE", headers: {} });
  form.reset();
  setFormModeDefault();
  setMessage(formMessage, "Cleared all saved data.");
  await loadRecords();
});

goalPercentInput.addEventListener("change", () => {
  const value = Number(goalPercentInput.value);
  if (Number.isNaN(value) || value < 0 || value > 100) {
    goalPercentInput.value = goalPercent.toFixed(1);
    setMessage(formMessage, "Goal percentage must be between 0 and 100.");
    return;
  }
  goalPercent = value;
  setStoredGoalPercent(goalPercent);
  renderCharts();
});

populateYearOptions();
setFormModeDefault();
bootstrap();
