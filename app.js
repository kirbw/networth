const STORAGE_KEY = "annual-finance-records";

const form = document.getElementById("finance-form");
const recordsBody = document.getElementById("records-body");
const clearButton = document.getElementById("clear-data");
const formMessage = document.getElementById("form-message");

let records = loadRecords();
let chart;

function loadRecords() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function sortRecords() {
  records.sort((a, b) => a.year - b.year);
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
      <td>${currency(record.netWorth)}</td>
      <td><button class="delete-btn" data-year="${record.year}" type="button">Delete</button></td>
    `;
    recordsBody.appendChild(row);
  });
}

function renderChart() {
  sortRecords();

  const labels = records.map((entry) => entry.year);
  const incomeData = records.map((entry) => entry.income);
  const donationData = records.map((entry) => entry.donation);
  const netWorthData = records.map((entry) => entry.netWorth);

  if (chart) {
    chart.destroy();
  }

  const ctx = document.getElementById("finance-chart").getContext("2d");
  chart = new Chart(ctx, {
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
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "bottom",
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => currency(value),
          },
        },
      },
    },
  });
}

function setMessage(text) {
  formMessage.textContent = text;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const year = Number(formData.get("year"));
  const income = Number(formData.get("income"));
  const donation = Number(formData.get("donation"));
  const netWorth = Number(formData.get("netWorth"));

  if (!year || income < 0 || donation < 0 || Number.isNaN(netWorth)) {
    setMessage("Please enter valid values for all fields.");
    return;
  }

  const existing = records.find((record) => record.year === year);

  if (existing) {
    existing.income = income;
    existing.donation = donation;
    existing.netWorth = netWorth;
    setMessage(`Updated records for ${year}.`);
  } else {
    records.push({ year, income, donation, netWorth });
    setMessage(`Saved records for ${year}.`);
  }

  saveRecords();
  renderTable();
  renderChart();
  form.reset();
});

recordsBody.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement)) return;
  if (!target.classList.contains("delete-btn")) return;

  const year = Number(target.dataset.year);
  records = records.filter((record) => record.year !== year);

  saveRecords();
  renderTable();
  renderChart();
  setMessage(`Deleted records for ${year}.`);
});

clearButton.addEventListener("click", () => {
  records = [];
  saveRecords();
  renderTable();
  renderChart();
  setMessage("Cleared all saved data.");
});

renderTable();
renderChart();
