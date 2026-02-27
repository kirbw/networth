const GOAL_PERCENT = 0.1;

const form = document.getElementById("finance-form");
const recordsBody = document.getElementById("records-body");
const clearButton = document.getElementById("clear-data");
const formMessage = document.getElementById("form-message");
const goalIndicator = document.getElementById("goal-indicator");
const yearInput = document.getElementById("year");
const yearOptions = document.getElementById("year-options");
const incomeInput = document.getElementById("income");
const donationInput = document.getElementById("donation");
const netWorthInput = document.getElementById("netWorth");
const saveButton = document.getElementById("save-btn");

let records = [];
let incomeGivingChart;
let netWorthChart;
let goalProgressChart;
let editingYear = null;

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function sortRecords() {
  records.sort((a, b) => a.year - b.year);
}

function populateYearOptions() {
  const startYear = 1970;
  const currentYear = new Date().getFullYear();
  yearOptions.innerHTML = "";

  for (let year = currentYear + 1; year >= startYear; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    yearOptions.appendChild(option);
  }
}

function formatNetWorth(value) {
  if (value === null || value === undefined) return "—";
  return currency(value);
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
  netWorthInput.value = record.netWorth === null || record.netWorth === undefined ? "" : String(record.netWorth);
  saveButton.textContent = "Update Year";
  setMessage(`Editing ${year}. Update the fields and click Update Year.`);
  yearInput.focus();
}

function renderTable() {
  sortRecords();
  recordsBody.innerHTML = "";

  if (!records.length) {
    recordsBody.innerHTML = `<tr><td colspan="5">No annual records yet.</td></tr>`;
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${record.year}</td>
      <td>${currency(record.income)}</td>
      <td>${currency(record.donation)}</td>
      <td>${formatNetWorth(record.netWorth)}</td>
      <td>
        <button class="edit-btn" data-year="${record.year}" type="button">Edit</button>
        <button class="delete-btn" data-year="${record.year}" type="button">Delete</button>
      </td>
    `;
    recordsBody.appendChild(row);
  });
}

function destroyIfExists(existingChart) {
  if (existingChart) existingChart.destroy();
}

function createIncomeGivingChart() {
  const labels = records.map((entry) => entry.year);
  const incomeData = records.map((entry) => entry.income);
  const donationData = records.map((entry) => entry.donation);

  destroyIfExists(incomeGivingChart);
  const ctx = document.getElementById("income-giving-chart").getContext("2d");
  incomeGivingChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Income",
          data: incomeData,
          borderColor: "#3956f6",
          backgroundColor: "#3956f633",
          tension: 0.2,
        },
        {
          label: "Donations",
          data: donationData,
          borderColor: "#00a76f",
          backgroundColor: "#00a76f33",
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: {
          ticks: { callback: (value) => currency(value) },
        },
      },
    },
  });
}

function createNetWorthChart() {
  const netWorthRecords = records.filter((entry) => entry.netWorth !== null && entry.netWorth !== undefined);
  const labels = netWorthRecords.map((entry) => entry.year);
  const netWorthData = netWorthRecords.map((entry) => entry.netWorth);

  destroyIfExists(netWorthChart);
  const ctx = document.getElementById("net-worth-chart").getContext("2d");
  netWorthChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Net Worth",
          data: netWorthData,
          borderColor: "#9747ff",
          backgroundColor: "#9747ff33",
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: {
          ticks: { callback: (value) => currency(value) },
        },
      },
    },
  });
}

function createGoalChartAndIndicator() {
  const labels = records.map((entry) => entry.year);
  let cumulativeIncome = 0;
  let cumulativeDonations = 0;

  const cumulativeIncomeData = [];
  const cumulativeDonationsData = [];
  const targetData = [];

  records.forEach((entry) => {
    cumulativeIncome += Number(entry.income);
    cumulativeDonations += Number(entry.donation);
    cumulativeIncomeData.push(cumulativeIncome);
    cumulativeDonationsData.push(cumulativeDonations);
    targetData.push(cumulativeIncome * GOAL_PERCENT);
  });

  const givingRate = cumulativeIncome > 0 ? cumulativeDonations / cumulativeIncome : 0;
  const trackClass = givingRate >= GOAL_PERCENT ? "on-track" : "off-track";
  goalIndicator.className = `goal-indicator ${trackClass}`;
  goalIndicator.textContent = `Cumulative giving rate: ${percent(givingRate)} (${currency(cumulativeDonations)} donated of ${currency(cumulativeIncome)} income). Goal: at least ${percent(GOAL_PERCENT)}.`;

  destroyIfExists(goalProgressChart);
  const ctx = document.getElementById("goal-progress-chart").getContext("2d");
  goalProgressChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Cumulative Income",
          data: cumulativeIncomeData,
          borderColor: "#3956f6",
          backgroundColor: "#3956f633",
          tension: 0.2,
        },
        {
          label: "Cumulative Donations",
          data: cumulativeDonationsData,
          borderColor: "#00a76f",
          backgroundColor: "#00a76f33",
          tension: 0.2,
        },
        {
          label: "10% Giving Target",
          data: targetData,
          borderColor: "#f08c00",
          borderDash: [6, 6],
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: {
          ticks: { callback: (value) => currency(value) },
        },
      },
    },
  });
}

function renderCharts() {
  sortRecords();
  createIncomeGivingChart();
  createNetWorthChart();
  createGoalChartAndIndicator();
}

function setMessage(text) {
  formMessage.textContent = text;
}

async function loadRecords() {
  try {
    const response = await fetch("/api/records");
    if (!response.ok) throw new Error("load failed");
    records = await response.json();
    renderTable();
    renderCharts();
  } catch {
    setMessage("Unable to load records from database.");
  }
}

async function saveRecord(payload) {
  const response = await fetch("/api/records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("save failed");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const year = Number(formData.get("year"));
  const income = Number(formData.get("income"));
  const donation = Number(formData.get("donation"));
  const netWorthRaw = String(formData.get("netWorth") ?? "").trim();
  const netWorth = netWorthRaw === "" ? null : Number(netWorthRaw);

  if (!year || year < 1970 || income < 0 || donation < 0 || (netWorth !== null && Number.isNaN(netWorth))) {
    setMessage("Please enter valid values for all fields.");
    return;
  }

  const existing = records.find((record) => record.year === year);

  try {
    await saveRecord({ year, income, donation, netWorth });

    if (editingYear !== null && editingYear !== year) {
      const deleteOldResponse = await fetch(`/api/records/${editingYear}`, { method: "DELETE" });
      if (!deleteOldResponse.ok) {
        throw new Error("delete old failed");
      }
    }

    const message = editingYear !== null
      ? `Updated records for ${editingYear}${editingYear !== year ? ` → ${year}` : ""}.`
      : existing
        ? `Updated records for ${year}.`
        : `Saved records for ${year}.`;

    setMessage(message);
    form.reset();
    setFormModeDefault();
    await loadRecords();
  } catch {
    setMessage("Unable to save record to database.");
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

  if (!target.classList.contains("delete-btn")) return;

  try {
    const response = await fetch(`/api/records/${year}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("delete failed");

    if (editingYear === year) {
      form.reset();
      setFormModeDefault();
    }

    setMessage(`Deleted records for ${year}.`);
    await loadRecords();
  } catch {
    setMessage("Unable to delete record from database.");
  }
});

clearButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/records", {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("clear failed");

    form.reset();
    setFormModeDefault();
    setMessage("Cleared all saved data.");
    await loadRecords();
  } catch {
    setMessage("Unable to clear records from database.");
  }
});

populateYearOptions();
setFormModeDefault();
loadRecords();
