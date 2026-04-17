import { callLLM } from '../llm.js';
import {
  calcDCF,
  calcTradingComps,
  calcPrecedentTransactions,
  calcFootballField,
  calcIRR,
  calcMOIC,
  sensitivityGrid,
} from '../../models/math.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEMPLATE_VERSION = '1.0';
const AGENT_VERSION = 'builder-v1';
const PROJECTION_YEARS = 5;

// ---------------------------------------------------------------------------
// System prompt for the assumptions agent
// ---------------------------------------------------------------------------

const ASSUMPTIONS_SYSTEM_PROMPT = `You are a senior financial analyst at a top-tier investment bank. Your job is to set valuation model assumptions for an M&A target company.

You will receive:
1. Target company historical financials (revenue, EBITDA, margins, growth rates)
2. Comparable public company data (multiples, growth, margins)
3. Precedent transaction data (deal multiples, premiums)
4. Any existing assumptions from prior model runs or user edits

Your task: produce a complete set of assumptions for a 5-year DCF model plus three scenarios (base, upside, downside).

RULES:
- Revenue growth rates should reflect historical trends, sector growth, and company positioning.
- EBITDA margins should be grounded in historical margins with a clear expansion/contraction thesis.
- WACC should be appropriate for the sector and company risk profile (typically 8-15%).
- Terminal growth rate should not exceed long-run GDP growth (1.5-3.5% for most).
- Tax rate should reflect the company's jurisdiction and effective rate.
- CapEx, D&A, and working capital percentages should be consistent with historical levels and sector norms.
- Every assumption must include a brief rationale explaining your reasoning.
- Upside scenario: more aggressive growth, margin expansion, lower WACC.
- Downside scenario: conservative growth, margin pressure, higher WACC.
- If existing assumptions are provided and were user-edited, preserve them unless they are clearly unreasonable.

Respond with ONLY a JSON object in this exact structure:
{
  "base": {
    "revenueGrowth": [0.10, 0.09, 0.08, 0.07, 0.06],
    "ebitdaMargins": [0.25, 0.26, 0.27, 0.27, 0.28],
    "wacc": 0.10,
    "terminalGrowthRate": 0.025,
    "taxRate": 0.25,
    "capexPct": 0.05,
    "daPct": 0.04,
    "wcPct": 0.10,
    "rationale": {
      "revenueGrowth": "...",
      "ebitdaMargins": "...",
      "wacc": "...",
      "terminalGrowthRate": "...",
      "taxRate": "...",
      "capexPct": "...",
      "daPct": "...",
      "wcPct": "..."
    }
  },
  "upside": {
    "revenueGrowth": [...],
    "ebitdaMargins": [...],
    "wacc": ...,
    "terminalGrowthRate": ...,
    "taxRate": ...,
    "capexPct": ...,
    "daPct": ...,
    "wcPct": ...,
    "rationale": { ... }
  },
  "downside": {
    "revenueGrowth": [...],
    "ebitdaMargins": [...],
    "wacc": ...,
    "terminalGrowthRate": ...,
    "taxRate": ...,
    "capexPct": ...,
    "daPct": ...,
    "wcPct": ...,
    "rationale": { ... }
  }
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tag each cell in the model output with its data provenance.
 * @param {Object} scenarioAssumptions - The assumptions for this scenario
 * @param {Object} dcfResult - DCF calculation output
 * @param {Object} financials - Input financials
 * @returns {Object} Map of cell path -> { tag, source }
 */
function buildCellTags(scenarioAssumptions, dcfResult, financials) {
  const tags = {};

  // Tag financial inputs as 'data' (from DB)
  for (const key of ['revenue', 'ebitda', 'ebitda_margin_pct', 'total_debt', 'free_cash_flow']) {
    if (financials[key] != null) {
      tags[`financials.${key}`] = { tag: 'data', source: 'company_financials' };
    }
  }

  // Tag assumptions as 'assumption' (agent judgment)
  for (const key of ['revenueGrowth', 'ebitdaMargins', 'wacc', 'terminalGrowthRate', 'taxRate', 'capexPct', 'daPct', 'wcPct']) {
    tags[`assumptions.${key}`] = {
      tag: scenarioAssumptions._userEdited?.[key] ? 'user_override' : 'assumption',
      source: scenarioAssumptions._userEdited?.[key] ? 'analyst' : 'agent',
    };
  }

  // Tag all DCF projection rows as 'derived' (calculated)
  if (dcfResult?.projections) {
    for (let i = 0; i < dcfResult.projections.length; i++) {
      for (const field of ['revenue', 'ebitda', 'ebit', 'nopat', 'fcf', 'pvFcf']) {
        tags[`dcf.projections[${i}].${field}`] = { tag: 'derived', source: 'math_engine' };
      }
    }
  }

  // Tag terminal and enterprise values as derived
  for (const field of ['terminalValue', 'pvTerminal', 'sumPvFcf', 'enterpriseValue', 'equityValue']) {
    tags[`dcf.${field}`] = { tag: 'derived', source: 'math_engine' };
  }

  return tags;
}

/**
 * Merge existing user-edited assumptions into agent-generated ones.
 * User edits take precedence.
 * @param {Object} agentAssumptions - Assumptions generated by the LLM
 * @param {Object} existingAssumptions - Assumptions from DB (may include user edits)
 * @returns {Object} Merged assumptions with _userEdited tracking
 */
function mergeAssumptions(agentAssumptions, existingAssumptions) {
  if (!existingAssumptions || Object.keys(existingAssumptions).length === 0) {
    return agentAssumptions;
  }

  const merged = { ...agentAssumptions };
  const userEdited = {};

  // Map DB assumption names to model fields
  const nameMap = {
    revenue_growth_y1: { field: 'revenueGrowth', index: 0 },
    revenue_growth_y2: { field: 'revenueGrowth', index: 1 },
    revenue_growth_y3: { field: 'revenueGrowth', index: 2 },
    revenue_growth_y4: { field: 'revenueGrowth', index: 3 },
    revenue_growth_y5: { field: 'revenueGrowth', index: 4 },
    ebitda_margin_y1: { field: 'ebitdaMargins', index: 0 },
    ebitda_margin_y2: { field: 'ebitdaMargins', index: 1 },
    ebitda_margin_y3: { field: 'ebitdaMargins', index: 2 },
    ebitda_margin_y4: { field: 'ebitdaMargins', index: 3 },
    ebitda_margin_y5: { field: 'ebitdaMargins', index: 4 },
    wacc: { field: 'wacc' },
    terminal_growth_rate: { field: 'terminalGrowthRate' },
    tax_rate: { field: 'taxRate' },
    capex_pct: { field: 'capexPct' },
    da_pct: { field: 'daPct' },
    wc_pct: { field: 'wcPct' },
  };

  for (const [dbName, mapping] of Object.entries(nameMap)) {
    const existing = existingAssumptions[dbName];
    if (existing == null) continue;

    // Only override if the user explicitly edited (data_source = 'manual')
    if (existing.data_source !== 'manual') continue;

    if (mapping.index != null) {
      // Array field (revenueGrowth, ebitdaMargins)
      if (!merged[mapping.field]) continue;
      const value = existing.value / 100; // DB stores as percentage
      merged[mapping.field] = [...merged[mapping.field]];
      merged[mapping.field][mapping.index] = value;
    } else {
      // Scalar field
      const value = mapping.field === 'wacc' || mapping.field === 'terminalGrowthRate' ||
                    mapping.field === 'taxRate' || mapping.field === 'capexPct' ||
                    mapping.field === 'daPct' || mapping.field === 'wcPct'
        ? existing.value / 100
        : existing.value;
      merged[mapping.field] = value;
    }
    userEdited[mapping.field] = true;
  }

  merged._userEdited = userEdited;
  return merged;
}

/**
 * Build a single scenario: run DCF, comps, precedents, football field, IRR, MOIC.
 * @param {Object} financials - Target financials (latest year)
 * @param {Object} assumptions - Merged assumptions for this scenario
 * @param {Array} comps - Comparable companies
 * @param {Array} transactions - Precedent transactions
 * @returns {Object} Complete scenario output
 */
function buildScenario(financials, assumptions, comps, transactions) {
  // Prepare financials for math engine
  const latestFinancials = {
    revenue: financials.revenue,
    ebitda: financials.ebitda,
    ebitda_margin_pct: financials.ebitda_margin_pct,
    netIncome: financials.net_income,
  };

  // Prepare assumptions with debt/cash for equity bridge
  const dcfAssumptions = {
    revenueGrowth: assumptions.revenueGrowth,
    ebitdaMargins: assumptions.ebitdaMargins,
    wacc: assumptions.wacc,
    terminalGrowthRate: assumptions.terminalGrowthRate,
    taxRate: assumptions.taxRate,
    capexPct: assumptions.capexPct,
    daPct: assumptions.daPct,
    wcPct: assumptions.wcPct,
    totalDebt: financials.total_debt || 0,
    cash: financials.cash || 0,
  };

  // 1. DCF
  const dcf = calcDCF(latestFinancials, dcfAssumptions);

  // 2. Trading Comps
  const tradingComps = calcTradingComps(
    { revenue: latestFinancials.revenue, ebitda: latestFinancials.ebitda, netIncome: latestFinancials.netIncome },
    comps,
  );

  // 3. Precedent Transactions (apply median premium from transactions if available)
  const controlPremium = 0; // let the transaction multiples speak for themselves
  const precedentTransactions = calcPrecedentTransactions(
    { revenue: latestFinancials.revenue, ebitda: latestFinancials.ebitda },
    transactions,
    controlPremium,
  );

  // 4. Football Field
  const footballField = calcFootballField(dcf, tradingComps, precedentTransactions);

  // 5. IRR: assume entry at blended mid value, exit at DCF EV in year 5
  const entryValue = footballField.blendedValue?.mid || dcf.equityValue;
  const exitValue = dcf.equityValue;
  const projectedFCFs = dcf.projections.map((p) => p.fcf);
  const irrCashFlows = [-entryValue, ...projectedFCFs.slice(0, -1), projectedFCFs[projectedFCFs.length - 1] + exitValue];
  const irr = calcIRR(irrCashFlows);

  // 6. MOIC
  const totalDistributions = projectedFCFs.reduce((s, v) => s + v, 0) + exitValue;
  const moic = calcMOIC(totalDistributions, entryValue);

  // 7. Additional sensitivity: WACC vs Exit Multiple
  const baseExitMultiple = dcf.impliedMultiples?.evEbitda || 10;
  const exitMultipleSensitivity = sensitivityGrid(
    { ...dcfAssumptions, exitMultiple: baseExitMultiple },
    'wacc',
    [assumptions.wacc - 0.02, assumptions.wacc - 0.01, assumptions.wacc, assumptions.wacc + 0.01, assumptions.wacc + 0.02],
    'exitMultiple',
    [baseExitMultiple - 2, baseExitMultiple - 1, baseExitMultiple, baseExitMultiple + 1, baseExitMultiple + 2],
    (modified) => {
      // Recalculate EV using exit multiple approach instead of Gordon Growth
      const lastEbitda = dcf.projections[dcf.projections.length - 1].ebitda;
      const terminalEV = lastEbitda * modified.exitMultiple;
      const pvTerminal = terminalEV / Math.pow(1 + modified.wacc, PROJECTION_YEARS);
      return dcf.sumPvFcf + pvTerminal - (financials.total_debt || 0) + (financials.cash || 0);
    },
  );

  // 8. Cell tags
  const cellTags = buildCellTags(assumptions, dcf, financials);

  return {
    assumptions: {
      revenueGrowth: assumptions.revenueGrowth,
      ebitdaMargins: assumptions.ebitdaMargins,
      wacc: assumptions.wacc,
      terminalGrowthRate: assumptions.terminalGrowthRate,
      taxRate: assumptions.taxRate,
      capexPct: assumptions.capexPct,
      daPct: assumptions.daPct,
      wcPct: assumptions.wcPct,
      rationale: assumptions.rationale || {},
    },
    dcf,
    tradingComps,
    precedentTransactions,
    footballField,
    irr,
    moic,
    sensitivity: {
      waccVsTerminalGrowth: dcf.sensitivityGrid,
      waccVsExitMultiple: exitMultipleSensitivity,
    },
    cellTags,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build a complete valuation model for a deal.
 *
 * Step 1: Call Claude Sonnet to determine assumptions for all 3 scenarios.
 * Step 2: Run the deterministic JS math engine for each scenario.
 * Step 3: Tag every cell with its provenance (data / derived / assumption).
 * Step 4: Return all scenarios with metadata.
 *
 * @param {Object} params
 * @param {Object} params.financials - Target company financial data. Must include
 *   at minimum { revenue, ebitda }. May also have ebitda_margin_pct, net_income,
 *   total_debt, cash, free_cash_flow, revenue_growth_pct, and a history array.
 * @param {Array} params.comps - Selected comparable companies from comparable_companies table.
 * @param {Array} params.transactions - Selected precedent transactions from comparable_transactions table.
 * @param {Object} [params.existingAssumptions={}] - Assumptions already in DB from
 *   prior runs or user edits. Keyed by assumption_name, each with { value, data_source }.
 * @returns {Object} ModelDraft with scenarios and metadata.
 */
export async function buildModel({ financials, comps = [], transactions = [], existingAssumptions = {} }) {
  if (!financials || financials.revenue == null || financials.ebitda == null) {
    throw new Error('buildModel requires financials with at least revenue and ebitda');
  }

  const startTime = Date.now();

  // -----------------------------------------------------------------------
  // Step 1: Ask Claude Sonnet to produce assumptions for all 3 scenarios
  // -----------------------------------------------------------------------
  const userPrompt = buildAssumptionsPrompt(financials, comps, transactions, existingAssumptions);

  let llmResult;
  try {
    llmResult = await callLLM({
      tier: 'heavy',
      temperature: 0.2,
      maxTokens: 4096,
      system: ASSUMPTIONS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    throw new Error(`Failed to generate model assumptions: ${err.message}`);
  }

  // Parse the JSON response
  let scenarioAssumptions;
  try {
    // Strip markdown fences if present
    let raw = llmResult.content.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    }
    scenarioAssumptions = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse assumptions JSON from LLM: ${err.message}. Raw output: ${llmResult.content.slice(0, 500)}`);
  }

  // Validate that we have all three scenarios
  for (const scenario of ['base', 'upside', 'downside']) {
    if (!scenarioAssumptions[scenario]) {
      throw new Error(`LLM response missing "${scenario}" scenario assumptions`);
    }
    const s = scenarioAssumptions[scenario];
    if (!Array.isArray(s.revenueGrowth) || s.revenueGrowth.length !== PROJECTION_YEARS) {
      throw new Error(`${scenario} scenario: revenueGrowth must be an array of ${PROJECTION_YEARS} values`);
    }
    if (!Array.isArray(s.ebitdaMargins) || s.ebitdaMargins.length !== PROJECTION_YEARS) {
      throw new Error(`${scenario} scenario: ebitdaMargins must be an array of ${PROJECTION_YEARS} values`);
    }
    for (const field of ['wacc', 'terminalGrowthRate', 'taxRate', 'capexPct', 'daPct', 'wcPct']) {
      if (typeof s[field] !== 'number') {
        throw new Error(`${scenario} scenario: ${field} must be a number, got ${typeof s[field]}`);
      }
    }
    // Sanity: WACC must be greater than terminal growth rate for Gordon Growth
    if (s.wacc <= s.terminalGrowthRate) {
      throw new Error(`${scenario} scenario: WACC (${s.wacc}) must be greater than terminal growth rate (${s.terminalGrowthRate})`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 2-3: Run math engine for each scenario
  // -----------------------------------------------------------------------
  const scenarios = {};

  for (const scenarioName of ['base', 'upside', 'downside']) {
    const rawAssumptions = scenarioAssumptions[scenarioName];

    // Merge with existing user-edited assumptions (only for base case;
    // upside/downside get their own overrides from the LLM)
    const merged = scenarioName === 'base'
      ? mergeAssumptions(rawAssumptions, existingAssumptions)
      : rawAssumptions;

    try {
      scenarios[scenarioName] = buildScenario(financials, merged, comps, transactions);
    } catch (err) {
      throw new Error(`Failed to build ${scenarioName} scenario: ${err.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Return the complete model draft
  // -----------------------------------------------------------------------
  return {
    scenarios,
    metadata: {
      templateVersion: TEMPLATE_VERSION,
      agentVersion: AGENT_VERSION,
      timestamp: new Date().toISOString(),
      buildTimeMs: Date.now() - startTime,
      llmUsage: llmResult.usage,
      llmLatencyMs: llmResult.latencyMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the user prompt that provides all context for assumption generation.
 */
function buildAssumptionsPrompt(financials, comps, transactions, existingAssumptions) {
  const sections = [];

  // Target company financials
  sections.push('## Target Company Financials (Latest Year)');
  sections.push(`- Revenue: $${financials.revenue}M`);
  sections.push(`- EBITDA: $${financials.ebitda}M`);
  if (financials.ebitda_margin_pct != null) {
    sections.push(`- EBITDA Margin: ${financials.ebitda_margin_pct}%`);
  }
  if (financials.revenue_growth_pct != null) {
    sections.push(`- Revenue Growth (YoY): ${financials.revenue_growth_pct}%`);
  }
  if (financials.net_income != null) {
    sections.push(`- Net Income: $${financials.net_income}M`);
  }
  if (financials.total_debt != null) {
    sections.push(`- Total Debt: $${financials.total_debt}M`);
  }
  if (financials.free_cash_flow != null) {
    sections.push(`- Free Cash Flow: $${financials.free_cash_flow}M`);
  }

  // Historical data if available
  if (financials.history && financials.history.length > 0) {
    sections.push('\n## Historical Financials');
    for (const h of financials.history) {
      sections.push(`- ${h.period}: Revenue $${h.revenue}M, EBITDA $${h.ebitda}M, Margin ${h.ebitda_margin_pct ?? 'N/A'}%, Growth ${h.revenue_growth_pct ?? 'N/A'}%`);
    }
  }

  // Comparable companies
  if (comps.length > 0) {
    sections.push('\n## Comparable Public Companies');
    for (const c of comps) {
      sections.push(`- ${c.company_name}: EV/EBITDA ${c.ev_ebitda}x, EV/Rev ${c.ev_revenue}x, Growth ${c.revenue_growth_pct ?? 'N/A'}%, Margin ${c.ebitda_margin_pct ?? 'N/A'}%`);
    }
  }

  // Precedent transactions
  if (transactions.length > 0) {
    sections.push('\n## Precedent Transactions');
    for (const t of transactions) {
      sections.push(`- ${t.transaction_name}: EV/EBITDA ${t.ev_ebitda}x, EV/Rev ${t.ev_revenue}x, Premium ${t.premium_pct ?? 'N/A'}%`);
    }
  }

  // Existing assumptions
  const existingKeys = Object.keys(existingAssumptions);
  if (existingKeys.length > 0) {
    sections.push('\n## Existing Assumptions (from prior runs or user edits)');
    sections.push('User-edited assumptions (data_source=manual) should be preserved unless clearly unreasonable.');
    for (const [key, val] of Object.entries(existingAssumptions)) {
      const edited = val.data_source === 'manual' ? ' [USER EDITED]' : '';
      sections.push(`- ${key}: ${val.value}${val.unit ? ` ${val.unit}` : ''}${edited}`);
    }
  }

  sections.push('\nPlease generate assumptions for all three scenarios (base, upside, downside) and return them as JSON.');

  return sections.join('\n');
}
