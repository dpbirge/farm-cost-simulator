// Main application controller
// Wires UI elements to the cost model and chart rendering

// --- Application state ---

const APP = {
  priceData: [],
  currency: "USD",
  harvests: new Map(),
  timeSeries: [],
  advancedSettings: {
    et0: [...DEFAULT_ET0],
    kcStages: JSON.parse(JSON.stringify(DEFAULT_KC_STAGES)),
    yields: { ...DEFAULT_YIELDS },
    agronomic: { ...DEFAULT_AGRONOMIC },
  },
};


// --- Low-level: Read all slider values ---

function _readSliders() {
  const values = {};
  for (const def of SLIDER_DEFS) {
    values[def.id] = parseFloat(document.getElementById(`slider-${def.id}`).value);
  }
  return values;
}


// --- Low-level: Read planting selections (returns planting option keys) ---

function _readPlantSelections() {
  const a = document.getElementById("autumn-select").value;
  const s = document.getElementById("spring-select").value;
  return [a, s].filter(v => v !== "");
}


// --- Low-level: Convert planting keys to month indices for the cost model ---

function _keysToMonthIndices(keys) {
  return keys.map(key => {
    const opt = getPlantingOption(key);
    return opt ? opt.monthIdx : null;
  }).filter(v => v !== null);
}


// --- Low-level: Display error ---

function _showError(msg) {
  const el = document.getElementById("error-bar");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 5000);
}


// --- Low-level: Currency multiplier ---

function _getExchangeRate() {
  return APP.currency === "EGP" ? EXCHANGE_RATE : 1;
}


// --- Low-level: Format monetary value ---

function _fmtMoney(val) {
  const rate = _getExchangeRate();
  const scaled = val * rate;
  const symbol = APP.currency === "EGP" ? "EGP " : "$";
  if (Math.abs(scaled) >= 1000000) return symbol + (scaled / 1000000).toFixed(1) + "M";
  if (Math.abs(scaled) >= 1000) return symbol + (scaled / 1000).toFixed(1) + "k";
  return symbol + scaled.toFixed(2);
}


// --- Low-level: Format a single slider's display value ---

function _formatSliderDisplay(def, rawVal) {
  const scaledVal = rawVal * _getExchangeRate();
  const decimals = def.step < 1 ? String(def.step).split(".")[1].length : 0;
  return scaledVal >= 1000 ? Math.round(scaledVal).toLocaleString() : scaledVal.toFixed(decimals);
}


// --- Low-level: Update slider display values for current currency ---

function _updateSliderDisplays() {
  const currSymbol = APP.currency === "EGP" ? "EGP" : "$";

  for (const def of SLIDER_DEFS) {
    const slider = document.getElementById(`slider-${def.id}`);
    const display = document.getElementById(`val-${def.id}`);
    display.textContent = _formatSliderDisplay(def, parseFloat(slider.value));

    const unitSpan = document.querySelector(`label[for="slider-${def.id}"] .slider-unit`);
    if (unitSpan) {
      unitSpan.textContent = `(${def.unit.replace("$", currSymbol)})`;
    }
  }
}


// --- High-level: Main recalculation pipeline ---

function recalculate() {
  const sliderValues = _readSliders();
  const plantKeys = _readPlantSelections();
  const plantMonths = _keysToMonthIndices(plantKeys);

  // Calculate all harvests
  APP.harvests = calcAllHarvests({
    plantMonths,
    priceData: APP.priceData,
    sliderValues,
    et0: APP.advancedSettings.et0,
    kcStages: APP.advancedSettings.kcStages,
    yields: APP.advancedSettings.yields,
    agronomic: APP.advancedSettings.agronomic,
  });

  // Backcast theoretical cost/kg for every calendar month
  const theoreticalMonthlyCosts = calcTheoreticalMonthlyCosts({
    sliderValues,
    et0: APP.advancedSettings.et0,
    kcStages: APP.advancedSettings.kcStages,
    yields: APP.advancedSettings.yields,
    agronomic: APP.advancedSettings.agronomic,
  });

  // Build time series
  APP.timeSeries = buildCostTimeSeries({
    priceData: APP.priceData,
    harvests: APP.harvests,
    theoreticalMonthlyCosts,
  });

  // Update summary
  _updateSummary();

  // Render charts
  renderMainChart({
    timeSeries: APP.timeSeries,
    currencyLabel: APP.currency,
    exchangeRate: _getExchangeRate(),
  });

  renderTimeline({
    plantMonths,
    priceData: APP.priceData,
    kcStages: APP.advancedSettings.kcStages,
  });

  // Update results table
  document.getElementById("results-table-container").innerHTML = buildResultsTable({
    priceData: APP.priceData,
    harvests: APP.harvests,
    currencyLabel: APP.currency,
    exchangeRate: _getExchangeRate(),
  });
}


// --- High-level: Update summary banner ---

function _updateSummary() {
  const stats = calcSummaryStats(APP.harvests);
  document.getElementById("stat-revenue").textContent = _fmtMoney(stats.totalRevenue);
  document.getElementById("stat-costs").textContent = _fmtMoney(stats.totalCosts);

  const profitEl = document.getElementById("stat-profit");
  profitEl.textContent = _fmtMoney(stats.netProfit);
  profitEl.className = stats.netProfit >= 0 ? "stat-value profit-positive" : "stat-value profit-negative";

  document.getElementById("stat-cycles").textContent =
    `${stats.cyclesProfitable} / ${stats.totalCycles}`;
  document.getElementById("stat-avg-profit").textContent = _fmtMoney(stats.avgProfitPerCycle);

  const beEl = document.getElementById("stat-breakeven");
  const symbol = APP.currency === "EGP" ? "EGP " : "$";
  beEl.textContent = symbol + (stats.breakEvenPrice * _getExchangeRate()).toFixed(2) + "/kg";
}


// --- High-level: Initialize sliders ---

function initSliders() {
  const container = document.getElementById("sliders-container");
  container.innerHTML = "";

  for (const def of SLIDER_DEFS) {
    const decimals = def.step < 1 ? String(def.step).split(".")[1].length : 0;
    const div = document.createElement("div");
    div.className = "slider-group";
    div.innerHTML = `
      <label for="slider-${def.id}">${def.label}
        <span class="slider-unit">(${def.unit})</span>
      </label>
      <div class="slider-row">
        <input type="range" id="slider-${def.id}" min="${def.min}" max="${def.max}"
               step="${def.step}" value="${def.default}">
        <span class="slider-value" id="val-${def.id}">${def.default.toFixed ? def.default.toFixed(decimals) : def.default}</span>
      </div>
    `;
    container.appendChild(div);

    const slider = div.querySelector("input[type=range]");
    const display = div.querySelector(".slider-value");
    slider.addEventListener("input", () => {
      display.textContent = _formatSliderDisplay(def, parseFloat(slider.value));
      recalculate();
    });
  }
}


// --- High-level: Initialize planting dropdowns ---

function initPlantingDropdowns() {
  const autumnSelect = document.getElementById("autumn-select");
  const springSelect = document.getElementById("spring-select");

  // Populate autumn options
  autumnSelect.innerHTML = '<option value="">-- None --</option>';
  for (const opt of PLANTING_OPTIONS.autumn) {
    const el = document.createElement("option");
    el.value = opt.key;
    el.textContent = opt.label;
    autumnSelect.appendChild(el);
  }

  // Populate spring options
  springSelect.innerHTML = '<option value="">-- None --</option>';
  for (const opt of PLANTING_OPTIONS.spring) {
    const el = document.createElement("option");
    el.value = opt.key;
    el.textContent = opt.label;
    springSelect.appendChild(el);
  }

  autumnSelect.addEventListener("change", recalculate);
  springSelect.addEventListener("change", recalculate);

  // Defaults: Early September (autumn), Early February (spring)
  autumnSelect.value = "sep-early";
  springSelect.value = "feb-early";
}


// --- High-level: CSV upload handler ---

function initCSVUpload() {
  const input = document.getElementById("csv-upload");
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseCSV(ev.target.result);
      if (result.errors.length > 0) {
        _showError("CSV errors: " + result.errors.slice(0, 3).join(" | ") +
          (result.errors.length > 3 ? ` ... and ${result.errors.length - 3} more` : ""));
      }
      if (result.data.length === 0) {
        _showError("No valid data rows found. Expected format: header row then YYYY-MM,price_per_kg");
        return;
      }
      APP.priceData = result.data;
      recalculate();
    };
    reader.readAsText(file);
  });
}


// --- High-level: Currency toggle ---

function initCurrencyToggle() {
  const toggle = document.getElementById("currency-toggle");
  toggle.addEventListener("click", () => {
    APP.currency = APP.currency === "USD" ? "EGP" : "USD";
    toggle.textContent = APP.currency;
    toggle.classList.toggle("egp", APP.currency === "EGP");
    _updateSliderDisplays();
    recalculate();
  });
}


// --- High-level: Advanced settings panel ---

function initAdvancedSettings() {
  const toggle = document.getElementById("advanced-toggle");
  const panel = document.getElementById("advanced-panel");

  toggle.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    toggle.textContent = panel.classList.contains("collapsed")
      ? "Show Advanced Settings" : "Hide Advanced Settings";
  });

  // ET0 inputs
  const et0Container = document.getElementById("et0-inputs");
  for (let i = 0; i < 12; i++) {
    const div = document.createElement("div");
    div.className = "et0-input-group";
    div.innerHTML = `
      <label>${MONTH_NAMES[i]}</label>
      <input type="number" id="et0-${i}" value="${DEFAULT_ET0[i]}" min="0" max="400" step="1">
    `;
    et0Container.appendChild(div);
    div.querySelector("input").addEventListener("change", (e) => {
      APP.advancedSettings.et0[i] = parseFloat(e.target.value);
      recalculate();
    });
  }

  // Kc stages
  _initKcInputs("spring");
  _initKcInputs("autumn");

  // Yield inputs
  document.getElementById("yield-spring").value = DEFAULT_YIELDS.spring;
  document.getElementById("yield-autumn").value = DEFAULT_YIELDS.autumn;
  document.getElementById("yield-spring").addEventListener("change", (e) => {
    APP.advancedSettings.yields.spring = parseFloat(e.target.value);
    recalculate();
  });
  document.getElementById("yield-autumn").addEventListener("change", (e) => {
    APP.advancedSettings.yields.autumn = parseFloat(e.target.value);
    recalculate();
  });

  // Agronomic inputs
  const agFields = [
    { id: "labor-hours", key: "labor_hours_per_ha", val: DEFAULT_AGRONOMIC.labor_hours_per_ha },
    { id: "fert-rate", key: "fertilizer_kg_per_ha", val: DEFAULT_AGRONOMIC.fertilizer_kg_per_ha },
    { id: "seed-rate", key: "seed_kg_per_ha", val: DEFAULT_AGRONOMIC.seed_kg_per_ha },
    { id: "kwh-m3", key: "kwh_per_m3", val: DEFAULT_AGRONOMIC.kwh_per_m3 },
    { id: "irrig-eff", key: "irrigation_efficiency", val: DEFAULT_AGRONOMIC.irrigation_efficiency },
  ];

  for (const field of agFields) {
    const el = document.getElementById(field.id);
    el.value = field.val;
    el.addEventListener("change", (e) => {
      APP.advancedSettings.agronomic[field.key] = parseFloat(e.target.value);
      recalculate();
    });
  }
}

function _initKcInputs(season) {
  const stages = DEFAULT_KC_STAGES[season];
  const prefix = `kc-${season}`;

  document.getElementById(`${prefix}-ini-kc`).value = stages.initial.kc;
  document.getElementById(`${prefix}-ini-days`).value = stages.initial.days;
  document.getElementById(`${prefix}-dev-kc-start`).value = stages.development.kc_start;
  document.getElementById(`${prefix}-dev-kc-end`).value = stages.development.kc_end;
  document.getElementById(`${prefix}-dev-days`).value = stages.development.days;
  document.getElementById(`${prefix}-mid-kc`).value = stages.mid.kc;
  document.getElementById(`${prefix}-mid-days`).value = stages.mid.days;
  document.getElementById(`${prefix}-late-kc`).value = stages.late.kc;
  document.getElementById(`${prefix}-late-days`).value = stages.late.days;

  const fields = [
    { id: `${prefix}-ini-kc`, path: ["initial", "kc"] },
    { id: `${prefix}-ini-days`, path: ["initial", "days"] },
    { id: `${prefix}-dev-kc-start`, path: ["development", "kc_start"] },
    { id: `${prefix}-dev-kc-end`, path: ["development", "kc_end"] },
    { id: `${prefix}-dev-days`, path: ["development", "days"] },
    { id: `${prefix}-mid-kc`, path: ["mid", "kc"] },
    { id: `${prefix}-mid-days`, path: ["mid", "days"] },
    { id: `${prefix}-late-kc`, path: ["late", "kc"] },
    { id: `${prefix}-late-days`, path: ["late", "days"] },
  ];

  for (const f of fields) {
    document.getElementById(f.id).addEventListener("change", (e) => {
      APP.advancedSettings.kcStages[season][f.path[0]][f.path[1]] = parseFloat(e.target.value);
      recalculate();
    });
  }
}


// --- High-level: Download results CSV ---

function downloadResultsCSV() {
  if (APP.timeSeries.length === 0) {
    _showError("No data to download.");
    return;
  }
  const rate = _getExchangeRate();
  let csv = "date,market_price,harvest_cost_per_kg,theoretical_cost";
  csv += ",season,water_cost_ha,irrigation_cost_ha,energy_cost_ha,labor_cost_ha,fert_cost_ha,seed_cost_ha,pest_cost_ha,other_cost_ha,total_cost_ha,yield_kg_ha,cost_per_kg,revenue_ha,profit_ha\n";

  for (const point of APP.timeSeries) {
    const h = APP.harvests.get(point.date);
    csv += `${point.date},${(point.marketPrice * rate).toFixed(4)}`;
    csv += `,${point.costPerKg !== null ? (point.costPerKg * rate).toFixed(4) : ""}`;
    csv += `,${point.theoreticalCostPerKg !== null ? (point.theoreticalCostPerKg * rate).toFixed(4) : ""}`;

    if (h) {
      csv += `,${h.season}`;
      csv += `,${(h.breakdown.water * rate).toFixed(2)}`;
      csv += `,${(h.breakdown.irrigation * rate).toFixed(2)}`;
      csv += `,${(h.breakdown.energy * rate).toFixed(2)}`;
      csv += `,${(h.breakdown.labor * rate).toFixed(2)}`;
      csv += `,${(h.breakdown.fertilizer * rate).toFixed(2)}`;
      csv += `,${(h.breakdown.seed * rate).toFixed(2)}`;
      csv += `,${(h.breakdown.pest * rate).toFixed(2)}`;
      csv += `,${(h.breakdown.other * rate).toFixed(2)}`;
      csv += `,${(h.totalCostPerHa * rate).toFixed(2)}`;
      csv += `,${h.yieldKgPerHa}`;
      csv += `,${(h.costPerKg * rate).toFixed(4)}`;
      csv += `,${(h.revenuePerHa * rate).toFixed(2)}`;
      csv += `,${(h.profitPerHa * rate).toFixed(2)}`;
    } else {
      csv += ",,,,,,,,,,,,,,";
    }
    csv += "\n";
  }

  _downloadFile(csv, "farm-cost-results.csv", "text/csv");
}


// --- High-level: Download settings file ---

function downloadSettings() {
  const sliders = _readSliders();
  const plantKeys = _readPlantSelections();
  const adv = APP.advancedSettings;
  const rate = _getExchangeRate();

  let text = "=== Tomato Farming Simulator Settings ===\n";
  text += `Generated: ${new Date().toISOString()}\n`;
  text += `Currency: ${APP.currency} (rate: ${rate})\n\n`;

  text += "--- Slider Values ---\n";
  for (const def of SLIDER_DEFS) {
    text += `${def.label}: ${sliders[def.id]} ${def.unit}\n`;
  }

  text += "\n--- Planting Selections ---\n";
  for (const key of plantKeys) {
    const opt = getPlantingOption(key);
    if (opt) text += `${opt.season}: ${opt.label}\n`;
  }

  text += "\n--- Monthly ET0 (mm/month) ---\n";
  for (let i = 0; i < 12; i++) {
    text += `${MONTH_NAMES[i]}: ${adv.et0[i]}\n`;
  }

  text += "\n--- Kc Stages (Spring) ---\n";
  const sp = adv.kcStages.spring;
  text += `Initial: Kc=${sp.initial.kc}, ${sp.initial.days} days\n`;
  text += `Development: Kc=${sp.development.kc_start}->${sp.development.kc_end}, ${sp.development.days} days\n`;
  text += `Mid: Kc=${sp.mid.kc}, ${sp.mid.days} days\n`;
  text += `Late: Kc=${sp.late.kc}, ${sp.late.days} days\n`;

  text += "\n--- Kc Stages (Autumn) ---\n";
  const au = adv.kcStages.autumn;
  text += `Initial: Kc=${au.initial.kc}, ${au.initial.days} days\n`;
  text += `Development: Kc=${au.development.kc_start}->${au.development.kc_end}, ${au.development.days} days\n`;
  text += `Mid: Kc=${au.mid.kc}, ${au.mid.days} days\n`;
  text += `Late: Kc=${au.late.kc}, ${au.late.days} days\n`;

  text += "\n--- Yields ---\n";
  text += `Spring: ${adv.yields.spring} kg/ha\n`;
  text += `Autumn: ${adv.yields.autumn} kg/ha\n`;

  text += "\n--- Agronomic Parameters ---\n";
  text += `Labor: ${adv.agronomic.labor_hours_per_ha} hrs/ha\n`;
  text += `Fertilizer: ${adv.agronomic.fertilizer_kg_per_ha} kg/ha\n`;
  text += `Seed: ${adv.agronomic.seed_kg_per_ha} kg/ha\n`;
  text += `Pumping energy: ${adv.agronomic.kwh_per_m3} kWh/m3\n`;
  text += `Irrigation efficiency: ${adv.agronomic.irrigation_efficiency}\n`;

  _downloadFile(text, "farm-cost-settings.txt", "text/plain");
}


// --- Low-level: Trigger browser download ---

function _downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


// --- Tooltip system (appended to body, always on top) ---

function initTooltips() {
  const tip = document.createElement("div");
  tip.className = "app-tooltip";
  document.body.appendChild(tip);

  let showTimer = null;

  function show(el) {
    clearTimeout(showTimer);
    const text = el.getAttribute("data-tooltip");
    if (!text) return;

    tip.textContent = text;
    tip.classList.remove("visible");

    showTimer = setTimeout(() => {
      // Position: prefer below the element, shift horizontally to stay in viewport
      const rect = el.getBoundingClientRect();
      const gap = 10;

      tip.style.left = "0px";
      tip.style.top = "0px";
      tip.classList.add("visible");

      const tipRect = tip.getBoundingClientRect();

      // Vertical: below if room, else above
      let top = rect.bottom + gap;
      if (top + tipRect.height > window.innerHeight) {
        top = rect.top - tipRect.height - gap;
      }
      if (top < 0) top = gap;

      // Horizontal: centered on element, clamped to viewport
      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      left = Math.max(gap, Math.min(left, window.innerWidth - tipRect.width - gap));

      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }, 1000);
  }

  function hide() {
    clearTimeout(showTimer);
    tip.classList.remove("visible");
  }

  document.querySelectorAll("[data-tooltip]").forEach(el => {
    el.addEventListener("mouseenter", () => show(el));
    el.addEventListener("mouseleave", hide);
    el.addEventListener("click", hide);
  });
}


// --- App initialization ---

function initApp() {
  initSliders();
  initPlantingDropdowns();
  initCSVUpload();
  initCurrencyToggle();
  initAdvancedSettings();
  initTooltips();

  // Wire download buttons
  document.getElementById("dl-results-btn").addEventListener("click", downloadResultsCSV);
  document.getElementById("dl-settings-btn").addEventListener("click", downloadSettings);

  // Load hardcoded price data and run initial calculation
  APP.priceData = SAMPLE_PRICE_DATA.map(d => ({ ...d }));
  recalculate();
}

document.addEventListener("DOMContentLoaded", initApp);
