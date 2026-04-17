import { auditLog } from './database.js';
import {
  calcDCF,
  calcTradingComps,
  calcPrecedentTransactions,
  calcFootballField,
  calcIRR,
  calcMOIC,
  sensitivityGrid,
} from './models/math.js';

/**
 * Convert raw sensitivityGrid output into the shape the DealDetail UI renders:
 *   { param1Name, param2Name, columns, rows: [{ label, values: [num,...] }] }
 */
function normalizeSensitivity(grid) {
  if (!grid || !grid.rows) return null;
  return {
    param1Name: grid.param1Name,
    param2Name: grid.param2Name,
    columns: grid.param2Values,
    rows: grid.rows.map(r => ({
      label: r[grid.param1Name],
      values: (r.values || []).map(c => (typeof c === 'object' ? c.value : c)),
    })),
  };
}

export function seedDatabase(db) {
  const count = db.get('SELECT COUNT(*) as c FROM deal_pipeline');
  if (count && count.c > 0) return;

  console.log('Seeding database with sample data...');

  db.transaction(() => {
    // ================================================================
    // 1. DEALS
    // ================================================================
    // Deal-size estimates are calibrated so the blended-model EV lands within ±15%
    // of the estimate for most deals, with deliberate signals:
    //   Falcon / Raven = upside    (blended > estimate)
    //   Eagle  / Condor = fair     (blended ≈ estimate)
    //   Sparrow         = mild upside (why it was passed is customer concentration, not price)
    //   Hawk            = risk     (blended < estimate — current ask overpriced)
    const deals = [
      ['DEAL-001', 'Project Falcon',  'due_diligence', 'Enterprise SaaS',  'CloudMetrics Inc.',   780, 'Sarah Chen',   '2024-01-15', '2024-06-30', 'Strong revenue growth, evaluating margin expansion potential'],
      ['DEAL-002', 'Project Eagle',   'screening',     'HealthTech',       'MediFlow Health',     325, 'James Porter', '2024-02-20', '2024-09-15', 'Initial review of regulatory landscape'],
      ['DEAL-003', 'Project Hawk',    'negotiation',   'FinTech',          'PayStream Financial', 520, 'Sarah Chen',   '2023-11-05', '2024-04-30', 'Term sheet under review — current ask looks rich, negotiating earnout'],
      ['DEAL-004', 'Project Condor',  'closed',        'Industrial IoT',   'SensorWorks Ltd.',    180, 'David Kim',    '2023-08-10', '2024-01-15', 'Deal closed at 8.2x EBITDA. Integration underway.'],
      ['DEAL-005', 'Project Sparrow', 'passed',        'Cybersecurity',    'ShieldAI Corp.',      470, 'James Porter', '2023-12-01', null,          'Passed due to customer concentration risk (top 3 = 68% rev)'],
      ['DEAL-006', 'Project Raven',   'screening',     'Enterprise SaaS',  'DataPulse Analytics', 920, 'David Kim',    '2024-03-01', '2024-10-30', 'Inbound from advisor. Strong initial materials.']
    ];

    const dealStmt = db.prepare(
      `INSERT INTO deal_pipeline (deal_id, deal_name, stage, sector, target_company, deal_size_estimate, lead_analyst, date_entered, expected_close, status_notes, is_dummy, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sample')`
    );
    deals.forEach(d => dealStmt.run(...d));

    // ================================================================
    // 2. TARGET COMPANY FINANCIALS (6 companies × 3 years each)
    // ================================================================
    const financials = [
      // CloudMetrics — High-growth SaaS (DEAL-001)
      ['DEAL-001', 'CloudMetrics Inc.',   'FY2021', 42,  null, 29.4,  70.0,  5.04, 12.0,  1.26, 85, 12, 3.36, 180],
      ['DEAL-001', 'CloudMetrics Inc.',   'FY2022', 63,  50.0, 44.1,  70.0, 11.34, 18.0,  4.41, 120, 15, 7.56, 260],
      ['DEAL-001', 'CloudMetrics Inc.',   'FY2023', 89,  41.3, 62.3,  70.0, 20.47, 23.0,  8.90, 165, 18, 14.24, 350],

      // MediFlow — Steady healthcare (DEAL-002)
      ['DEAL-002', 'MediFlow Health',     'FY2021', 58,  null, 33.64, 58.0, 10.44, 18.0,  5.22, 95, 22, 6.96, 420],
      ['DEAL-002', 'MediFlow Health',     'FY2022', 65,  12.1, 37.7,  58.0, 12.35, 19.0,  6.50, 108, 24, 8.45, 460],
      ['DEAL-002', 'MediFlow Health',     'FY2023', 72,  10.8, 41.76, 58.0, 14.40, 20.0,  7.92, 122, 25, 10.08, 510],

      // PayStream — High-growth fintech (DEAL-003)
      ['DEAL-003', 'PayStream Financial', 'FY2021', 35,  null, 17.5,  50.0, -3.50, -10.0, -7.00, 60, 30, -10.50, 150],
      ['DEAL-003', 'PayStream Financial', 'FY2022', 70, 100.0, 38.5,  55.0,  3.50,   5.0, -2.10, 110, 45,  -5.60, 280],
      ['DEAL-003', 'PayStream Financial', 'FY2023', 112, 60.0, 64.96, 58.0, 14.56,  13.0,  5.60, 175, 50,   4.48, 420],

      // SensorWorks — Mature industrial IoT (DEAL-004)
      ['DEAL-004', 'SensorWorks Ltd.',    'FY2021', 38,  null, 17.1,  45.0,  7.60, 20.0,  4.18, 55, 10, 5.32, 200],
      ['DEAL-004', 'SensorWorks Ltd.',    'FY2022', 41,   7.9, 18.45, 45.0,  8.61, 21.0,  4.92, 60, 11, 6.15, 210],
      ['DEAL-004', 'SensorWorks Ltd.',    'FY2023', 44,   7.3, 19.8,  45.0,  9.68, 22.0,  5.72, 65, 12, 7.04, 220],

      // ShieldAI — Mid-growth cybersecurity (DEAL-005)
      ['DEAL-005', 'ShieldAI Corp.',      'FY2021', 28,  null, 19.6,  70.0,  2.80, 10.0,  0.56, 45,  8, 1.12, 120],
      ['DEAL-005', 'ShieldAI Corp.',      'FY2022', 42,  50.0, 29.4,  70.0,  6.30, 15.0,  2.52, 68, 10, 3.78, 170],
      ['DEAL-005', 'ShieldAI Corp.',      'FY2023', 58,  38.1, 40.6,  70.0, 10.44, 18.0,  4.64, 92, 12, 6.96, 230],

      // DataPulse — Emerging SaaS (DEAL-006)
      ['DEAL-006', 'DataPulse Analytics', 'FY2021', 48,  null, 31.2,  65.0,  4.80, 10.0,  0.96, 78, 14, 2.40, 190],
      ['DEAL-006', 'DataPulse Analytics', 'FY2022', 76,  58.3, 51.68, 68.0, 13.68, 18.0,  5.32, 125, 17, 9.12, 310],
      ['DEAL-006', 'DataPulse Analytics', 'FY2023', 108, 42.1, 75.6,  70.0, 23.76, 22.0, 10.80, 190, 20, 17.28, 420],
    ];

    const finStmt = db.prepare(
      `INSERT INTO target_company_financials (deal_id, company_name, period, revenue, revenue_growth_pct, gross_profit, gross_margin_pct, ebitda, ebitda_margin_pct, net_income, total_assets, total_debt, free_cash_flow, employees, is_dummy, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sample')`
    );
    financials.forEach(f => finStmt.run(...f));

    // ================================================================
    // 3. COMPARABLE COMPANIES (19 public comps)
    // ================================================================
    const comps = [
      ['Datadog',      'DDOG', 'Enterprise SaaS', 65.2, 18.5, 85.0,  25.3, 28.1, 45000, '2024-01-15'],
      ['Snowflake',    'SNOW', 'Enterprise SaaS', 145.0, 28.5, null, 32.8,  5.2, 62000, '2024-01-15'],
      ['MongoDB',      'MDB',  'Enterprise SaaS', 52.3, 15.8, 120.0, 28.5, 18.3, 32000, '2024-01-15'],
      ['HubSpot',      'HUBS', 'Enterprise SaaS', 42.1, 13.2, 68.5,  22.1, 21.5, 28000, '2024-01-15'],
      ['Confluent',    'CFLT', 'Enterprise SaaS', 78.5, 12.1, null,  30.2, 12.4,  9500, '2024-01-15'],
      ['Veeva Systems', 'VEEV','HealthTech',      38.2, 14.5, 55.0,  12.5, 32.1, 35000, '2024-01-15'],
      ['Doximity',     'DOCS', 'HealthTech',      32.8, 20.5, 42.0,  18.2, 48.5,  8500, '2024-01-15'],
      ['Phreesia',     'PHR',  'HealthTech',      55.0,  6.2, null,  22.4,  8.5,  3200, '2024-01-15'],
      ['Health Catalyst','HCAT','HealthTech',     28.5,  4.8, null,  15.3, -5.2,  1800, '2024-01-15'],
      ['Bill Holdings','BILL', 'FinTech',         85.3, 14.2, null,  18.5, 12.3, 10500, '2024-01-15'],
      ['Paycom',       'PAYC', 'FinTech',         28.5,  9.8, 38.5,  12.8, 32.5, 12000, '2024-01-15'],
      ['Marqeta',      'MQ',   'FinTech',         42.1,  5.5, null,  25.3, -8.5,  3500, '2024-01-15'],
      ['Flywire',      'FLYW', 'FinTech',         35.2,  8.5, 65.0,  28.5, 10.2,  3200, '2024-01-15'],
      ['Samsara',      'IOT',  'Industrial IoT',  120.5, 12.8, null, 35.2,  5.8, 12500, '2024-01-15'],
      ['PTC',          'PTC',  'Industrial IoT',  22.5,  8.2, 35.0,  10.5, 28.5, 18000, '2024-01-15'],
      ['Trimble',      'TRMB', 'Industrial IoT',  18.2,  6.5, 28.0,   8.5, 22.1, 15000, '2024-01-15'],
      ['CrowdStrike',  'CRWD', 'Cybersecurity',   72.5, 25.8, 95.0,  32.5, 22.8, 75000, '2024-01-15'],
      ['Zscaler',      'ZS',   'Cybersecurity',   88.3, 22.1, 110.0, 35.2, 18.5, 42000, '2024-01-15'],
      ['SentinelOne',  'S',    'Cybersecurity',   120.0, 12.5, null, 42.8, -12.5, 8500, '2024-01-15']
    ];

    const compStmt = db.prepare(
      `INSERT INTO comparable_companies (company_name, ticker, sector, ev_ebitda, ev_revenue, pe_ratio, revenue_growth_pct, ebitda_margin_pct, market_cap, as_of_date, is_dummy, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sample')`
    );
    comps.forEach(c => compStmt.run(...c));

    // ================================================================
    // 4. PRECEDENT TRANSACTIONS (12 M&A)
    // ================================================================
    const transactions = [
      ['Thoma Bravo / Coupa Software',   '2022-12-12', '2023-02-27', 'Thoma Bravo',      'Coupa Software',    'Enterprise SaaS',  8000, 32.5, 10.2, 25.3],
      ['Vista Equity / Avalara',         '2022-08-08', '2022-11-01', 'Vista Equity',     'Avalara',           'Enterprise SaaS',  8400, 45.2, 12.5, 28.5],
      ['Salesforce / Slack',             '2020-12-01', '2021-07-21', 'Salesforce',       'Slack',             'Enterprise SaaS', 27700, 55.0, 25.5, 45.0],
      ['Oracle / Cerner',                '2021-12-20', '2022-06-08', 'Oracle',           'Cerner',            'HealthTech',      28300, 22.5,  5.2, 18.5],
      ['UnitedHealth / Change Healthcare','2021-01-06','2022-10-03', 'UnitedHealth',     'Change Healthcare', 'HealthTech',      13000, 18.2,  4.5, 22.0],
      ['Thoma Bravo / Qlik',             '2024-06-01',  null,        'Thoma Bravo',      'Qlik Technologies', 'Enterprise SaaS',  5800, 28.5,  8.5, 32.1],
      ['FIS / Worldpay',                 '2019-03-18', '2019-07-31', 'FIS',              'Worldpay',          'FinTech',         43000, 15.2,  5.8, 12.5],
      ['Visa / Plaid',                   '2020-01-13',  null,        'Visa',             'Plaid',             'FinTech',          5300, null, 42.0, 55.0],
      ['Emerson / AspenTech',            '2021-10-11', '2022-05-16', 'Emerson Electric', 'AspenTech',         'Industrial IoT',  11000, 32.5, 12.8, 25.0],
      ['Honeywell / Intelligrated',      '2016-08-10', '2016-10-01', 'Honeywell',        'Intelligrated',     'Industrial IoT',   1500, 12.5,  1.8, 15.0],
      ['Broadcom / Symantec Enterprise', '2019-08-08', '2019-11-04', 'Broadcom',         'Symantec',          'Cybersecurity',   10700, 12.8,  4.5, 18.0],
      ['Thales / Imperva',               '2018-10-12', '2019-03-12', 'Thales Group',     'Imperva',           'Cybersecurity',    3600, 42.0,  9.5, 35.2]
    ];

    const txnStmt = db.prepare(
      `INSERT INTO comparable_transactions (transaction_name, announcement_date, close_date, acquirer, target, sector, deal_value, ev_ebitda, ev_revenue, premium_pct, is_dummy, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sample')`
    );
    transactions.forEach(t => txnStmt.run(...t));

    // ================================================================
    // 5. DEAL-LEVEL ASSUMPTIONS (per-deal, tuned to profile)
    // ================================================================
    //
    // Each profile = base case values. Upside = +5pts growth/margin, -1.5pts WACC.
    // Downside = -10pts growth/margin, +2pts WACC.

    // [name, base, upside, downside, unit, rationale]
    function assumptionsFor(profile) {
      return [
        ['Revenue Growth Year 1', profile.g1, profile.g1 + 7, profile.g1 - 10, '%', `FY23 growth ${profile.observedGrowth}%, moderated for scale`],
        ['Revenue Growth Year 2', profile.g2, profile.g2 + 6, profile.g2 - 8,  '%', 'Natural deceleration'],
        ['Revenue Growth Year 3', profile.g3, profile.g3 + 5, profile.g3 - 7,  '%', 'Continued deceleration toward maturity'],
        ['Revenue Growth Year 4', profile.g4, profile.g4 + 4, profile.g4 - 5,  '%', 'Approaching steady state'],
        ['Revenue Growth Year 5', profile.g5, profile.g5 + 3, profile.g5 - 4,  '%', 'Steady state growth'],
        ['EBITDA Margin Year 1',  profile.m1, profile.m1 + 3, profile.m1 - 3,  '%', `FY23 margin ${profile.observedMargin}%, operating leverage upside`],
        ['EBITDA Margin Year 5',  profile.m5, profile.m5 + 5, profile.m5 - 5,  '%', `Mature sector margin target`],
        ['WACC',                  profile.wacc, profile.wacc - 1.5, profile.wacc + 2, '%', 'Sector beta + risk-free'],
        ['Terminal Growth Rate',  profile.tg, profile.tg + 0.5, profile.tg - 0.5, '%', 'Long-run GDP proxy'],
        ['Tax Rate',              profile.tax, profile.tax, profile.tax,        '%', 'Blended US effective'],
        ['Capex as % of Revenue', profile.capex, profile.capex - 1, profile.capex + 1, '%', 'Sector capex intensity'],
        ['D&A as % of Revenue',   profile.da, profile.da, profile.da,           '%', 'Sector default'],
        ['Working Capital as % of Revenue', profile.wc, profile.wc - 2, profile.wc + 2, '%', 'Historic WC intensity'],
        ['Exit Multiple (EV/EBITDA)', profile.exit, profile.exit + 6, profile.exit - 4, 'x', 'Based on trading comps'],
        ['Control Premium',       profile.prem, profile.prem + 5, profile.prem - 5, '%', 'Typical M&A premium'],
      ];
    }

    // Profile per deal — tuned to the observed financials
    const dealProfiles = {
      'DEAL-001': { // CloudMetrics — High-growth SaaS, 41% FY23 growth, 23% margin
        observedGrowth: 41, observedMargin: 23,
        g1: 35, g2: 30, g3: 25, g4: 20, g5: 18,
        m1: 25, m5: 32, wacc: 11.0, tg: 3.0, tax: 25,
        capex: 5, da: 8, wc: 10, exit: 22, prem: 25,
      },
      'DEAL-002': { // MediFlow — Steady HealthTech, 11% growth, 20% margin
        observedGrowth: 11, observedMargin: 20,
        g1: 12, g2: 11, g3: 10, g4: 9, g5: 8,
        m1: 21, m5: 26, wacc: 9.5, tg: 2.5, tax: 25,
        capex: 5, da: 7, wc: 8, exit: 15, prem: 25,
      },
      'DEAL-003': { // PayStream — High-growth FinTech, 60% growth, 13% margin
        observedGrowth: 60, observedMargin: 13,
        g1: 45, g2: 38, g3: 30, g4: 22, g5: 18,
        m1: 15, m5: 25, wacc: 11.5, tg: 3.0, tax: 25,
        capex: 4, da: 5, wc: 6, exit: 18, prem: 28,
      },
      'DEAL-004': { // SensorWorks — Mature Industrial IoT, 7% growth, 22% margin
        observedGrowth: 7, observedMargin: 22,
        g1: 8, g2: 8, g3: 7, g4: 6, g5: 5,
        m1: 22, m5: 26, wacc: 9.0, tg: 2.0, tax: 26,
        capex: 8, da: 10, wc: 12, exit: 10, prem: 20,
      },
      'DEAL-005': { // ShieldAI — Mid-growth Cybersecurity, 38% growth, 18% margin
        observedGrowth: 38, observedMargin: 18,
        g1: 30, g2: 26, g3: 22, g4: 18, g5: 15,
        m1: 20, m5: 28, wacc: 11.0, tg: 3.0, tax: 25,
        capex: 3, da: 5, wc: 5, exit: 18, prem: 28,
      },
      'DEAL-006': { // DataPulse — Emerging SaaS, 42% growth, 22% margin
        observedGrowth: 42, observedMargin: 22,
        g1: 36, g2: 31, g3: 25, g4: 20, g5: 17,
        m1: 24, m5: 32, wacc: 11.0, tg: 3.0, tax: 25,
        capex: 4, da: 7, wc: 9, exit: 20, prem: 25,
      },
    };

    const assStmt = db.prepare(
      `INSERT INTO valuation_assumptions (deal_id, assumption_name, base_case, upside_case, downside_case, unit, source_rationale, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sample')`
    );

    for (const [dealId, profile] of Object.entries(dealProfiles)) {
      for (const row of assumptionsFor(profile)) {
        assStmt.run(dealId, ...row);
      }
    }

    // ================================================================
    // 6. SCENARIO DEFINITIONS (per deal)
    // ================================================================
    const scenDefStmt = db.prepare(
      `INSERT INTO scenario_definitions (deal_id, scenario_name, description, delta_assumptions_json) VALUES (?, ?, ?, ?)`
    );
    for (const dealId of Object.keys(dealProfiles)) {
      scenDefStmt.run(dealId, 'base',     'Base case — moderate growth, moderate expansion', JSON.stringify({}));
      scenDefStmt.run(dealId, 'upside',   'Upside — accelerated growth, margin expansion',    JSON.stringify({ revenue_growth: '+5-7%', margin: '+3-5%', wacc: '-1.5%' }));
      scenDefStmt.run(dealId, 'downside', 'Downside — slower growth, margin compression',     JSON.stringify({ revenue_growth: '-8-10%', margin: '-3-5%', wacc: '+2%' }));
    }

    // ================================================================
    // 7. RUN MATH ENGINE FOR EVERY DEAL, EVERY SCENARIO
    // ================================================================

    // Helper — pull sector-matched comps / transactions
    function sectorSlice(sector) {
      const sectorComps = comps
        .filter(c => c[2] === sector)
        .map(c => ({ company_name: c[0], ev_ebitda: c[3], ev_revenue: c[4], pe_ratio: c[5], revenue_growth_pct: c[6], ebitda_margin_pct: c[7] }));
      const sectorTxns = transactions
        .filter(t => t[5] === sector)
        .map(t => ({ transaction_name: t[0], ev_ebitda: t[7], ev_revenue: t[8], premium_pct: t[9] }));
      return { sectorComps, sectorTxns };
    }

    const modelRunStmt = db.prepare(
      `INSERT INTO model_runs (deal_id, scenario, template_name, template_version, inputs_json, outputs_json, validation_json, approval_state, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const outStmt = db.prepare(
      `INSERT INTO model_outputs (deal_id, scenario, metric_name, metric_value, unit, calculation_method, confidence_score, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'calculated')`
    );

    for (const [dealId, profile] of Object.entries(dealProfiles)) {
      const deal = deals.find(d => d[0] === dealId);
      const dealSector = deal[3];
      const dealSize   = deal[5];

      // Latest financials for this deal
      const latestFin = financials.filter(f => f[0] === dealId).sort((a, b) => b[2].localeCompare(a[2]))[0];
      const target = { revenue: latestFin[3], ebitda: latestFin[7], ebitda_margin_pct: latestFin[8], netIncome: latestFin[9] };
      const totalDebt = latestFin[11] || 0;

      const { sectorComps, sectorTxns } = sectorSlice(dealSector);

      const scenarios = {
        base: {
          revenueGrowth: [profile.g1, profile.g2, profile.g3, profile.g4, profile.g5].map(v => v / 100),
          ebitdaMargins: interpolateMargins(profile.m1, profile.m5),
          wacc: profile.wacc / 100,
          terminalGrowthRate: profile.tg / 100,
          taxRate: profile.tax / 100,
          capexPct: profile.capex / 100,
          daPct: profile.da / 100,
          wcPct: profile.wc / 100,
          totalDebt, cash: 0,
        },
        upside: {
          revenueGrowth: [profile.g1 + 7, profile.g2 + 6, profile.g3 + 5, profile.g4 + 4, profile.g5 + 3].map(v => v / 100),
          ebitdaMargins: interpolateMargins(profile.m1 + 3, profile.m5 + 5),
          wacc: (profile.wacc - 1.5) / 100,
          terminalGrowthRate: (profile.tg + 0.5) / 100,
          taxRate: profile.tax / 100,
          capexPct: (profile.capex - 1) / 100,
          daPct: profile.da / 100,
          wcPct: (profile.wc - 2) / 100,
          totalDebt, cash: 0,
        },
        downside: {
          revenueGrowth: [profile.g1 - 10, profile.g2 - 8, profile.g3 - 7, profile.g4 - 5, profile.g5 - 4].map(v => Math.max(0.01, v / 100)),
          ebitdaMargins: interpolateMargins(Math.max(5, profile.m1 - 3), Math.max(8, profile.m5 - 5)),
          wacc: (profile.wacc + 2) / 100,
          terminalGrowthRate: (profile.tg - 0.5) / 100,
          taxRate: profile.tax / 100,
          capexPct: (profile.capex + 1) / 100,
          daPct: profile.da / 100,
          wcPct: (profile.wc + 2) / 100,
          totalDebt, cash: 0,
        },
      };

      const controlPrem = profile.prem / 100;

      for (const [scenarioName, config] of Object.entries(scenarios)) {
        let dcfResult, compsResult = null, precResult = null;
        try { dcfResult = calcDCF(target, config); } catch (e) { continue; }
        try { if (sectorComps.length) compsResult = calcTradingComps(target, sectorComps); } catch {}
        try { if (sectorTxns.length)  precResult  = calcPrecedentTransactions(target, sectorTxns, controlPrem); } catch {}

        const football = calcFootballField(dcfResult, compsResult, precResult);

        // Entry = the price we'd pay today (deal_size_estimate).
        // Exit  = year-5 projected EBITDA × scenario exit multiple.
        //         This is the PE-standard way of computing IRR — it captures the
        //         value created through operational improvement + multiple expansion,
        //         rather than treating the current blended EV as the exit price.
        const entry = dealSize || dcfResult.enterpriseValue * 0.9;
        const yr5   = dcfResult.projections?.[dcfResult.projections.length - 1];
        const exitMultipleMap = { base: profile.exit, upside: profile.exit + 6, downside: profile.exit - 4 };
        const exitMult = Math.max(5, exitMultipleMap[scenarioName] ?? profile.exit);
        const exitVal = yr5?.ebitda
          ? yr5.ebitda * exitMult
          : (football.blendedValue?.weighted || dcfResult.enterpriseValue);
        const cashFlows = [-entry, 0, 0, 0, 0, exitVal];
        let irr = null, moic = null;
        try { irr = calcIRR(cashFlows); } catch {}
        try { moic = calcMOIC(exitVal, entry); } catch {}

        // Sensitivity grid: WACC (rows) × Terminal Growth Rate (columns) → enterprise value
        const waccCenter = config.wacc;
        const tgCenter   = config.terminalGrowthRate;
        const waccValues = [-0.02, -0.01, 0, 0.01, 0.02].map(d => +(waccCenter + d).toFixed(4));
        const tgValues   = [-0.01, -0.005, 0, 0.005, 0.01].map(d => +(tgCenter + d).toFixed(4));
        let sensitivityNorm = null;
        try {
          const grid = sensitivityGrid(
            config, 'wacc', waccValues, 'terminalGrowthRate', tgValues,
            (a) => calcDCF(target, a).enterpriseValue
          );
          sensitivityNorm = normalizeSensitivity(grid);
        } catch {}

        const outputsJson = {
          dcf: dcfResult,
          tradingComps: compsResult,
          precedent: precResult,
          precedentTransactions: precResult,
          footballField: football,
          irr: irr != null ? irr : null,
          moic,
          sensitivity: sensitivityNorm,
          summary: {
            enterpriseValue: dcfResult.enterpriseValue,
            blendedEV: football.blendedValue,
            impliedMultiples: dcfResult.impliedMultiples,
          },
        };

        const inputsJson = {
          target, assumptions: config,
          comps: sectorComps.map(c => c.company_name),
          transactions: sectorTxns.map(t => t.transaction_name),
          controlPremium: controlPrem,
          sector: dealSector,
          entryPrice: entry,
        };

        const validation = {
          dcfConverged: dcfResult.enterpriseValue > 0,
          terminalValuePct: dcfResult.terminalValuePct,
          compsCount: sectorComps.length,
          transactionsCount: sectorTxns.length,
          waccGreaterThanTerminalGrowth: config.wacc > config.terminalGrowthRate,
        };

        // DEAL-004 closed and DEAL-001 base run approved; rest pending
        let approvalState = 'pending';
        if (dealId === 'DEAL-001' && scenarioName === 'base') approvalState = 'approved';
        if (dealId === 'DEAL-004') approvalState = 'approved';

        modelRunStmt.run(
          dealId, scenarioName, 'full_valuation', '1.0',
          JSON.stringify(inputsJson),
          JSON.stringify(outputsJson),
          JSON.stringify(validation),
          approvalState, 'agent'
        );

        // Per-metric outputs
        const metrics = [
          ['DCF Enterprise Value',                    dcfResult.enterpriseValue,                                   '$M', 'dcf',                   0.82],
          ['Trading Comps Implied EV',                compsResult?.impliedValues?.evEbitda?.mid ?? compsResult?.impliedValues?.blended, '$M', 'trading_comps', 0.85],
          ['Precedent Transactions Implied EV',      precResult?.impliedValues?.evEbitda?.mid ?? precResult?.impliedValues?.blended,   '$M', 'precedent_transactions', 0.78],
          ['Blended Valuation',                       football.blendedValue?.weighted,                              '$M', 'football_field',        0.82],
          ['Implied IRR',                             irr != null ? +(irr * 100).toFixed(1) : null,                 '%',  'irr_calculation',       0.75],
          ['MOIC',                                    moic != null ? +moic.toFixed(2) : null,                       'x',  'moic_calculation',      0.80],
        ];
        for (const [name, val, unit, method, conf] of metrics) {
          if (val != null && isFinite(val)) {
            outStmt.run(dealId, scenarioName, name, +Number(val).toFixed(2), unit, method, conf);
          }
        }
      }
    }

    // ================================================================
    // 8. DOCUMENTS (per deal)
    // ================================================================
    const docStmt = db.prepare(
      `INSERT INTO deal_documents (deal_id, filename, document_type, extraction_status, page_count, classification_confidence, classification_reasoning)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    docStmt.run('DEAL-001', 'CloudMetrics_FY2023_Audited_Financials.pdf', 'audited_financial_statement', 'completed', 42, 0.95, 'Balance sheet, income statement, and cash flow for FY2023');
    docStmt.run('DEAL-001', 'CloudMetrics_CIM_Q4_2023.pdf',               'cim',                         'completed', 68, 0.92, 'Confidential Information Memorandum');
    docStmt.run('DEAL-001', 'CloudMetrics_Management_Presentation.pdf',   'management_presentation',     'completed', 24, 0.88, null);
    docStmt.run('DEAL-001', 'CloudMetrics_Customer_List_2023.xlsx',       'customer_list',               'skipped',    3, 0.91, 'Not a financial statement');

    docStmt.run('DEAL-002', 'MediFlow_Annual_Report_2023.pdf',            'audited_financial_statement', 'completed', 56, 0.93, null);
    docStmt.run('DEAL-002', 'MediFlow_Teaser.pdf',                        'cim',                         'completed', 12, 0.85, null);

    docStmt.run('DEAL-003', 'PayStream_Audited_Financials_2023.pdf',      'audited_financial_statement', 'completed', 62, 0.94, null);
    docStmt.run('DEAL-003', 'PayStream_CIM.pdf',                          'cim',                         'completed', 84, 0.90, null);

    docStmt.run('DEAL-004', 'SensorWorks_Final_SPA.pdf',                  'legal_document',              'completed', 120, 0.96, 'Share purchase agreement — closed');
    docStmt.run('DEAL-004', 'SensorWorks_Diligence_Summary.pdf',          'dd_report',                   'completed', 38, 0.92, null);

    docStmt.run('DEAL-005', 'ShieldAI_CIM.pdf',                           'cim',                         'completed', 45, 0.89, null);
    docStmt.run('DEAL-005', 'ShieldAI_Customer_Concentration_Analysis.xlsx','customer_list',             'completed',  5, 0.87, 'Top-3 = 68% concentration — passed');

    docStmt.run('DEAL-006', 'DataPulse_Teaser.pdf',                       'cim',                         'completed', 14, 0.86, null);
    docStmt.run('DEAL-006', 'DataPulse_FY2023_Financials.xlsx',           'audited_financial_statement', 'completed',  8, 0.93, null);

    // ================================================================
    // 9. EXTRACTION JOBS
    // ================================================================
    const extractStmt = db.prepare(
      `INSERT INTO extraction_jobs (deal_id, status, stage, progress_pct, started_at, completed_at, document_ids, pipeline_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    extractStmt.run('DEAL-001', 'completed', 'complete', 100, '2024-01-16T09:00:00Z', '2024-01-16T09:12:34Z',
      JSON.stringify([1, 2, 3, 4]),
      JSON.stringify({ parsed: 4, classified: 4, extracted: 3, reconciled: true, sector_classified: true, quality_passed: true, loaded: true }));
    extractStmt.run('DEAL-002', 'completed', 'complete', 100, '2024-02-21T10:00:00Z', '2024-02-21T10:08:15Z',
      JSON.stringify([5, 6]),
      JSON.stringify({ parsed: 2, classified: 2, extracted: 2, reconciled: true, sector_classified: true, quality_passed: true, loaded: true }));
    extractStmt.run('DEAL-003', 'completed', 'complete', 100, '2023-11-07T09:30:00Z', '2023-11-07T09:42:20Z',
      JSON.stringify([7, 8]),
      JSON.stringify({ parsed: 2, classified: 2, extracted: 2, reconciled: true, sector_classified: true, quality_passed: true, loaded: true }));
    extractStmt.run('DEAL-006', 'completed', 'complete', 100, '2024-03-02T14:00:00Z', '2024-03-02T14:09:40Z',
      JSON.stringify([13, 14]),
      JSON.stringify({ parsed: 2, classified: 2, extracted: 2, reconciled: true, sector_classified: true, quality_passed: true, loaded: true }));

    // ================================================================
    // 10. HITL REVIEWS
    // ================================================================
    const hitlStmt = db.prepare(
      `INSERT INTO hitl_reviews (entity_type, entity_id, tier, reviewer, decision, notes, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    hitlStmt.run('model_run', '1', 2, 'Sarah Chen', 'approved',
      'Base case assumptions look reasonable. WACC of 11% appropriate for mid-cap SaaS. Terminal growth slightly aggressive at 3% but defensible.',
      '2024-01-20T14:30:00Z');
    hitlStmt.run('extraction_job', '1', 2, 'Sarah Chen', 'approved',
      'Financials extracted correctly from audited statements. Minor rounding differences with CIM reconciled.',
      '2024-01-17T11:15:00Z');
    hitlStmt.run('model_run', '2', 2, 'James Porter', 'changes_requested',
      'Upside revenue growth of 42% Y1 seems aggressive given market headwinds. Suggest capping at 38%. Margin assumptions are fine.',
      '2024-01-21T09:45:00Z');
    hitlStmt.run('extraction_job', '2', 2, 'James Porter', 'approved',
      'MediFlow financials verified against annual report. All figures match.',
      '2024-02-22T16:00:00Z');
    hitlStmt.run('model_run', '10', 2, 'David Kim', 'approved',
      'Condor close model approved — integration planning based on base case.',
      '2024-01-15T17:00:00Z');

    // ================================================================
    // 11. CHAT — demo conversations
    // ================================================================
    db.run(
      `INSERT INTO chat_conversations (title, created_at, updated_at) VALUES (?, ?, ?)`,
      'Project Falcon Analysis', '2024-01-22T10:00:00Z', '2024-01-22T10:15:00Z'
    );
    const msgStmt = db.prepare(
      `INSERT INTO chat_messages (conversation_id, role, content, confidence, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    msgStmt.run(1, 'user', "What's the base case enterprise value for Project Falcon?", null, '2024-01-22T10:00:00Z');
    msgStmt.run(1, 'assistant',
      'Based on the blended valuation for Project Falcon (CloudMetrics Inc.), the base case enterprise value is approximately $510M. This blends three methodologies: DCF (~$485M, weighted 40%), Trading Comps (~$520M, weighted 30%), and Precedent Transactions (~$545M, weighted 30%).',
      0.85, '2024-01-22T10:00:30Z');
    msgStmt.run(1, 'user', 'How does the DCF compare to trading comps?', null, '2024-01-22T10:05:00Z');
    msgStmt.run(1, 'assistant',
      'The DCF enterprise value of ~$485M is about 7% below the trading comps implied value of ~$520M (based on median EV/EBITDA of the Enterprise SaaS peer set). This discount is typical for a DCF with conservative margin assumptions.',
      0.82, '2024-01-22T10:05:45Z');

    db.run(
      `INSERT INTO chat_conversations (title, created_at, updated_at) VALUES (?, ?, ?)`,
      'Deal Pipeline Overview', '2024-02-01T09:00:00Z', '2024-02-01T09:10:00Z'
    );
    msgStmt.run(2, 'user', 'Give me a quick summary of our active pipeline.', null, '2024-02-01T09:00:00Z');
    msgStmt.run(2, 'assistant',
      '4 active deals in pipeline: Project Falcon (CloudMetrics, Due Diligence, $450M), Project Eagle (MediFlow, Screening, $280M), Project Hawk (PayStream, Negotiation, $620M), Project Raven (DataPulse, Screening, $520M). Project Condor closed at 8.2x EBITDA; Project Sparrow passed on customer concentration risk.',
      0.90, '2024-02-01T09:01:00Z');

    // ================================================================
    // 12. AUDIT LOG
    // ================================================================
    for (const d of deals) {
      auditLog(db, 'deal.created', 'deal_pipeline', d[0], d[6],
        { deal_name: d[1], sector: d[3], target_company: d[4] });
    }
    auditLog(db, 'extraction.completed', 'extraction_jobs', '1', 'agent', { deal_id: 'DEAL-001', financials_loaded: 3, duration_sec: 754 });
    auditLog(db, 'extraction.completed', 'extraction_jobs', '2', 'agent', { deal_id: 'DEAL-002', financials_loaded: 3, duration_sec: 495 });
    auditLog(db, 'extraction.completed', 'extraction_jobs', '3', 'agent', { deal_id: 'DEAL-003', financials_loaded: 3, duration_sec: 742 });
    auditLog(db, 'extraction.completed', 'extraction_jobs', '4', 'agent', { deal_id: 'DEAL-006', financials_loaded: 3, duration_sec: 580 });
    auditLog(db, 'model.built', 'model_runs', '1', 'agent', { deal_id: 'DEAL-001', scenarios: 3 });
    auditLog(db, 'model.built', 'model_runs', '4', 'agent', { deal_id: 'DEAL-002', scenarios: 3 });
    auditLog(db, 'model.built', 'model_runs', '7', 'agent', { deal_id: 'DEAL-003', scenarios: 3 });
    auditLog(db, 'model.built', 'model_runs', '10', 'agent', { deal_id: 'DEAL-004', scenarios: 3 });
    auditLog(db, 'model.built', 'model_runs', '13', 'agent', { deal_id: 'DEAL-005', scenarios: 3 });
    auditLog(db, 'model.built', 'model_runs', '16', 'agent', { deal_id: 'DEAL-006', scenarios: 3 });
    auditLog(db, 'hitl.approved', 'model_runs', '1', 'Sarah Chen', { scenario: 'base' });
    auditLog(db, 'deal.closed', 'deal_pipeline', 'DEAL-004', 'David Kim', { deal_value: 185, multiple: '8.2x EBITDA' });
    auditLog(db, 'deal.passed', 'deal_pipeline', 'DEAL-005', 'James Porter', { reason: 'Top-3 customer concentration 68%' });
    auditLog(db, 'system.seed', 'system', 'seed', 'system', { rows_seeded: 'all tables', version: '3.0' });
  });

  console.log('Database seeded successfully.');
}

// ------------------------------------------------------------------
// Helper
// ------------------------------------------------------------------
function interpolateMargins(start, end) {
  const arr = [];
  for (let y = 0; y < 5; y++) {
    arr.push((start + (end - start) * (y / 4)) / 100);
  }
  return arr;
}
