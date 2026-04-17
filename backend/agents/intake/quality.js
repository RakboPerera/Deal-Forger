// ---------------------------------------------------------------------------
// quality.js — Data Quality & Completeness (JS + Claude Haiku)
// ---------------------------------------------------------------------------
// Pure JS validation checks followed by a Claude Haiku plain-language summary.
// ---------------------------------------------------------------------------

import { callLLM } from '../llm.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum required fields for a usable extraction. */
const REQUIRED_FIELDS = ['revenue', 'ebitda', 'net_income'];

/** Fields that contribute to the completeness score. */
const DESIRED_FIELDS = [
  'revenue', 'cost_of_revenue', 'gross_profit', 'ebitda', 'ebit',
  'net_income', 'total_assets', 'total_liabilities', 'total_equity',
  'total_debt', 'cash', 'capex', 'free_cash_flow', 'depreciation',
  'interest_expense', 'tax_expense', 'employees',
];

/** Maximum acceptable YoY change before flagging (200%). */
const MAX_YOY_CHANGE = 2.0;

/** Typical margin ranges by sector (approximate). */
const SECTOR_MARGIN_RANGES = {
  Technology: { gross: [50, 90], ebitda: [10, 50] },
  Healthcare: { gross: [40, 85], ebitda: [10, 40] },
  Industrials: { gross: [20, 50], ebitda: [8, 25] },
  Consumer: { gross: [25, 65], ebitda: [5, 25] },
  'Financial Services': { gross: [30, 80], ebitda: [15, 50] },
  Energy: { gross: [15, 50], ebitda: [10, 40] },
  default: { gross: [10, 80], ebitda: [3, 50] },
};

// ---------------------------------------------------------------------------
// Pure JS Checks
// ---------------------------------------------------------------------------

/**
 * Check that all required fields are present in at least one period.
 */
function checkRequiredFields(resolvedValues) {
  const issues = [];
  const periods = Object.keys(resolvedValues);

  if (periods.length === 0) {
    issues.push({
      severity: 'error',
      field: '_all',
      message: 'No fiscal periods found in extracted data.',
    });
    return issues;
  }

  for (const field of REQUIRED_FIELDS) {
    const hasField = periods.some(
      (p) => resolvedValues[p]?.[field] !== undefined && resolvedValues[p]?.[field] !== null,
    );
    if (!hasField) {
      issues.push({
        severity: 'error',
        field,
        message: `Required field "${field}" is missing from all periods.`,
      });
    }
  }

  return issues;
}

/**
 * Check multi-year consistency: flag wild YoY swings > 200%.
 */
function checkYoyConsistency(resolvedValues) {
  const issues = [];
  const periods = Object.keys(resolvedValues).sort();

  if (periods.length < 2) return issues;

  for (let i = 1; i < periods.length; i++) {
    const prevPeriod = periods[i - 1];
    const currPeriod = periods[i];
    const prev = resolvedValues[prevPeriod];
    const curr = resolvedValues[currPeriod];

    for (const field of DESIRED_FIELDS) {
      const prevVal = prev?.[field];
      const currVal = curr?.[field];

      if (prevVal === undefined || currVal === undefined) continue;
      if (prevVal === 0) continue;

      const change = Math.abs((currVal - prevVal) / Math.abs(prevVal));

      if (change > MAX_YOY_CHANGE) {
        issues.push({
          severity: 'warning',
          field,
          message: `"${field}" changed by ${(change * 100).toFixed(0)}% from ${prevPeriod} to ${currPeriod} (${prevVal} -> ${currVal}). This may indicate an error.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Check margins are within sector-normal ranges.
 */
function checkMarginRanges(resolvedValues, classification) {
  const issues = [];
  const sector = classification?.primary_sector || 'default';
  const ranges = SECTOR_MARGIN_RANGES[sector] || SECTOR_MARGIN_RANGES.default;

  for (const [period, fields] of Object.entries(resolvedValues)) {
    // Gross margin check
    if (fields.revenue && fields.gross_profit && fields.revenue !== 0) {
      const grossMargin = (fields.gross_profit / fields.revenue) * 100;
      if (grossMargin < ranges.gross[0] || grossMargin > ranges.gross[1]) {
        issues.push({
          severity: 'warning',
          field: 'gross_profit',
          message: `Gross margin of ${grossMargin.toFixed(1)}% in ${period} is outside typical range for ${sector} (${ranges.gross[0]}-${ranges.gross[1]}%).`,
        });
      }
    }

    // EBITDA margin check
    if (fields.revenue && fields.ebitda && fields.revenue !== 0) {
      const ebitdaMargin = (fields.ebitda / fields.revenue) * 100;
      if (ebitdaMargin < ranges.ebitda[0] || ebitdaMargin > ranges.ebitda[1]) {
        issues.push({
          severity: 'warning',
          field: 'ebitda',
          message: `EBITDA margin of ${ebitdaMargin.toFixed(1)}% in ${period} is outside typical range for ${sector} (${ranges.ebitda[0]}-${ranges.ebitda[1]}%).`,
        });
      }
    }

    // Negative revenue check
    if (fields.revenue !== undefined && fields.revenue < 0) {
      issues.push({
        severity: 'error',
        field: 'revenue',
        message: `Negative revenue (${fields.revenue}) in ${period}. This is likely an extraction error.`,
      });
    }

    // EBITDA > Revenue check
    if (fields.revenue && fields.ebitda && fields.ebitda > fields.revenue) {
      issues.push({
        severity: 'warning',
        field: 'ebitda',
        message: `EBITDA (${fields.ebitda}) exceeds revenue (${fields.revenue}) in ${period}. Verify this is correct.`,
      });
    }
  }

  return issues;
}

/**
 * Check currency consistency across periods.
 */
function checkCurrencyConsistency(extractions) {
  const issues = [];
  const currencies = new Set();

  for (const ext of extractions || []) {
    if (ext.extraction?.currency) {
      currencies.add(ext.extraction.currency);
    }
  }

  if (currencies.size > 1) {
    issues.push({
      severity: 'error',
      field: 'currency',
      message: `Multiple currencies detected across documents: ${[...currencies].join(', ')}. All values should be in a single currency.`,
    });
  }

  return issues;
}

/**
 * Check company name consistency.
 */
function checkCompanyNameConsistency(extractions) {
  const issues = [];
  const names = new Set();

  for (const ext of extractions || []) {
    if (ext.extraction?.company_name) {
      names.add(ext.extraction.company_name.trim().toLowerCase());
    }
  }

  if (names.size > 1) {
    const nameList = [...names].map((n) => `"${n}"`).join(', ');
    issues.push({
      severity: 'warning',
      field: 'company_name',
      message: `Different company names found across documents: ${nameList}. Confirm these refer to the same entity.`,
    });
  }

  return issues;
}

/**
 * Calculate completeness score (0-100).
 */
function calculateScore(resolvedValues, issues) {
  const periods = Object.keys(resolvedValues);
  if (periods.length === 0) return 0;

  // Completeness: what fraction of desired fields are present
  let totalSlots = 0;
  let filledSlots = 0;

  for (const period of periods) {
    for (const field of DESIRED_FIELDS) {
      totalSlots++;
      if (resolvedValues[period]?.[field] !== undefined) filledSlots++;
    }
  }

  const completeness = totalSlots > 0 ? filledSlots / totalSlots : 0;

  // Penalty for errors and warnings
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const penalty = Math.min(50, errorCount * 15 + warningCount * 5);

  // Multi-period bonus (up to 10 points)
  const periodBonus = Math.min(10, (periods.length - 1) * 5);

  const raw = completeness * 80 + periodBonus - penalty;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Claude Haiku: Quality Summary
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT = `You are a data quality analyst reviewing financial extraction results for an M&A deal. Provide a concise 2-4 sentence plain-language summary of the data quality, highlighting the most important issues and overall usability for valuation purposes.

Respond with ONLY the summary text (no JSON, no markdown).`;

async function generateSummary(resolvedValues, issues, score, classification) {
  const periods = Object.keys(resolvedValues).sort();
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  const userMessage = `Quality score: ${score}/100
Periods extracted: ${periods.join(', ') || 'none'}
Errors: ${errorCount}, Warnings: ${warningCount}
Sector: ${classification?.primary_sector || 'Unknown'}

Issues:
${issues.map((i) => `[${i.severity}] ${i.field}: ${i.message}`).join('\n') || 'None'}

Fields present in most recent period: ${periods.length > 0 ? Object.keys(resolvedValues[periods[periods.length - 1]] || {}).join(', ') : 'none'}`;

  const result = await callLLM({
    tier: 'light',
    temperature: 0,
    maxTokens: 512,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  return result.content.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run data quality and completeness checks.
 *
 * @param {{ resolved_values: object, conflicts: Array }} reconciled
 *   Output from reconciler.js. Can also accept raw resolved_values directly.
 * @param {{ primary_sector?: string }} classification
 *   Sector classification from sector.js (used for margin range checks).
 * @param {Array} [extractions] - Original extractions (for currency/name checks).
 * @returns {{ passed: boolean, score: number, issues: Array, summary: string }}
 */
export async function checkQuality(reconciled, classification, extractions) {
  const resolvedValues =
    reconciled.resolved_values || reconciled;

  // Run all pure JS checks
  const issues = [
    ...checkRequiredFields(resolvedValues),
    ...checkYoyConsistency(resolvedValues),
    ...checkMarginRanges(resolvedValues, classification),
    ...checkCurrencyConsistency(extractions),
    ...checkCompanyNameConsistency(extractions),
  ];

  // Calculate score
  const score = calculateScore(resolvedValues, issues);

  // Determine pass/fail: must have no errors and score >= 40
  const hasErrors = issues.some((i) => i.severity === 'error');
  const passed = !hasErrors && score >= 40;

  // Generate plain-language summary via Haiku
  let summary = '';
  try {
    summary = await generateSummary(resolvedValues, issues, score, classification);
  } catch (err) {
    summary = `Quality score: ${score}/100. ${issues.length} issue(s) found. ${passed ? 'Data passed quality checks.' : 'Data failed quality checks — review required.'}`;
  }

  return {
    passed,
    score,
    issues,
    summary,
  };
}
