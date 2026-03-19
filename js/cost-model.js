// Cost model calculation engine
// FAO Kc x ET0 water requirement model with full cost breakdown

// --- Low-level: Build daily Kc schedule for a growing season ---

function _buildDailyKc(kcStages) {
  const days = [];
  const ini = kcStages.initial;
  const dev = kcStages.development;
  const mid = kcStages.mid;
  const late = kcStages.late;

  // Initial stage
  for (let d = 0; d < ini.days; d++) days.push(ini.kc);

  // Development stage (linear interpolation)
  for (let d = 0; d < dev.days; d++) {
    const fraction = d / (dev.days - 1 || 1);
    days.push(dev.kc_start + fraction * (dev.kc_end - dev.kc_start));
  }

  // Mid-season stage
  for (let d = 0; d < mid.days; d++) days.push(mid.kc);

  // Late stage (constant at Kc_end value)
  for (let d = 0; d < late.days; d++) days.push(late.kc);

  return days;
}


// --- Low-level: Assign daily Kc values to calendar months ---
// Returns array of { month: 0-11, avgKc: number, daysInMonth: number }

function _assignKcToMonths(plantMonth, dailyKc) {
  const monthBuckets = {};
  let currentMonth = plantMonth;
  let dayInMonth = 0;
  let remainingInMonth = DAYS_IN_MONTH[currentMonth];

  for (let d = 0; d < dailyKc.length; d++) {
    if (!monthBuckets[currentMonth]) monthBuckets[currentMonth] = { sumKc: 0, count: 0 };
    monthBuckets[currentMonth].sumKc += dailyKc[d];
    monthBuckets[currentMonth].count += 1;
    dayInMonth++;

    if (dayInMonth >= remainingInMonth) {
      dayInMonth = 0;
      currentMonth = (currentMonth + 1) % 12;
      remainingInMonth = DAYS_IN_MONTH[currentMonth];
    }
  }

  return Object.entries(monthBuckets).map(([m, data]) => ({
    month: parseInt(m),
    avgKc: data.sumKc / data.count,
    daysInMonth: data.count,
  }));
}


// --- Low-level: Calculate monthly water requirement (m3/ha) ---

function _calcMonthlyWater(monthlyKcData, et0, irrigationEfficiency) {
  return monthlyKcData.map(entry => {
    const et0_mm = et0[entry.month];
    const fullMonthDays = DAYS_IN_MONTH[entry.month];
    const dailyET0 = et0_mm / fullMonthDays;
    const etc_mm = entry.avgKc * dailyET0 * entry.daysInMonth;
    // Convert mm to m3/ha: 1 mm over 1 ha = 10 m3
    const water_m3_per_ha = (etc_mm * 10) / irrigationEfficiency;
    return {
      month: entry.month,
      etc_mm,
      water_m3_per_ha,
      daysInMonth: entry.daysInMonth,
      avgKc: entry.avgKc,
    };
  });
}


// --- Low-level: Map growth stage day ranges to calendar months ---
// Returns { month: fractionOfDaysInThisMonth } for each stage

function _stageDayRanges(kcStages) {
  const ini = kcStages.initial.days;
  const dev = kcStages.development.days;
  const mid = kcStages.mid.days;
  const late = kcStages.late.days;
  return {
    initial:     { start: 0, end: ini },
    development: { start: ini, end: ini + dev },
    mid:         { start: ini + dev, end: ini + dev + mid },
    late:        { start: ini + dev + mid, end: ini + dev + mid + late },
  };
}


// --- High-level: Distribute labor hours by activity to calendar months ---

function calcMonthlyLabor({ plantMonth, totalHours, kcStages }) {
  const ranges = _stageDayRanges(kcStages);
  const totalDays = ranges.late.end;

  // Map each day to a calendar month
  const dayToMonth = [];
  let curMonth = plantMonth;
  let dayInMonth = 0;
  let remaining = DAYS_IN_MONTH[curMonth];
  for (let d = 0; d < totalDays; d++) {
    dayToMonth.push(curMonth);
    dayInMonth++;
    if (dayInMonth >= remaining) {
      dayInMonth = 0;
      curMonth = (curMonth + 1) % 12;
      remaining = DAYS_IN_MONTH[curMonth];
    }
  }

  // For each activity, determine which days it spans, then sum by month
  const monthlyByActivity = {}; // { activityName: { month: hours } }
  const monthlyTotal = {};      // { month: hours }

  for (const act of LABOR_ACTIVITIES) {
    const hours = totalHours * act.fraction;
    let dayStart, dayEnd;

    if (act.stage === "all") {
      dayStart = 0;
      dayEnd = totalDays;
    } else {
      const r = ranges[act.stage];
      const span = act.stageSpan || [0, 1];
      const len = r.end - r.start;
      dayStart = r.start + Math.round(len * span[0]);
      dayEnd = r.start + Math.round(len * span[1]);
    }

    const spanDays = dayEnd - dayStart;
    if (spanDays <= 0) continue;
    const hoursPerDay = hours / spanDays;

    if (!monthlyByActivity[act.name]) monthlyByActivity[act.name] = {};

    for (let d = dayStart; d < dayEnd; d++) {
      const m = dayToMonth[d];
      monthlyByActivity[act.name][m] = (monthlyByActivity[act.name][m] || 0) + hoursPerDay;
      monthlyTotal[m] = (monthlyTotal[m] || 0) + hoursPerDay;
    }
  }

  return { monthlyByActivity, monthlyTotal };
}


// --- High-level: Calculate total water for one crop cycle ---

function calcTotalWater({ plantMonth, season = null, et0 = DEFAULT_ET0,
                          kcStages = null, irrigationEfficiency = DEFAULT_AGRONOMIC.irrigation_efficiency } = {}) {
  season = season || _getSeasonType(plantMonth);
  kcStages = kcStages || DEFAULT_KC_STAGES[season];
  const dailyKc = _buildDailyKc(kcStages);
  const monthlyKc = _assignKcToMonths(plantMonth, dailyKc);
  const monthlyWater = _calcMonthlyWater(monthlyKc, et0, irrigationEfficiency);
  const totalWater = monthlyWater.reduce((sum, m) => sum + m.water_m3_per_ha, 0);
  return { monthlyWater, totalWater };
}


// --- High-level: Full cost breakdown for one crop cycle ---

function calcCycleCost({ plantMonth, lcow, lcoe, lcoi, labor_rate, fert_price,
                         seed_price, pkg_ship, pest_cost = 350, other_cost = 15000,
                         et0 = DEFAULT_ET0, kcStages = null,
                         yields = DEFAULT_YIELDS, agronomic = DEFAULT_AGRONOMIC } = {}) {
  const season = _getSeasonType(plantMonth);
  const seasonKcStages = kcStages || DEFAULT_KC_STAGES[season];
  const { monthlyWater, totalWater } = calcTotalWater({
    plantMonth, season, et0, kcStages: seasonKcStages,
    irrigationEfficiency: agronomic.irrigation_efficiency,
  });

  const yieldKgPerHa = yields[season];
  const harvestMonth = getHarvestMonth(plantMonth, kcStages ? { [season]: seasonKcStages } : null);

  // Monthly labor breakdown
  const monthlyLabor = calcMonthlyLabor({
    plantMonth,
    totalHours: agronomic.labor_hours_per_ha,
    kcStages: seasonKcStages,
  });

  // Cost components ($/ha)
  // LCOI is now $/ha (flat per cycle), not $/m3
  const waterCost = lcow * totalWater;
  const irrigationCost = lcoi; // flat $/ha per cycle
  const energyCost = lcoe * agronomic.kwh_per_m3 * totalWater;
  const laborCost = labor_rate * agronomic.labor_hours_per_ha;
  const fertilizerCost = fert_price * agronomic.fertilizer_kg_per_ha;
  const seedCost = seed_price * agronomic.seed_kg_per_ha;
  const pestCost = pest_cost;       // flat $/ha per cycle
  const otherCost = other_cost;     // flat $/ha per cycle

  const totalCostPerHa = waterCost + irrigationCost + energyCost + laborCost + fertilizerCost + seedCost + pestCost + otherCost;
  const costPerKgExPkg = totalCostPerHa / yieldKgPerHa;
  const costPerKg = costPerKgExPkg + pkg_ship;

  return {
    plantMonth,
    harvestMonth,
    season,
    yieldKgPerHa,
    totalWater,
    monthlyWater,
    monthlyLabor,
    breakdown: {
      water: waterCost,
      irrigation: irrigationCost,
      energy: energyCost,
      labor: laborCost,
      fertilizer: fertilizerCost,
      seed: seedCost,
      pest: pestCost,
      other: otherCost,
    },
    totalCostPerHa,
    costPerKgExPkg,
    costPerKg,
    pkg_ship,
  };
}


// --- Low-level: Build calcCycleCost args from shared parameters ---

function _buildCycleArgs(plantMonthIdx, season, { sliderValues, et0, kcStages, yields, agronomic }) {
  return {
    plantMonth: plantMonthIdx,
    ...sliderValues,
    et0,
    kcStages: kcStages ? kcStages[season] : null,
    yields,
    agronomic,
  };
}


// --- High-level: Calculate cost for all selected cycles, mapped to harvest months ---

function calcAllHarvests({ plantMonths, priceData, sliderValues, et0 = DEFAULT_ET0,
                           kcStages = null, yields = DEFAULT_YIELDS,
                           agronomic = DEFAULT_AGRONOMIC } = {}) {
  if (!priceData || priceData.length === 0) return new Map();

  const minYear = priceData[0].year;
  const maxYear = priceData[priceData.length - 1].year;
  const priceByDate = new Map(priceData.map(p => [p.date, p.price]));
  const harvests = new Map();
  const shared = { sliderValues, et0, kcStages, yields, agronomic };

  for (const pm of plantMonths) {
    if (pm === null || pm === undefined || pm === "") continue;
    const plantMonthIdx = parseInt(pm);
    const season = _getSeasonType(plantMonthIdx);
    if (!season) continue;

    const result = calcCycleCost(_buildCycleArgs(plantMonthIdx, season, shared));

    for (let year = minYear; year <= maxYear; year++) {
      const hMonth = result.harvestMonth + 1;
      const dateKey = `${year}-${String(hMonth).padStart(2, "0")}`;
      const price = priceByDate.get(dateKey);
      if (price !== undefined) {
        harvests.set(dateKey, {
          ...result,
          year,
          marketPrice: price,
          revenuePerHa: price * result.yieldKgPerHa,
          profitPerHa: (price - result.costPerKg) * result.yieldKgPerHa,
          profitPerKg: price - result.costPerKg,
        });
      }
    }
  }

  return harvests;
}


// --- High-level: Backcast theoretical cost/kg for every calendar month ---

function calcTheoreticalMonthlyCosts({ sliderValues, et0 = DEFAULT_ET0,
                                        kcStages = null, yields = DEFAULT_YIELDS,
                                        agronomic = DEFAULT_AGRONOMIC } = {}) {
  const costAccum = {};
  const allOptions = [...PLANTING_OPTIONS.autumn, ...PLANTING_OPTIONS.spring];
  const shared = { sliderValues, et0, kcStages, yields, agronomic };

  for (const opt of allOptions) {
    const result = calcCycleCost(_buildCycleArgs(opt.monthIdx, opt.season, shared));

    const hMonth = result.harvestMonth;
    if (hMonth in costAccum) {
      costAccum[hMonth].sum += result.costPerKg;
      costAccum[hMonth].count += 1;
    } else {
      costAccum[hMonth] = { sum: result.costPerKg, count: 1 };
    }
  }

  const knownCosts = {};
  for (const [month, acc] of Object.entries(costAccum)) {
    knownCosts[month] = acc.sum / acc.count;
  }

  // Interpolate to fill all 12 months
  const knownMonths = Object.keys(knownCosts).map(Number).sort((a, b) => a - b);
  const monthlyCosts = new Map();

  if (knownMonths.length === 0) return monthlyCosts;

  if (knownMonths.length === 1) {
    // Single value — flat line
    const val = knownCosts[knownMonths[0]];
    for (let m = 0; m < 12; m++) monthlyCosts.set(m, { costPerKg: val });
    return monthlyCosts;
  }

  // Linear interpolation wrapping around the 12-month cycle
  for (let m = 0; m < 12; m++) {
    if (m in knownCosts) {
      monthlyCosts.set(m, { costPerKg: knownCosts[m] });
      continue;
    }

    // Find nearest known months before and after (wrapping)
    let prevMonth = null, nextMonth = null;
    for (let offset = 1; offset < 12; offset++) {
      const before = (m - offset + 12) % 12;
      if (before in knownCosts && prevMonth === null) prevMonth = before;
      const after = (m + offset) % 12;
      if (after in knownCosts && nextMonth === null) nextMonth = after;
      if (prevMonth !== null && nextMonth !== null) break;
    }

    const distPrev = (m - prevMonth + 12) % 12;
    const distNext = (nextMonth - m + 12) % 12;
    const totalDist = distPrev + distNext;
    const t = distPrev / totalDist;
    const interpolated = knownCosts[prevMonth] * (1 - t) + knownCosts[nextMonth] * t;
    monthlyCosts.set(m, { costPerKg: interpolated });
  }

  return monthlyCosts;
}


// --- High-level: Build time series for chart overlay ---
// Includes market price, harvest result cost points, and theoretical backcast cost for every month.

function buildCostTimeSeries({ priceData, harvests, theoreticalMonthlyCosts = null } = {}) {
  return priceData.map(p => {
    const monthIdx = p.month - 1; // price data month is 1-indexed
    const theoretical = theoreticalMonthlyCosts && theoreticalMonthlyCosts.has(monthIdx)
      ? theoreticalMonthlyCosts.get(monthIdx).costPerKg
      : null;
    return {
      date: p.date,
      marketPrice: p.price,
      costPerKg: harvests.has(p.date) ? harvests.get(p.date).costPerKg : null,
      theoreticalCostPerKg: theoretical,
    };
  });
}


// --- High-level: Summary statistics ---

function calcSummaryStats(harvests) {
  if (harvests.size === 0) {
    return {
      totalRevenue: 0, totalCosts: 0, netProfit: 0,
      cyclesProfitable: 0, totalCycles: 0,
      avgProfitPerCycle: 0, breakEvenPrice: 0,
    };
  }

  let totalRevenue = 0;
  let totalCosts = 0;
  let cyclesProfitable = 0;
  let breakEvenSum = 0;

  for (const [, h] of harvests) {
    totalRevenue += h.revenuePerHa;
    totalCosts += h.totalCostPerHa + h.pkg_ship * h.yieldKgPerHa;
    if (h.profitPerHa > 0) cyclesProfitable++;
    breakEvenSum += h.costPerKg;
  }

  const totalCycles = harvests.size;
  return {
    totalRevenue,
    totalCosts,
    netProfit: totalRevenue - totalCosts,
    cyclesProfitable,
    totalCycles,
    avgProfitPerCycle: (totalRevenue - totalCosts) / totalCycles,
    breakEvenPrice: breakEvenSum / totalCycles,
  };
}
