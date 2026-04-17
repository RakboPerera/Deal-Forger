/**
 * DealForge Financial Math Engine
 * Pure JS deterministic financial calculations. No LLM involvement.
 * All monetary values assumed in $M unless stated otherwise.
 */

// ============================================================
// Statistical Helpers
// ============================================================

/**
 * Sort array of numbers ascending (non-mutating).
 * @param {number[]} arr
 * @returns {number[]}
 */
function sortAsc(arr) {
  return [...arr].sort((a, b) => a - b);
}

/**
 * Arithmetic mean.
 * @param {number[]} arr
 * @returns {number}
 */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Median (interpolated for even-length arrays).
 * @param {number[]} arr
 * @returns {number}
 */
function median(arr) {
  if (!arr.length) return 0;
  const sorted = sortAsc(arr);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Percentile using linear interpolation (exclusive method).
 * p is in [0, 100].
 * @param {number[]} arr
 * @param {number} p
 * @returns {number}
 */
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = sortAsc(arr);
  if (sorted.length === 1) return sorted[0];

  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const frac = idx - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

/**
 * Standard deviation (population).
 * @param {number[]} arr
 * @returns {number}
 */
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// ============================================================
// IRR & MOIC
// ============================================================

/**
 * Internal Rate of Return using Newton-Raphson method.
 *
 * Solves for r in: sum( cf[t] / (1+r)^t ) = 0, t = 0..N
 *
 * @param {number[]} cashFlows - Array where index 0 is typically negative (investment).
 * @param {number} [guess=0.1] - Initial guess for IRR.
 * @param {number} [maxIter=200] - Maximum iterations.
 * @param {number} [tolerance=1e-10] - Convergence tolerance.
 * @returns {number|null} IRR as decimal (e.g., 0.22 for 22%), or null if no convergence.
 */
export function calcIRR(cashFlows, guess = 0.1, maxIter = 200, tolerance = 1e-10) {
  if (!cashFlows || cashFlows.length < 2) return null;

  let r = guess;

  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0; // derivative of NPV w.r.t. r

    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + r, t);
      npv += cashFlows[t] / denom;
      if (t > 0) {
        dnpv -= (t * cashFlows[t]) / Math.pow(1 + r, t + 1);
      }
    }

    if (Math.abs(npv) < tolerance) {
      return r;
    }

    if (Math.abs(dnpv) < 1e-20) {
      // Derivative too small; try bisection fallback
      return calcIRRBisection(cashFlows, -0.5, 5.0, maxIter, tolerance);
    }

    const rNew = r - npv / dnpv;

    // Guard against divergence
    if (rNew < -1) {
      return calcIRRBisection(cashFlows, -0.99, 5.0, maxIter, tolerance);
    }

    r = rNew;
  }

  // Newton-Raphson did not converge; fall back to bisection
  return calcIRRBisection(cashFlows, -0.99, 10.0, maxIter * 5, tolerance);
}

/**
 * IRR bisection fallback for difficult convergence cases.
 * @param {number[]} cashFlows
 * @param {number} lo
 * @param {number} hi
 * @param {number} maxIter
 * @param {number} tolerance
 * @returns {number|null}
 */
function calcIRRBisection(cashFlows, lo, hi, maxIter, tolerance) {
  const npvAt = (r) => {
    let npv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + r, t);
    }
    return npv;
  };

  let fLo = npvAt(lo);
  let fHi = npvAt(hi);

  // If same sign, can't bracket
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);

    if (Math.abs(fMid) < tolerance || (hi - lo) / 2 < tolerance) {
      return mid;
    }

    if (fMid * fLo < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return (lo + hi) / 2;
}

/**
 * Multiple on Invested Capital.
 * @param {number} totalDistributions - Total cash returned to investors.
 * @param {number} totalInvested - Total cash invested.
 * @returns {number} MOIC as a multiple (e.g., 2.5x).
 */
export function calcMOIC(totalDistributions, totalInvested) {
  if (!totalInvested || totalInvested === 0) return 0;
  return totalDistributions / totalInvested;
}

// ============================================================
// DCF Valuation
// ============================================================

/**
 * Discounted Cash Flow Valuation.
 *
 * Projects revenue, EBITDA, FCF for 5 years, discounts at WACC,
 * adds terminal value (Gordon Growth Model).
 *
 * @param {Object} financials - Latest year financials.
 * @param {number} financials.revenue - Base year revenue ($M).
 * @param {number} financials.ebitda - Base year EBITDA ($M).
 * @param {number} [financials.ebitda_margin_pct] - Base EBITDA margin (informational).
 *
 * @param {Object} assumptions
 * @param {number[]} assumptions.revenueGrowth - Revenue growth rates for years 1-5 (decimals, e.g., 0.10 for 10%).
 * @param {number[]} assumptions.ebitdaMargins - EBITDA margin for years 1-5 (decimals, e.g., 0.25 for 25%).
 * @param {number} assumptions.wacc - Weighted average cost of capital (decimal).
 * @param {number} assumptions.terminalGrowthRate - Perpetuity growth rate (decimal).
 * @param {number} assumptions.taxRate - Corporate tax rate (decimal).
 * @param {number} assumptions.capexPct - Capex as % of revenue (decimal).
 * @param {number} assumptions.daPct - D&A as % of revenue (decimal).
 * @param {number} assumptions.wcPct - Change in working capital as % of revenue change (decimal).
 * @param {number} [assumptions.totalDebt=0] - Total debt for equity bridge ($M).
 * @param {number} [assumptions.cash=0] - Cash & equivalents for equity bridge ($M).
 *
 * @returns {Object} Full DCF output including projections, terminal value, enterprise value,
 *                    equity value, implied multiples, and sensitivity grid.
 */
export function calcDCF(financials, assumptions) {
  const {
    revenueGrowth,
    ebitdaMargins,
    wacc,
    terminalGrowthRate,
    taxRate,
    capexPct,
    daPct,
    wcPct,
    totalDebt = 0,
    cash = 0,
  } = assumptions;

  const years = revenueGrowth.length; // typically 5
  const projections = [];

  let prevRevenue = financials.revenue;

  for (let i = 0; i < years; i++) {
    const year = i + 1;
    const revenue = prevRevenue * (1 + revenueGrowth[i]);
    const ebitda = revenue * ebitdaMargins[i];
    const da = revenue * daPct;
    const ebit = ebitda - da;
    const tax = Math.max(0, ebit * taxRate);
    const nopat = ebit - tax;
    const capex = revenue * capexPct;
    const revenueChange = revenue - prevRevenue;
    const wcChange = revenueChange * wcPct;
    const fcf = nopat + da - capex - wcChange;

    const discountFactor = 1 / Math.pow(1 + wacc, year);
    const pvFcf = fcf * discountFactor;

    projections.push({
      year,
      revenue: round(revenue, 2),
      ebitda: round(ebitda, 2),
      ebitdaMargin: round(ebitdaMargins[i] * 100, 1),
      da: round(da, 2),
      ebit: round(ebit, 2),
      tax: round(tax, 2),
      nopat: round(nopat, 2),
      capex: round(capex, 2),
      wcChange: round(wcChange, 2),
      fcf: round(fcf, 2),
      discountFactor: round(discountFactor, 6),
      pvFcf: round(pvFcf, 2),
    });

    prevRevenue = revenue;
  }

  // Terminal value using Gordon Growth Model on last year's FCF
  const lastProjection = projections[projections.length - 1];
  const terminalFcf = lastProjection.fcf * (1 + terminalGrowthRate);
  const terminalValue = terminalFcf / (wacc - terminalGrowthRate);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, years);

  // Sum of PV of projected FCFs
  const sumPvFcf = projections.reduce((s, p) => s + p.pvFcf, 0);

  const enterpriseValue = sumPvFcf + pvTerminal;
  const equityValue = enterpriseValue - totalDebt + cash;

  // Implied multiples based on last twelve months (base year)
  const impliedMultiples = {
    evEbitda: financials.ebitda !== 0 ? round(enterpriseValue / financials.ebitda, 1) : null,
    evRevenue: financials.revenue !== 0 ? round(enterpriseValue / financials.revenue, 2) : null,
  };

  // Terminal value as % of EV
  const terminalValuePct = enterpriseValue !== 0 ? round((pvTerminal / enterpriseValue) * 100, 1) : 0;

  // Default sensitivity grid: WACC vs Terminal Growth Rate
  const waccValues = [
    wacc - 0.02,
    wacc - 0.01,
    wacc,
    wacc + 0.01,
    wacc + 0.02,
  ];
  const tgrValues = [
    terminalGrowthRate - 0.01,
    terminalGrowthRate - 0.005,
    terminalGrowthRate,
    terminalGrowthRate + 0.005,
    terminalGrowthRate + 0.01,
  ];

  const sensitivityGrid = buildDCFSensitivity(
    financials,
    assumptions,
    waccValues,
    tgrValues
  );

  return {
    projections,
    terminalValue: round(terminalValue, 2),
    pvTerminal: round(pvTerminal, 2),
    sumPvFcf: round(sumPvFcf, 2),
    enterpriseValue: round(enterpriseValue, 2),
    equityValue: round(equityValue, 2),
    impliedMultiples,
    terminalValuePct,
    sensitivityGrid,
  };
}

/**
 * Build a WACC vs Terminal Growth Rate sensitivity grid for DCF equity value.
 * @param {Object} financials
 * @param {Object} baseAssumptions
 * @param {number[]} waccValues
 * @param {number[]} tgrValues
 * @returns {Object}
 */
function buildDCFSensitivity(financials, baseAssumptions, waccValues, tgrValues) {
  // Return shape aligned with the UI (DealDetail ModelTab): plain numeric
  // values, row.label for the y-axis, columns array for headers. Prior shape
  // nested objects inside values which the UI couldn't render.
  const rows = [];
  for (const w of waccValues) {
    const values = [];
    for (const tgr of tgrValues) {
      if (w <= tgr) {
        // Gordon Growth invalid — leave cell blank
        values.push(null);
        continue;
      }
      const adjusted = { ...baseAssumptions, wacc: w, terminalGrowthRate: tgr };
      const result = calcDCFCore(financials, adjusted);
      values.push(round(result.equityValue, 2));
    }
    rows.push({
      label: round(w, 4),    // keep as raw decimal so UI formats via fmt.pct(v * 100)
      wacc:  round(w, 4),    // backwards-compat alias
      values,
    });
  }
  return {
    param1Name: 'wacc',
    param2Name: 'terminalGrowthRate',
    columns: tgrValues.map((v) => round(v, 4)),
    rows,
  };
}

/**
 * Core DCF calculation without sensitivity grid (avoids infinite recursion).
 * @param {Object} financials
 * @param {Object} assumptions
 * @returns {{ enterpriseValue: number, equityValue: number }}
 */
function calcDCFCore(financials, assumptions) {
  const {
    revenueGrowth, ebitdaMargins, wacc, terminalGrowthRate,
    taxRate, capexPct, daPct, wcPct, totalDebt = 0, cash = 0,
  } = assumptions;

  const years = revenueGrowth.length;
  let prevRevenue = financials.revenue;
  let sumPvFcf = 0;
  let lastFcf = 0;

  for (let i = 0; i < years; i++) {
    const revenue = prevRevenue * (1 + revenueGrowth[i]);
    const ebitda = revenue * ebitdaMargins[i];
    const da = revenue * daPct;
    const ebit = ebitda - da;
    const tax = Math.max(0, ebit * taxRate);
    const nopat = ebit - tax;
    const capex = revenue * capexPct;
    const revenueChange = revenue - prevRevenue;
    const wcChange = revenueChange * wcPct;
    const fcf = nopat + da - capex - wcChange;
    const discountFactor = 1 / Math.pow(1 + wacc, i + 1);
    sumPvFcf += fcf * discountFactor;
    lastFcf = fcf;
    prevRevenue = revenue;
  }

  const terminalFcf = lastFcf * (1 + terminalGrowthRate);
  const terminalValue = terminalFcf / (wacc - terminalGrowthRate);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, years);

  const enterpriseValue = sumPvFcf + pvTerminal;
  const equityValue = enterpriseValue - totalDebt + cash;

  return { enterpriseValue, equityValue };
}

// ============================================================
// Trading Comps Valuation
// ============================================================

/**
 * Trading Comparables Valuation.
 *
 * Calculates valuation ranges for a target company based on
 * comparable public company trading multiples.
 *
 * @param {Object} target - Target company financials.
 * @param {number} target.revenue - LTM revenue ($M).
 * @param {number} target.ebitda - LTM EBITDA ($M).
 * @param {number} [target.netIncome] - LTM net income ($M).
 *
 * @param {Array<Object>} comps - Array of comparable companies.
 * @param {string} comps[].company_name
 * @param {number} comps[].ev_ebitda - EV/EBITDA multiple.
 * @param {number} comps[].ev_revenue - EV/Revenue multiple.
 * @param {number} [comps[].pe_ratio] - P/E ratio.
 * @param {number} [comps[].revenue_growth_pct] - Revenue growth %.
 * @param {number} [comps[].ebitda_margin_pct] - EBITDA margin %.
 *
 * @returns {Object} Statistics, implied values, and selected comps.
 */
export function calcTradingComps(target, comps) {
  if (!comps || comps.length === 0) {
    return {
      stats: {},
      impliedValues: {},
      selectedComps: [],
    };
  }

  const selectedComps = comps.map((c) => ({
    company_name: c.company_name,
    ev_ebitda: c.ev_ebitda,
    ev_revenue: c.ev_revenue,
    pe_ratio: c.pe_ratio ?? null,
    revenue_growth_pct: c.revenue_growth_pct ?? null,
    ebitda_margin_pct: c.ebitda_margin_pct ?? null,
  }));

  // Extract multiple arrays (filter out nulls/undefined/NaN)
  const evEbitdaArr = comps.map((c) => c.ev_ebitda).filter(isValidNumber);
  const evRevenueArr = comps.map((c) => c.ev_revenue).filter(isValidNumber);
  const peRatioArr = comps.map((c) => c.pe_ratio).filter(isValidNumber);

  const stats = {};
  const impliedValues = {};

  // EV/EBITDA
  if (evEbitdaArr.length > 0) {
    stats.evEbitda = calcMultipleStats(evEbitdaArr);
    impliedValues.evEbitda = {
      low: round(target.ebitda * stats.evEbitda.p25, 2),
      mid: round(target.ebitda * stats.evEbitda.median, 2),
      high: round(target.ebitda * stats.evEbitda.p75, 2),
    };
  }

  // EV/Revenue
  if (evRevenueArr.length > 0) {
    stats.evRevenue = calcMultipleStats(evRevenueArr);
    impliedValues.evRevenue = {
      low: round(target.revenue * stats.evRevenue.p25, 2),
      mid: round(target.revenue * stats.evRevenue.median, 2),
      high: round(target.revenue * stats.evRevenue.p75, 2),
    };
  }

  // P/E Ratio (equity value, not EV)
  if (peRatioArr.length > 0 && target.netIncome && target.netIncome > 0) {
    stats.peRatio = calcMultipleStats(peRatioArr);
    impliedValues.peRatio = {
      low: round(target.netIncome * stats.peRatio.p25, 2),
      mid: round(target.netIncome * stats.peRatio.median, 2),
      high: round(target.netIncome * stats.peRatio.p75, 2),
    };
  }

  return {
    stats,
    impliedValues,
    selectedComps,
  };
}

/**
 * Calculate statistical summary for a set of multiples.
 * @param {number[]} arr
 * @returns {{ median: number, mean: number, p25: number, p75: number, min: number, max: number, stddev: number, count: number }}
 */
function calcMultipleStats(arr) {
  return {
    median: round(median(arr), 2),
    mean: round(mean(arr), 2),
    p25: round(percentile(arr, 25), 2),
    p75: round(percentile(arr, 75), 2),
    min: round(Math.min(...arr), 2),
    max: round(Math.max(...arr), 2),
    stddev: round(stddev(arr), 2),
    count: arr.length,
  };
}

// ============================================================
// Precedent Transactions Valuation
// ============================================================

/**
 * Precedent Transactions Valuation.
 *
 * Values a target based on historical M&A transaction multiples,
 * optionally applying a control premium.
 *
 * @param {Object} target - Target company financials.
 * @param {number} target.revenue - LTM revenue ($M).
 * @param {number} target.ebitda - LTM EBITDA ($M).
 *
 * @param {Array<Object>} transactions - Array of precedent transactions.
 * @param {string} transactions[].transaction_name
 * @param {number} transactions[].ev_ebitda - Transaction EV/EBITDA.
 * @param {number} transactions[].ev_revenue - Transaction EV/Revenue.
 * @param {number} [transactions[].premium_pct] - Acquisition premium %.
 *
 * @param {number} [controlPremium=0] - Additional control premium (decimal, e.g., 0.25 for 25%).
 *
 * @returns {Object} Statistics and implied values with control premium applied.
 */
export function calcPrecedentTransactions(target, transactions, controlPremium = 0) {
  if (!transactions || transactions.length === 0) {
    return {
      stats: {},
      impliedValues: {},
      transactions: [],
    };
  }

  const selectedTransactions = transactions.map((t) => ({
    transaction_name: t.transaction_name,
    ev_ebitda: t.ev_ebitda,
    ev_revenue: t.ev_revenue,
    premium_pct: t.premium_pct ?? null,
  }));

  const evEbitdaArr = transactions.map((t) => t.ev_ebitda).filter(isValidNumber);
  const evRevenueArr = transactions.map((t) => t.ev_revenue).filter(isValidNumber);
  const premiumArr = transactions.map((t) => t.premium_pct).filter(isValidNumber);

  const stats = {};
  const impliedValues = {};

  // EV/EBITDA from precedents
  if (evEbitdaArr.length > 0) {
    stats.evEbitda = {
      median: round(median(evEbitdaArr), 2),
      mean: round(mean(evEbitdaArr), 2),
      min: round(Math.min(...evEbitdaArr), 2),
      max: round(Math.max(...evEbitdaArr), 2),
      count: evEbitdaArr.length,
    };
    const baseEv = target.ebitda * stats.evEbitda.median;
    const premiumMultiplier = 1 + controlPremium;
    impliedValues.evEbitda = {
      low: round(target.ebitda * stats.evEbitda.min * premiumMultiplier, 2),
      mid: round(baseEv * premiumMultiplier, 2),
      high: round(target.ebitda * stats.evEbitda.max * premiumMultiplier, 2),
    };
  }

  // EV/Revenue from precedents
  if (evRevenueArr.length > 0) {
    stats.evRevenue = {
      median: round(median(evRevenueArr), 2),
      mean: round(mean(evRevenueArr), 2),
      min: round(Math.min(...evRevenueArr), 2),
      max: round(Math.max(...evRevenueArr), 2),
      count: evRevenueArr.length,
    };
    const premiumMultiplier = 1 + controlPremium;
    impliedValues.evRevenue = {
      low: round(target.revenue * stats.evRevenue.min * premiumMultiplier, 2),
      mid: round(target.revenue * stats.evRevenue.median * premiumMultiplier, 2),
      high: round(target.revenue * stats.evRevenue.max * premiumMultiplier, 2),
    };
  }

  // Premium statistics
  if (premiumArr.length > 0) {
    stats.premium = {
      median: round(median(premiumArr), 1),
      mean: round(mean(premiumArr), 1),
      min: round(Math.min(...premiumArr), 1),
      max: round(Math.max(...premiumArr), 1),
      count: premiumArr.length,
    };
  }

  return {
    stats,
    impliedValues,
    transactions: selectedTransactions,
    controlPremium: round(controlPremium * 100, 1),
  };
}

// ============================================================
// Football Field (Summary Valuation)
// ============================================================

/**
 * Football Field aggregation of all valuation methodologies.
 *
 * Combines DCF, Trading Comps, and Precedent Transactions into
 * a single summary with weighted blended value.
 *
 * Weights: 40% DCF, 30% Trading Comps, 30% Precedent Transactions.
 *
 * @param {Object} dcfResult - Output from calcDCF().
 * @param {Object} compsResult - Output from calcTradingComps().
 * @param {Object} precedentResult - Output from calcPrecedentTransactions().
 *
 * @returns {Object} methods array and blended value range.
 */
export function calcFootballField(dcfResult, compsResult, precedentResult) {
  const methods = [];

  // DCF method
  if (dcfResult && dcfResult.equityValue != null) {
    // Use sensitivity grid to derive low/high, or +/- 15% as fallback
    const grid = dcfResult.sensitivityGrid;
    let low, high;

    if (grid && grid.rows && grid.rows.length > 0) {
      const allValues = grid.rows
        .flatMap((r) => r.values.map((v) => v.value))
        .filter(isValidNumber);

      if (allValues.length > 0) {
        low = Math.min(...allValues);
        high = Math.max(...allValues);
      }
    }

    if (low == null) low = dcfResult.equityValue * 0.85;
    if (high == null) high = dcfResult.equityValue * 1.15;

    methods.push({
      name: 'DCF',
      low: round(low, 2),
      mid: round(dcfResult.equityValue, 2),
      high: round(high, 2),
      weight: 0.4,
    });
  }

  // Trading Comps (use EV/EBITDA implied values as primary)
  if (compsResult && compsResult.impliedValues) {
    const iv = compsResult.impliedValues.evEbitda || compsResult.impliedValues.evRevenue;
    if (iv) {
      methods.push({
        name: 'Trading Comps',
        low: round(iv.low, 2),
        mid: round(iv.mid, 2),
        high: round(iv.high, 2),
        weight: 0.3,
      });
    }
  }

  // Precedent Transactions (use EV/EBITDA implied values as primary)
  if (precedentResult && precedentResult.impliedValues) {
    const iv = precedentResult.impliedValues.evEbitda || precedentResult.impliedValues.evRevenue;
    if (iv) {
      methods.push({
        name: 'Precedent Transactions',
        low: round(iv.low, 2),
        mid: round(iv.mid, 2),
        high: round(iv.high, 2),
        weight: 0.3,
      });
    }
  }

  // Normalize weights if some methods are missing
  const totalWeight = methods.reduce((s, m) => s + m.weight, 0);
  if (totalWeight > 0 && totalWeight !== 1) {
    for (const m of methods) {
      m.weight = round(m.weight / totalWeight, 4);
    }
  }

  // Blended value
  let blendedLow = 0;
  let blendedMid = 0;
  let blendedHigh = 0;

  for (const m of methods) {
    blendedLow += m.low * m.weight;
    blendedMid += m.mid * m.weight;
    blendedHigh += m.high * m.weight;
  }

  const blendedValue = {
    low: round(blendedLow, 2),
    mid: round(blendedMid, 2),
    high: round(blendedHigh, 2),
    weighted: round(blendedMid, 2), // alias for mid as the headline number
  };

  return {
    methods,
    blendedValue,
  };
}

// ============================================================
// Generic 2D Sensitivity Grid
// ============================================================

/**
 * Generic 2D sensitivity analysis grid.
 *
 * Varies two parameters across given ranges and records the output
 * of a user-supplied calculation function.
 *
 * @param {Object} baseAssumptions - Base set of assumptions.
 * @param {string} param1Name - Name of the row parameter (e.g., 'wacc').
 * @param {number[]} param1Values - Array of values for the row parameter.
 * @param {string} param2Name - Name of the column parameter (e.g., 'terminalGrowthRate').
 * @param {number[]} param2Values - Array of values for the column parameter.
 * @param {Function} calcFn - function(assumptions) => number. Receives modified assumptions, returns a scalar.
 *
 * @returns {Object} Grid with rows, each containing an array of {param2, value} entries.
 */
export function sensitivityGrid(baseAssumptions, param1Name, param1Values, param2Name, param2Values, calcFn) {
  const rows = [];

  for (const p1 of param1Values) {
    const values = [];
    for (const p2 of param2Values) {
      const modified = {
        ...baseAssumptions,
        [param1Name]: p1,
        [param2Name]: p2,
      };

      let value;
      try {
        value = calcFn(modified);
        value = round(value, 2);
      } catch {
        value = null;
      }

      values.push({ [param2Name]: p2, value });
    }
    rows.push({ [param1Name]: p1, values });
  }

  return {
    param1Name,
    param2Name,
    param1Values,
    param2Values,
    rows,
  };
}

// ============================================================
// Utility Helpers
// ============================================================

/**
 * Round a number to N decimal places.
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function round(value, decimals) {
  if (value == null || !isFinite(value)) return value;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Check if a value is a valid finite number.
 * @param {*} v
 * @returns {boolean}
 */
function isValidNumber(v) {
  return v != null && typeof v === 'number' && isFinite(v);
}

// ============================================================
// NPV Helper (exported for convenience)
// ============================================================

/**
 * Net Present Value.
 * @param {number} discountRate - Discount rate as decimal.
 * @param {number[]} cashFlows - Array where index 0 is period 0 (typically negative).
 * @returns {number}
 */
export function calcNPV(discountRate, cashFlows) {
  let npv = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    npv += cashFlows[t] / Math.pow(1 + discountRate, t);
  }
  return round(npv, 2);
}

/**
 * Payback period in years.
 * @param {number[]} cashFlows - Index 0 is investment (negative), rest are periodic cash flows.
 * @returns {number|null} Years to payback, null if never achieved.
 */
export function calcPaybackPeriod(cashFlows) {
  if (!cashFlows || cashFlows.length < 2) return null;

  let cumulative = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    cumulative += cashFlows[t];
    if (cumulative >= 0 && t > 0) {
      // Interpolate within the period
      const prevCumulative = cumulative - cashFlows[t];
      const fraction = -prevCumulative / cashFlows[t];
      return round(t - 1 + fraction, 2);
    }
  }
  return null; // Never breaks even
}

/**
 * WACC Calculator.
 * @param {Object} params
 * @param {number} params.equityValue - Market cap ($M).
 * @param {number} params.debtValue - Market value of debt ($M).
 * @param {number} params.costOfEquity - Decimal (e.g., 0.12).
 * @param {number} params.costOfDebt - Pre-tax cost of debt (decimal).
 * @param {number} params.taxRate - Corporate tax rate (decimal).
 * @returns {number} WACC as decimal.
 */
export function calcWACC(params) {
  const { equityValue, debtValue, costOfEquity, costOfDebt, taxRate } = params;
  const totalCapital = equityValue + debtValue;
  if (totalCapital === 0) return 0;

  const equityWeight = equityValue / totalCapital;
  const debtWeight = debtValue / totalCapital;

  const wacc = equityWeight * costOfEquity + debtWeight * costOfDebt * (1 - taxRate);
  return round(wacc, 6);
}
