// Crop lookup tables, FAO reference data, and hardcoded price data

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const EXCHANGE_RATE = 52.27; // USD to EGP

// Monthly reference evapotranspiration (mm/month) - El-Arish station, Eastern Sinai
// Source: FAO CLIMWAT / Penman-Monteith calculation
const DEFAULT_ET0 = [91, 98, 140, 173, 215, 219, 226, 213, 177, 154, 117, 99];

// FAO-56 Kc growth stage definitions for tomatoes
const DEFAULT_KC_STAGES = {
  spring: {
    initial:     { kc: 0.60, days: 30 },
    development: { kc_start: 0.60, kc_end: 1.15, days: 40 },
    mid:         { kc: 1.15, days: 40 },
    late:        { kc: 0.80, days: 25 },
  },
  autumn: {
    initial:     { kc: 0.60, days: 35 },
    development: { kc_start: 0.60, kc_end: 1.15, days: 45 },
    mid:         { kc: 1.15, days: 70 },
    late:        { kc: 0.80, days: 30 },
  },
};

const MS_PER_DAY = 86400000;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function _totalKcDays(kcStages) {
  return kcStages.initial.days + kcStages.development.days +
         kcStages.mid.days + kcStages.late.days;
}

// Yields in kg/ha
const DEFAULT_YIELDS = { spring: 35000, autumn: 30000 };

// Feasible planting options with day-of-month offsets for Early/Mid/Late
// Each option: { key, label, monthIdx (0-indexed), dayOfMonth, season }
const PLANTING_OPTIONS = {
  autumn: [
    { key: "aug-late",  label: "Late August",      monthIdx: 7,  dayOfMonth: 20, season: "autumn" },
    { key: "sep-early", label: "Early September",   monthIdx: 8,  dayOfMonth: 1,  season: "autumn" },
    { key: "sep-mid",   label: "Mid September",     monthIdx: 8,  dayOfMonth: 15, season: "autumn" },
    { key: "oct-early", label: "Early October",      monthIdx: 9,  dayOfMonth: 1,  season: "autumn" },
    { key: "oct-mid",   label: "Mid October",        monthIdx: 9,  dayOfMonth: 15, season: "autumn" },
  ],
  spring: [
    { key: "jan-late",  label: "Late January",       monthIdx: 0,  dayOfMonth: 20, season: "spring" },
    { key: "feb-early", label: "Early February",     monthIdx: 1,  dayOfMonth: 1,  season: "spring" },
    { key: "feb-mid",   label: "Mid February",       monthIdx: 1,  dayOfMonth: 15, season: "spring" },
    { key: "mar-early", label: "Early March",        monthIdx: 2,  dayOfMonth: 1,  season: "spring" },
    { key: "mar-mid",   label: "Mid March",          monthIdx: 2,  dayOfMonth: 15, season: "spring" },
  ],
};

// Per-hectare agronomic defaults
// Source: FAO data, Egyptian agricultural extension, IFAS/UF labor studies
const DEFAULT_AGRONOMIC = {
  labor_hours_per_ha: 450,
  fertilizer_kg_per_ha: 450,
  seed_kg_per_ha: 0.4,
  kwh_per_m3: 0.10,
  irrigation_efficiency: 0.90,
  area_ha: 1.0,
};

// Monthly labor distribution by activity type (fraction of total hours per growth stage)
// Source: FAO Crop Calendar / IFAS Extension labor budgets for staked fresh-market tomato
// Activities are mapped to crop growth stages (Kc stages), then distributed to calendar months.
// Fractions sum to 1.0 across all activities.
const LABOR_ACTIVITIES = [
  { name: "Land Prep & Planting", fraction: 0.14, stage: "initial",     stageSpan: [0.0, 0.5] },
  { name: "Transplant & Staking", fraction: 0.10, stage: "initial",     stageSpan: [0.5, 1.0] },
  { name: "Irrigation Mgmt",      fraction: 0.12, stage: "all" },
  { name: "Fertigation & Spray",  fraction: 0.10, stage: "all" },
  { name: "Pruning & Training",   fraction: 0.14, stage: "development", stageSpan: [0.0, 1.0] },
  { name: "Pest Scouting",        fraction: 0.08, stage: "all" },
  { name: "Harvesting",           fraction: 0.22, stage: "mid",         stageSpan: [0.3, 1.0] },
  { name: "Post-Harvest & Maint", fraction: 0.10, stage: "late",        stageSpan: [0.0, 1.0] },
];

// Slider definitions: id, label, unit, min, max, step, default
// Defaults based on deep research into eastern Sinai / Egypt conditions:
//   LCOW: $0.60-2.50/m3 — brackish groundwater RO ($0.60-1.20) to seawater RO ($0.91-1.60)
//   LCOE: $0.03-0.25/kWh — grid subsidy ($0.038) to diesel gen ($0.15-0.25), solar PV ($0.05-0.10)
//   LCOI: $300-900/ha/season — drip system amortization (Ali 2020: $456/ha Egyptian tomato avg)
//   Labor: $0.55-1.10/hr — Bedouin community ($0.55) to hired seasonal ($1.09), legal min EGP 28/hr
//   Fertilizer: $0.40-0.75/kg — blended NPK at Sinai prices with 20% transport premium
//   Seed: $800-4500/kg — basic hybrid ($2/1000 seeds) to premium ($15/1000 seeds)
//   Packaging: $0.02-0.10/kg — local El-Arish ($0.02) to Cairo/Obour wholesale ($0.09)
// Ranges have 15% buffer added on each end, then clamped to avoid negatives.
const SLIDER_DEFS = [
  { id: "lcow",       label: "Levelized Cost of Water",              unit: "$/m\u00B3",     min: 0.19, max: 2.88,    step: 0.01,  default: 0.46 },
  { id: "lcoe",       label: "Levelized Cost of Energy",             unit: "$/kWh",          min: 0.000, max: 0.29,   step: 0.001, default: 0.08 },
  { id: "lcoi",       label: "Levelized Cost of Irrigation",         unit: "$/ha",           min: 255,  max: 1035,    step: 5,     default: 500  },
  { id: "labor_rate", label: "Labor Rate",                            unit: "$/hr",           min: 0.47, max: 10.00,   step: 0.01,  default: 0.75 },
  { id: "fert_price", label: "Fertilizer Price",                      unit: "$/kg",           min: 0.34, max: 0.86,    step: 0.01,  default: 0.55 },
  { id: "seed_price", label: "Seed Price",                            unit: "$/kg seed",      min: 680,  max: 5175,    step: 10,    default: 2000 },
  { id: "pkg_ship",   label: "Packaging & Shipping",                  unit: "$/kg",           min: 0.02, max: 0.12,    step: 0.01,  default: 0.05 },
  { id: "pest_cost", label: "Pest & Disease Control",                unit: "$/ha",           min: 128,  max: 920,     step: 5,     default: 350  },
  { id: "other_cost",label: "Additional Costs",                      unit: "$/ha",           min: 0,    max: 20000,   step: 100,   default: 15000},
];

// Hardcoded tomato price data (Eastern Sinai market, USD/kg)
const SAMPLE_PRICE_DATA = [
  { date: "2019-01", year: 2019, month: 1, price: 0.180 },
  { date: "2019-02", year: 2019, month: 2, price: 0.168 },
  { date: "2019-03", year: 2019, month: 3, price: 0.192 },
  { date: "2019-04", year: 2019, month: 4, price: 0.269 },
  { date: "2019-05", year: 2019, month: 5, price: 0.299 },
  { date: "2019-06", year: 2019, month: 6, price: 0.251 },
  { date: "2019-07", year: 2019, month: 7, price: 0.228 },
  { date: "2019-08", year: 2019, month: 8, price: 0.216 },
  { date: "2019-09", year: 2019, month: 9, price: 0.287 },
  { date: "2019-10", year: 2019, month: 10, price: 0.311 },
  { date: "2019-11", year: 2019, month: 11, price: 0.240 },
  { date: "2019-12", year: 2019, month: 12, price: 0.210 },
  { date: "2020-01", year: 2020, month: 1, price: 0.207 },
  { date: "2020-02", year: 2020, month: 2, price: 0.188 },
  { date: "2020-03", year: 2020, month: 3, price: 0.226 },
  { date: "2020-04", year: 2020, month: 4, price: 0.326 },
  { date: "2020-05", year: 2020, month: 5, price: 0.363 },
  { date: "2020-06", year: 2020, month: 6, price: 0.301 },
  { date: "2020-07", year: 2020, month: 7, price: 0.276 },
  { date: "2020-08", year: 2020, month: 8, price: 0.263 },
  { date: "2020-09", year: 2020, month: 9, price: 0.345 },
  { date: "2020-10", year: 2020, month: 10, price: 0.376 },
  { date: "2020-11", year: 2020, month: 11, price: 0.288 },
  { date: "2020-12", year: 2020, month: 12, price: 0.251 },
  { date: "2021-01", year: 2021, month: 1, price: 0.194 },
  { date: "2021-02", year: 2021, month: 2, price: 0.182 },
  { date: "2021-03", year: 2021, month: 3, price: 0.212 },
  { date: "2021-04", year: 2021, month: 4, price: 0.394 },
  { date: "2021-05", year: 2021, month: 5, price: 0.425 },
  { date: "2021-06", year: 2021, month: 6, price: 0.334 },
  { date: "2021-07", year: 2021, month: 7, price: 0.303 },
  { date: "2021-08", year: 2021, month: 8, price: 0.291 },
  { date: "2021-09", year: 2021, month: 9, price: 0.412 },
  { date: "2021-10", year: 2021, month: 10, price: 0.437 },
  { date: "2021-11", year: 2021, month: 11, price: 0.315 },
  { date: "2021-12", year: 2021, month: 12, price: 0.273 },
  { date: "2022-01", year: 2022, month: 1, price: 0.204 },
  { date: "2022-02", year: 2022, month: 2, price: 0.191 },
  { date: "2022-03", year: 2022, month: 3, price: 0.227 },
  { date: "2022-04", year: 2022, month: 4, price: 0.672 },
  { date: "2022-05", year: 2022, month: 5, price: 0.567 },
  { date: "2022-06", year: 2022, month: 6, price: 0.363 },
  { date: "2022-07", year: 2022, month: 7, price: 0.327 },
  { date: "2022-08", year: 2022, month: 8, price: 0.318 },
  { date: "2022-09", year: 2022, month: 9, price: 0.477 },
  { date: "2022-10", year: 2022, month: 10, price: 0.536 },
  { date: "2022-11", year: 2022, month: 11, price: 0.386 },
  { date: "2022-12", year: 2022, month: 12, price: 0.340 },
  { date: "2023-01", year: 2023, month: 1, price: 0.186 },
  { date: "2023-02", year: 2023, month: 2, price: 0.165 },
  { date: "2023-03", year: 2023, month: 3, price: 0.206 },
  { date: "2023-04", year: 2023, month: 4, price: 0.494 },
  { date: "2023-05", year: 2023, month: 5, price: 0.549 },
  { date: "2023-06", year: 2023, month: 6, price: 0.329 },
  { date: "2023-07", year: 2023, month: 7, price: 0.288 },
  { date: "2023-08", year: 2023, month: 8, price: 0.274 },
  { date: "2023-09", year: 2023, month: 9, price: 0.453 },
  { date: "2023-10", year: 2023, month: 10, price: 0.507 },
  { date: "2023-11", year: 2023, month: 11, price: 0.357 },
  { date: "2023-12", year: 2023, month: 12, price: 0.315 },
  { date: "2024-01", year: 2024, month: 1, price: 0.121 },
  { date: "2024-02", year: 2024, month: 2, price: 0.112 },
  { date: "2024-03", year: 2024, month: 3, price: 0.155 },
  { date: "2024-04", year: 2024, month: 4, price: 0.430 },
  { date: "2024-05", year: 2024, month: 5, price: 0.379 },
  { date: "2024-06", year: 2024, month: 6, price: 0.241 },
  { date: "2024-07", year: 2024, month: 7, price: 0.215 },
  { date: "2024-08", year: 2024, month: 8, price: 0.207 },
  { date: "2024-09", year: 2024, month: 9, price: 0.327 },
  { date: "2024-10", year: 2024, month: 10, price: 0.362 },
  { date: "2024-11", year: 2024, month: 11, price: 0.258 },
  { date: "2024-12", year: 2024, month: 12, price: 0.224 },
  { date: "2025-01", year: 2025, month: 1, price: 0.179 },
  { date: "2025-02", year: 2025, month: 2, price: 0.163 },
  { date: "2025-03", year: 2025, month: 3, price: 0.203 },
  { date: "2025-04", year: 2025, month: 4, price: 0.293 },
  { date: "2025-05", year: 2025, month: 5, price: 0.195 },
  { date: "2025-06", year: 2025, month: 6, price: 0.195 },
  { date: "2025-07", year: 2025, month: 7, price: 0.187 },
  { date: "2025-08", year: 2025, month: 8, price: 0.179 },
  { date: "2025-09", year: 2025, month: 9, price: 0.285 },
  { date: "2025-10", year: 2025, month: 10, price: 0.301 },
  { date: "2025-11", year: 2025, month: 11, price: 0.189 },
  { date: "2025-12", year: 2025, month: 12, price: 0.179 },
];


// --- Weekly date utilities ---

function _toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _snapToMonday(d) {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to previous Monday (or same day if Monday)
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return monday;
}

function generateWeeklyDates(startYear, startMonth, endYear, endMonth) {
  const dates = [];
  let d = _snapToMonday(new Date(startYear, startMonth - 1, 1));
  const end = new Date(endYear, endMonth, 0); // last day of endMonth
  while (d <= end) {
    dates.push(_toISODate(d));
    d = new Date(d.getTime() + 7 * MS_PER_DAY);
  }
  return dates;
}

function interpolateMonthlyToWeekly(monthlyPriceData) {
  if (!monthlyPriceData || monthlyPriceData.length === 0) return [];

  // Build anchor points: price assigned to the 15th of each month
  const anchors = monthlyPriceData.map(p => ({
    time: new Date(p.year, p.month - 1, 15).getTime(),
    price: p.price,
  }));

  const firstP = monthlyPriceData[0];
  const lastP = monthlyPriceData[monthlyPriceData.length - 1];
  const weeklyDates = generateWeeklyDates(firstP.year, firstP.month, lastP.year, lastP.month);

  return weeklyDates.map(dateStr => {
    const parts = dateStr.split("-");
    const t = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();

    // Find surrounding anchors
    let price;
    if (t <= anchors[0].time) {
      price = anchors[0].price;
    } else if (t >= anchors[anchors.length - 1].time) {
      price = anchors[anchors.length - 1].price;
    } else {
      let i = 0;
      while (i < anchors.length - 1 && anchors[i + 1].time < t) i++;
      const a = anchors[i], b = anchors[i + 1];
      const frac = (t - a.time) / (b.time - a.time);
      price = a.price + frac * (b.price - a.price);
    }

    return { date: dateStr, price };
  });
}

function getExactHarvestDate(plantOption, year, kcStages) {
  const season = plantOption.season;
  const stages = kcStages ? kcStages[season] : DEFAULT_KC_STAGES[season];
  const totalDays = _totalKcDays(stages);
  const plantDate = new Date(year, plantOption.monthIdx, plantOption.dayOfMonth);
  return new Date(plantDate.getTime() + totalDays * MS_PER_DAY);
}


// --- Helper: determine season type from planting month ---

function _getSeasonType(plantMonth) {
  // Accept month index and check all planting options
  for (const season of ["spring", "autumn"]) {
    if (PLANTING_OPTIONS[season].some(o => o.monthIdx === plantMonth)) return season;
  }
  return null;
}

// --- Helper: get planting option by key ---

function getPlantingOption(key) {
  for (const season of ["spring", "autumn"]) {
    const opt = PLANTING_OPTIONS[season].find(o => o.key === key);
    if (opt) return opt;
  }
  return null;
}


// --- Helper: get harvest month index from planting month index ---
// Used by cost model (integer-based interface)

function getHarvestMonth(plantMonth, kcStages) {
  const season = _getSeasonType(plantMonth);
  if (!season) return plantMonth;
  const stages = kcStages ? kcStages[season] : DEFAULT_KC_STAGES[season];
  const totalDays = _totalKcDays(stages);
  const startDate = new Date(2020, plantMonth, 1);
  const endDate = new Date(startDate.getTime() + totalDays * MS_PER_DAY);
  return endDate.getMonth();
}


// --- CSV parsing ---

// Expected CSV format:
//   year-month,price_per_kg
//   2020-01,0.52
//   2020-02,0.48
// Column 1: YYYY-MM date. Column 2: price in $/kg.
// Returns { data: [...], errors: [...] }

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const data = [];
  const errors = [];

  if (lines.length < 2) {
    return { data: [], errors: ["CSV must have a header row and at least one data row."] };
  }

  // Validate header
  const header = lines[0].trim().toLowerCase();
  if (!header.includes(",") || header.split(",").length < 2) {
    return { data: [], errors: ["Invalid header. Expected two columns separated by comma (e.g. 'year-month,price_per_kg')."] };
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",");

    if (parts.length < 2) {
      errors.push(`Row ${i + 1}: expected 2 columns, got ${parts.length}. Content: "${line}"`);
      continue;
    }

    const dateStr = parts[0].trim();
    const priceStr = parts[1].trim();
    const price = parseFloat(priceStr);

    if (isNaN(price) || price < 0) {
      errors.push(`Row ${i + 1}: invalid price "${priceStr}". Must be a non-negative number.`);
      continue;
    }

    const dateParts = dateStr.split("-");
    if (dateParts.length !== 2) {
      errors.push(`Row ${i + 1}: invalid date "${dateStr}". Expected YYYY-MM format.`);
      continue;
    }

    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]);

    if (isNaN(year) || year < 1900 || year > 2100) {
      errors.push(`Row ${i + 1}: invalid year "${dateParts[0]}". Expected 1900-2100.`);
      continue;
    }
    if (isNaN(month) || month < 1 || month > 12) {
      errors.push(`Row ${i + 1}: invalid month "${dateParts[1]}". Expected 01-12.`);
      continue;
    }

    data.push({ date: dateStr, year, month, price });
  }

  return { data, errors };
}
