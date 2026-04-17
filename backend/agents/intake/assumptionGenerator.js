// ---------------------------------------------------------------------------
// assumptionGenerator.js
// ---------------------------------------------------------------------------
// After extraction completes, seed a reasonable set of valuation assumptions
// so the user can hit "Build Model" immediately without hand-entering 15 rows.
// Uses sector-sensitive defaults + historic margins from the loaded financials.
// ---------------------------------------------------------------------------

const SECTOR_DEFAULTS = {
  // growth, term_growth, wacc, tax, capex, da, wc, control_premium (all as %)
  'Software':             { growth: 22, term: 3.0, wacc: 10.5, tax: 24, capex: 3,  da: 4,  wc: 5,  premium: 30 },
  'SaaS':                 { growth: 25, term: 3.0, wacc: 10.5, tax: 24, capex: 3,  da: 4,  wc: 5,  premium: 30 },
  'Healthcare':           { growth: 15, term: 2.5, wacc: 9.5,  tax: 25, capex: 5,  da: 7,  wc: 8,  premium: 28 },
  'HealthTech':           { growth: 20, term: 3.0, wacc: 11.0, tax: 24, capex: 4,  da: 6,  wc: 7,  premium: 30 },
  'FinTech':              { growth: 20, term: 3.0, wacc: 11.5, tax: 25, capex: 4,  da: 5,  wc: 6,  premium: 28 },
  'Cybersecurity':        { growth: 22, term: 3.0, wacc: 11.0, tax: 24, capex: 3,  da: 5,  wc: 5,  premium: 30 },
  'Industrial IoT':       { growth: 15, term: 2.5, wacc: 10.0, tax: 26, capex: 6,  da: 8,  wc: 10, premium: 25 },
  'Industrial':           { growth: 8,  term: 2.0, wacc: 9.0,  tax: 26, capex: 8,  da: 10, wc: 12, premium: 20 },
  'Consumer':             { growth: 10, term: 2.5, wacc: 9.0,  tax: 25, capex: 5,  da: 6,  wc: 10, premium: 22 },
  'Energy':               { growth: 6,  term: 2.0, wacc: 8.5,  tax: 27, capex: 15, da: 12, wc: 8,  premium: 20 },
  'default':              { growth: 15, term: 2.5, wacc: 10.0, tax: 25, capex: 5,  da: 7,  wc: 8,  premium: 25 },
};

function pickSectorDefaults(sector) {
  if (!sector) return SECTOR_DEFAULTS.default;
  const key = Object.keys(SECTOR_DEFAULTS).find(
    (k) => k.toLowerCase() === String(sector).toLowerCase()
  );
  return key ? SECTOR_DEFAULTS[key] : SECTOR_DEFAULTS.default;
}

/**
 * Create a full set of valuation_assumptions rows for a deal.
 *
 * Blends sector defaults with *observed* performance from the loaded
 * financials: if the company actually grew 42% last year and has a 22%
 * EBITDA margin, we anchor Year-1 assumptions on those observations rather
 * than on a generic sector floor.
 *
 * @param {object} db
 * @param {string} dealId
 * @param {object} pipelineResult  - result from runIntakePipeline (for sector)
 */
export async function generateAssumptionsForDeal(db, dealId, pipelineResult) {
  const deal = db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const sector =
    pipelineResult?.classification?.classification?.primary_sector ||
    deal.sector ||
    'default';

  // Pull all financials to compute trajectory and margin trend
  const fins = db.all(
    `SELECT period, revenue, ebitda, ebitda_margin_pct, revenue_growth_pct, free_cash_flow
     FROM target_company_financials
     WHERE deal_id = ?
     ORDER BY period ASC`,
    dealId
  );
  const latest = fins[fins.length - 1];

  const d = pickSectorDefaults(sector);

  // Observed starting growth — prefer the most recent reported growth,
  // else compute from the last two periods.
  let observedGrowth = null;
  if (latest?.revenue_growth_pct != null) {
    observedGrowth = latest.revenue_growth_pct;
  } else if (fins.length >= 2) {
    const a = fins[fins.length - 2].revenue;
    const b = latest?.revenue;
    if (a && b) observedGrowth = ((b - a) / Math.abs(a)) * 100;
  }

  // Starting growth assumption: slightly below observed (companies tend to
  // decelerate from reported peaks), but not more than 2x sector default.
  const startGrowth = observedGrowth != null
    ? Math.max(d.growth - 5, Math.min(observedGrowth * 0.85, d.growth * 2))
    : d.growth;

  // Decay growth toward sector steady-state over 5 years
  const endGrowth = Math.max(d.growth / 2, Math.min(d.term + 3, startGrowth / 3));
  const growthCurve = [];
  for (let y = 0; y < 5; y++) {
    growthCurve.push(round1(startGrowth + (endGrowth - startGrowth) * (y / 4)));
  }

  // Starting EBITDA margin: use observed if available, else sector default (25%)
  const startMargin = latest?.ebitda_margin_pct ?? 25;
  // End-year margin: expand +7pts for typical PE thesis (bounded 15-45)
  const endMargin = Math.max(15, Math.min(45, startMargin + 7));

  const growthRationale = observedGrowth != null
    ? `Anchored on observed FY growth of ${round1(observedGrowth)}% (${latest?.period || 'latest'})`
    : `Sector default for ${sector}`;

  // Rows to insert: (name, base, upside, downside, unit, rationale)
  const rows = [
    // 5-year revenue growth curve (observation-anchored, tapering to steady-state)
    ['Revenue Growth Year 1', growthCurve[0], round1(growthCurve[0] + 5), round1(growthCurve[0] - 5), '%', growthRationale],
    ['Revenue Growth Year 2', growthCurve[1], round1(growthCurve[1] + 4), round1(growthCurve[1] - 6), '%', 'Tapering toward steady-state'],
    ['Revenue Growth Year 3', growthCurve[2], round1(growthCurve[2] + 3), round1(growthCurve[2] - 6), '%', 'Mid-horizon taper'],
    ['Revenue Growth Year 4', growthCurve[3], round1(growthCurve[3] + 2), round1(growthCurve[3] - 5), '%', 'Maturation'],
    ['Revenue Growth Year 5', growthCurve[4], round1(growthCurve[4] + 2), round1(growthCurve[4] - 4), '%', 'Terminal approach'],

    // Margins
    ['EBITDA Margin Year 1', round1(startMargin),     round1(startMargin + 2), round1(startMargin - 2), '%', latest ? `Observed FY margin (${latest.period})` : 'Sector default'],
    ['EBITDA Margin Year 5', round1(endMargin),       round1(endMargin + 3),   round1(endMargin - 3),   '%', 'Expansion thesis'],

    // Discount & terminal
    ['WACC',                  d.wacc,       d.wacc - 0.5, d.wacc + 1.0, '%', `Sector beta estimate for ${sector}`],
    ['Terminal Growth Rate',  d.term,       d.term + 0.5, d.term - 0.5, '%', 'Long-run GDP proxy'],

    // Cost drivers
    ['Tax Rate',              d.tax,        d.tax,        d.tax,        '%', 'Blended corporate rate'],
    ['Capex as % of Revenue', d.capex,      d.capex - 1,  d.capex + 1,  '%', 'Sector capex intensity'],
    ['D&A as % of Revenue',   d.da,         d.da,         d.da,         '%', 'Sector default'],
    ['Working Capital as % of Revenue', d.wc, d.wc - 2,   d.wc + 2,     '%', 'Historic WC intensity'],

    // Transaction
    ['Control Premium',       d.premium,    d.premium + 10, d.premium - 5, '%', 'Typical M&A premium for sector'],

    // Exit multiple
    ['Exit EV/EBITDA Multiple', 10,  12,    8,   'x', 'Anchored to trading comps'],
  ];

  db.transaction(() => {
    for (const [name, base, up, down, unit, rationale] of rows) {
      db.run(
        `INSERT INTO valuation_assumptions (deal_id, assumption_name, base_case, upside_case, downside_case, unit, source_rationale, data_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'auto-generated')`,
        dealId, name, base, up, down, unit, rationale
      );
    }
  });

  return {
    inserted: rows.length,
    sector,
    observedGrowth: observedGrowth != null ? round1(observedGrowth) : null,
    observedMargin: startMargin != null ? round1(startMargin) : null,
  };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
