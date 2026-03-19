// Plotly chart rendering functions

// Fixed chart dimensions for consistent layout
const CHART_WIDTH = 1050;
const CHART_MARGINS = { l: 65, r: 15 };

// --- Low-level: Build tick arrays (every 3rd month, month abbreviation) ---

function _buildTicks(dates) {
  const vals = [];
  const text = [];
  const seen = new Set();
  for (let i = 0; i < dates.length; i++) {
    const parts = dates[i].split("-");
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2] || "1");
    // Show tick at first occurrence of Jan, Apr, Jul, Oct
    if (month % 3 === 1) {
      const key = parts[0] + "-" + parts[1];
      if (!seen.has(key)) {
        seen.add(key);
        vals.push(dates[i]);
        text.push(MONTH_NAMES[month - 1]);
      }
    }
  }
  return { vals, text };
}


// --- Low-level: Build vertical line shapes at January of each year ---

function _buildYearLines(dates, yref) {
  const lines = [];
  const seen = new Set();
  for (const d of dates) {
    const parts = d.split("-");
    const month = parts[1];
    const year = parts[0];
    if (month === "01" && !seen.has(year)) {
      seen.add(year);
      lines.push({
        type: "line",
        xref: "x",
        yref: yref,
        x0: d, x1: d,
        y0: 0, y1: 1,
        line: { color: "#94a3b8", width: 1.5 },
        layer: "below",
      });
    }
  }
  return lines;
}


// --- Low-level: Generate profit/loss shading traces between price and cost ---

function _buildShadingTraces(timeSeries) {
  const profitX = [], profitUpper = [], profitLower = [];
  const lossX = [], lossUpper = [], lossLower = [];

  for (const point of timeSeries) {
    if (point.theoreticalCostPerKg === null) continue;
    const x = point.date;
    if (point.marketPrice >= point.theoreticalCostPerKg) {
      profitX.push(x);
      profitUpper.push(point.marketPrice);
      profitLower.push(point.theoreticalCostPerKg);
    } else {
      lossX.push(x);
      lossUpper.push(point.theoreticalCostPerKg);
      lossLower.push(point.marketPrice);
    }
  }

  const traces = [];

  if (profitX.length > 0) {
    traces.push({
      x: profitX, y: profitUpper,
      type: "scatter", mode: "none",
      showlegend: false,
    });
    traces.push({
      x: profitX, y: profitLower,
      type: "scatter", mode: "none",
      fill: "tonexty",
      fillcolor: "rgba(46,139,87,0.15)",
      showlegend: false,
    });
  }

  if (lossX.length > 0) {
    traces.push({
      x: lossX, y: lossUpper,
      type: "scatter", mode: "none",
      showlegend: false,
    });
    traces.push({
      x: lossX, y: lossLower,
      type: "scatter", mode: "none",
      fill: "tonexty",
      fillcolor: "rgba(220,20,60,0.15)",
      showlegend: false,
    });
  }

  // Dummy traces for clean legend entries
  traces.push({
    x: [null], y: [null],
    type: "scatter", mode: "markers",
    name: "Profit",
    marker: { color: "rgba(46,139,87,0.4)", size: 10, symbol: "square" },
    showlegend: profitX.length > 0,
  });
  traces.push({
    x: [null], y: [null],
    type: "scatter", mode: "markers",
    name: "Loss",
    marker: { color: "rgba(220,20,60,0.4)", size: 10, symbol: "square" },
    showlegend: lossX.length > 0,
  });

  return traces;
}


// --- Low-level: Shared x-axis config for both charts ---

function _sharedXaxis(dates, ticks) {
  return {
    type: "category",
    categoryorder: "array",
    categoryarray: dates,
    range: [-0.5, dates.length - 0.5],
    tickangle: 0,
    tickfont: { size: 9 },
    tickmode: "array",
    tickvals: ticks.vals,
    ticktext: ticks.text,
    ticklabelstandoff: 10,
  };
}


// --- High-level: Render main price vs cost chart ---

function renderMainChart({ timeSeries, currencyLabel = "USD", exchangeRate = 1 } = {}) {
  const dates = timeSeries.map(p => p.date);
  const ticks = _buildTicks(dates);

  const prices = timeSeries.map(p => p.marketPrice * exchangeRate);
  const theoreticalCosts = timeSeries.map(p =>
    p.theoreticalCostPerKg !== null ? p.theoreticalCostPerKg * exchangeRate : null
  );

  // Harvest result points colored by profit/loss
  const harvestDates = [];
  const harvestCosts = [];
  const harvestColors = [];
  for (const p of timeSeries) {
    if (p.costPerKg !== null) {
      harvestDates.push(p.date);
      harvestCosts.push(p.costPerKg * exchangeRate);
      harvestColors.push(p.marketPrice >= p.costPerKg ? "#2e8b57" : "#dc2626");
    }
  }

  const scaledSeries = timeSeries.map(p => ({
    ...p,
    marketPrice: p.marketPrice * exchangeRate,
    theoreticalCostPerKg: p.theoreticalCostPerKg !== null ? p.theoreticalCostPerKg * exchangeRate : null,
  }));

  const traces = [
    {
      x: dates, y: prices,
      type: "scatter", mode: "lines",
      name: "Market Price/kg",
      line: { color: "#000000", width: 2 },
    },
    {
      x: dates, y: theoreticalCosts,
      type: "scatter", mode: "lines",
      name: "Cost to Deliver/kg",
      line: { color: "#dc2626", width: 2, dash: "2px,2px" },
    },
    {
      x: harvestDates, y: harvestCosts,
      type: "scatter", mode: "markers",
      name: "Harvest Results",
      marker: { color: harvestColors, size: 10, symbol: "circle" },
    },
    ..._buildShadingTraces(scaledSeries),
  ];

  const symbol = currencyLabel === "EGP" ? "EGP" : "$";
  const yearLines = _buildYearLines(dates, "paper");
  const layout = {
    width: CHART_WIDTH,
    height: 380,
    title: { text: `Market Price vs. Cost to Deliver (${symbol}/kg)`, font: { size: 14 } },
    xaxis: _sharedXaxis(dates, ticks),
    yaxis: {
      range: [0, exchangeRate > 1 ? 50 : 1.0],
      dtick: exchangeRate > 1 ? 10 : 0.25,
      automargin: false,
    },
    shapes: yearLines,
    legend: { orientation: "h", y: -0.15, font: { size: 10 } },
    margin: { t: 35, b: 60, l: CHART_MARGINS.l, r: CHART_MARGINS.r },
    hovermode: "x unified",
    plot_bgcolor: "#fafafa",
    paper_bgcolor: "#ffffff",
  };

  Plotly.newPlot("main-chart", traces, layout, { responsive: false });
}


// --- High-level: Render planting timeline chart ---
// Separate chart below the main chart with matching x-axis.

function renderTimeline({ plantOptions, weeklyDates, kcStages = null } = {}) {
  const activeOpts = (plantOptions || []).filter(o => o);
  const el = document.getElementById("timeline-chart");
  if (!el) return;

  if (!weeklyDates || weeklyDates.length === 0) {
    Plotly.purge("timeline-chart");
    return;
  }

  const allDates = weeklyDates;
  const firstDate = new Date(allDates[0]);
  const lastDate = new Date(allDates[allDates.length - 1]);
  const minYear = firstDate.getFullYear();
  const maxYear = lastDate.getFullYear();
  const ticks = _buildTicks(allDates);
  const barColor = "#3b82f6";

  // Build a lookup for date string -> index for snapping
  const dateIndex = new Map(allDates.map((d, i) => [d, i]));

  function _findNearestIdx(dateStr) {
    if (dateIndex.has(dateStr)) return dateIndex.get(dateStr);
    const t = new Date(dateStr).getTime();
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < allDates.length; i++) {
      const diff = Math.abs(new Date(allDates[i]).getTime() - t);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }

  // Always show both rows: Spring (row 0), Autumn (row 1)
  const yLabels = ["Spring", "Autumn"];
  const seasonToRow = { spring: 0, autumn: 1 };

  const shapes = [];

  for (const opt of activeOpts) {
    const rowIdx = seasonToRow[opt.season];
    const stages = kcStages ? kcStages[opt.season] : DEFAULT_KC_STAGES[opt.season];
    const totalDays = _totalKcDays(stages);

    for (let year = minYear; year <= maxYear; year++) {
      const plantDate = new Date(year, opt.monthIdx, opt.dayOfMonth);
      const endDate = new Date(plantDate.getTime() + totalDays * MS_PER_DAY);

      const startKey = _toISODate(_snapToMonday(plantDate));
      const endKey = _toISODate(_snapToMonday(endDate));

      const startIdx = _findNearestIdx(startKey);
      const endIdx = _findNearestIdx(endKey);

      shapes.push({
        type: "rect",
        xref: "x",
        yref: "y",
        x0: startIdx - 0.4,
        x1: endIdx + 0.4,
        y0: rowIdx - 0.225,
        y1: rowIdx + 0.225,
        fillcolor: barColor,
        opacity: 0.7,
        line: { color: barColor, width: 0 },
      });
    }
  }

  // Invisible trace to establish axes
  const trace = {
    x: allDates,
    y: Array(allDates.length).fill(null),
    type: "scatter", mode: "markers",
    marker: { size: 0, opacity: 0 },
    showlegend: false,
    hoverinfo: "none",
  };

  const numRows = yLabels.length;
  const yearLines = _buildYearLines(allDates, "paper");
  const layout = {
    width: CHART_WIDTH,
    height: 80 + numRows * 35,
    title: { text: "Planting Schedule", font: { size: 14 } },
    xaxis: { ..._sharedXaxis(allDates, ticks), showline: false, zeroline: false },
    yaxis: {
      tickvals: yLabels.map((_, i) => i),
      ticktext: yLabels,
      tickfont: { size: 11 },
      ticklabelstandoff: 12,
      automargin: false,
      range: [-0.6, numRows - 0.4],
      zeroline: false,
      showline: false,
    },
    shapes: [...shapes, ...yearLines],
    margin: { t: 35, b: 60, l: CHART_MARGINS.l, r: CHART_MARGINS.r },
    plot_bgcolor: "#fafafa",
    paper_bgcolor: "#ffffff",
  };

  Plotly.newPlot("timeline-chart", [trace], layout, { responsive: false });
}


// --- High-level: Build results table HTML ---

function buildResultsTable({ priceData, harvests, currencyLabel = "USD", exchangeRate = 1 } = {}) {
  if (!priceData || priceData.length === 0) return "<p>No price data loaded.</p>";

  const harvestEntries = Array.from(harvests.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (harvestEntries.length === 0) return "<p>Select planting months to see harvest results.</p>";

  const symbol = currencyLabel === "EGP" ? "EGP " : "$";
  const fmt = (v) => {
    const scaled = v * exchangeRate;
    if (Math.abs(scaled) >= 1000) return symbol + (scaled / 1000).toFixed(1) + "k";
    return symbol + scaled.toFixed(2);
  };
  const fmtKg = (v) => symbol + (v * exchangeRate).toFixed(2);

  const colCount = harvestEntries.length + 2;

  let html = '<table class="results-table"><thead><tr>';
  html += "<th>Component</th>";
  for (const [date] of harvestEntries) html += `<th>${date}</th>`;
  html += "<th>Total</th></tr></thead><tbody>";

  const costRows = [
    { label: "Season", fn: h => h.season },
    { label: "Water Cost ($/ha)", fn: h => fmt(h.breakdown.water), totalKey: "water" },
    { label: "Irrigation Cost ($/ha)", fn: h => fmt(h.breakdown.irrigation), totalKey: "irrigation" },
    { label: "Energy Cost ($/ha)", fn: h => fmt(h.breakdown.energy), totalKey: "energy" },
    { label: "Labor Cost ($/ha)", fn: h => fmt(h.breakdown.labor), totalKey: "labor" },
    { label: "Fertilizer ($/ha)", fn: h => fmt(h.breakdown.fertilizer), totalKey: "fertilizer" },
    { label: "Seed ($/ha)", fn: h => fmt(h.breakdown.seed), totalKey: "seed" },
    { label: "Pest & Disease ($/ha)", fn: h => fmt(h.breakdown.pest), totalKey: "pest" },
    { label: "Additional Costs ($/ha)", fn: h => fmt(h.breakdown.other), totalKey: "other" },
    { label: "Total Cost ($/ha)", fn: h => fmt(h.totalCostPerHa + h.pkg_ship * h.yieldKgPerHa), totalKey: "totalCost", bold: true },
  ];

  const perKgRows = [
    { label: "Yield (kg/ha)", fn: h => h.yieldKgPerHa.toLocaleString() },
    { label: "Cost/kg (ex. pkg)", fn: h => fmtKg(h.costPerKgExPkg) },
    { label: "Packaging ($/kg)", fn: h => fmtKg(h.pkg_ship) },
    { label: "Cost/kg (delivered)", fn: h => fmtKg(h.costPerKg) },
    { label: "Market Price ($/kg)", fn: h => fmtKg(h.marketPrice) },
  ];

  const revenueRows = [
    { label: "Revenue ($/ha)", fn: h => fmt(h.revenuePerHa), totalKey: "revenue" },
  ];

  const profitRows = [
    { label: "Profit ($/ha)", fn: h => fmt(h.profitPerHa), totalKey: "profit", highlight: true },
  ];

  function _totalFor(key) {
    let sum = 0;
    for (const [, h] of harvestEntries) {
      if (h.breakdown[key] !== undefined) sum += h.breakdown[key];
      else if (key === "totalCost") sum += h.totalCostPerHa + h.pkg_ship * h.yieldKgPerHa;
      else if (key === "revenue") sum += h.revenuePerHa;
      else if (key === "profit") sum += h.profitPerHa;
    }
    return sum;
  }

  function _renderRow(row) {
    const boldOpen = row.bold ? "<strong>" : "";
    const boldClose = row.bold ? "</strong>" : "";
    html += "<tr>";
    html += `<td class="row-label">${boldOpen}${row.label}${boldClose}</td>`;

    for (const [, h] of harvestEntries) {
      const val = row.fn(h);
      let cls = "";
      if (row.highlight) cls = h.profitPerHa >= 0 ? "profit-positive" : "profit-negative";
      html += `<td class="${cls}">${boldOpen}${val}${boldClose}</td>`;
    }

    if (row.totalKey) {
      const total = _totalFor(row.totalKey);
      let cls = "total-col";
      if (row.highlight) cls += total >= 0 ? " profit-positive" : " profit-negative";
      html += `<td class="${cls}">${boldOpen}${fmt(total)}${boldClose}</td>`;
    } else {
      html += `<td class="total-col">-</td>`;
    }
    html += "</tr>";
  }

  function _spacerRow() {
    html += `<tr class="spacer-row"><td colspan="${colCount}">&nbsp;</td></tr>`;
  }

  for (const row of costRows) _renderRow(row);
  _spacerRow();
  for (const row of perKgRows) _renderRow(row);
  _spacerRow();
  for (const row of revenueRows) _renderRow(row);
  _spacerRow();
  for (const row of profitRows) _renderRow(row);

  html += "</tbody></table>";
  return html;
}


// --- High-level: Render resource demand charts ---
// Shows monthly water (m³/ha), energy (kWh/ha), and labor (hrs/ha) for active crop cycles.

function renderResourceCharts({ cycleResults, currencyLabel = "USD", exchangeRate = 1 } = {}) {
  const el = document.getElementById("resource-charts");
  if (!el) return;

  if (!cycleResults || cycleResults.length === 0) {
    el.innerHTML = "<p>Select planting dates to see resource demand.</p>";
    return;
  }

  // Collect all months that have data across cycles
  const allMonths = new Set();
  for (const cycle of cycleResults) {
    for (const mw of cycle.monthlyWater) allMonths.add(mw.month);
  }
  const sortedMonths = [...allMonths].sort((a, b) => a - b);
  const monthLabels = sortedMonths.map(m => MONTH_NAMES[m]);

  const seasonColors = { spring: "#3b82f6", autumn: "#f59e0b" };

  // --- Water demand chart ---
  const waterTraces = cycleResults.map(cycle => {
    const waterByMonth = {};
    for (const mw of cycle.monthlyWater) waterByMonth[mw.month] = mw.water_m3_per_ha;
    return {
      x: monthLabels,
      y: sortedMonths.map(m => waterByMonth[m] || 0),
      type: "bar",
      name: `${cycle.season.charAt(0).toUpperCase() + cycle.season.slice(1)}`,
      marker: { color: seasonColors[cycle.season] },
    };
  });

  // --- Energy demand chart (kWh = water_m3 × kwh_per_m3) ---
  const energyTraces = cycleResults.map(cycle => {
    const waterByMonth = {};
    for (const mw of cycle.monthlyWater) waterByMonth[mw.month] = mw.water_m3_per_ha;
    return {
      x: monthLabels,
      y: sortedMonths.map(m => (waterByMonth[m] || 0) * cycle.kwh_per_m3),
      type: "bar",
      name: `${cycle.season.charAt(0).toUpperCase() + cycle.season.slice(1)}`,
      marker: { color: seasonColors[cycle.season] },
      showlegend: false,
    };
  });

  // --- Labor demand chart (stacked by activity) ---
  const activityColors = [
    "#1e40af", "#3b82f6", "#06b6d4", "#10b981",
    "#84cc16", "#eab308", "#f97316", "#ef4444",
  ];

  const laborTraces = [];
  const activityNames = LABOR_ACTIVITIES.map(a => a.name);

  for (let ai = 0; ai < activityNames.length; ai++) {
    const actName = activityNames[ai];
    const yVals = sortedMonths.map(m => {
      let total = 0;
      for (const cycle of cycleResults) {
        const actData = cycle.monthlyLabor.monthlyByActivity[actName];
        if (actData && actData[m]) total += actData[m];
      }
      return Math.round(total * 10) / 10;
    });

    // Only add trace if there are nonzero values
    if (yVals.some(v => v > 0)) {
      laborTraces.push({
        x: monthLabels,
        y: yVals,
        type: "bar",
        name: actName,
        marker: { color: activityColors[ai % activityColors.length] },
      });
    }
  }

  // Render three sub-charts as subplots in a single container
  const chartWidth = CHART_WIDTH;
  const subHeight = 260;

  // Combine water across seasons into a single total bar per month
  const totalWater = sortedMonths.map(m => {
    let sum = 0;
    for (const cycle of cycleResults) {
      for (const mw of cycle.monthlyWater) {
        if (mw.month === m) sum += mw.water_m3_per_ha;
      }
    }
    return Math.round(sum);
  });

  const totalWaterTrace = {
    x: monthLabels,
    y: totalWater,
    type: "bar",
    name: "Water Demand",
    marker: { color: "#3b82f6" },
    showlegend: false,
  };

  el.innerHTML = `
    <div id="water-demand-chart"></div>
    <div id="labor-demand-chart"></div>
  `;

  const barLayout = (title, yTitle) => ({
    width: chartWidth,
    height: subHeight,
    title: { text: title, font: { size: 13 } },
    xaxis: { tickfont: { size: 10 } },
    yaxis: { title: { text: yTitle, font: { size: 11 } }, rangemode: "tozero" },
    legend: { orientation: "h", y: -0.25, font: { size: 9 } },
    margin: { t: 30, b: 50, l: CHART_MARGINS.l, r: CHART_MARGINS.r },
    plot_bgcolor: "#fafafa",
    paper_bgcolor: "#ffffff",
  });

  Plotly.newPlot("water-demand-chart", [totalWaterTrace], barLayout(
    "Monthly Water Demand", "m\u00B3/ha"
  ), { responsive: false });

  Plotly.newPlot("labor-demand-chart", laborTraces, {
    ...barLayout("Monthly Labor by Activity", "hrs/ha"),
    barmode: "stack",
  }, { responsive: false });
}
