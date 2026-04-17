import { callLLM } from '../llm.js';

// ---------------------------------------------------------------------------
// Severity levels
// ---------------------------------------------------------------------------

const SEVERITY = {
  ERROR: 'error',       // Model may be wrong; must address
  WARNING: 'warning',   // Unusual but possibly intentional
  INFO: 'info',         // Informational observation
};

const CATEGORY = {
  MULTIPLE: 'implied_multiple',
  TERMINAL: 'terminal_value',
  GROWTH: 'growth_trajectory',
  WACC: 'wacc',
  MARGIN: 'margin',
  CROSS_VAL: 'cross_validation',
  IRR: 'irr_moic',
  CONSISTENCY: 'consistency',
};

// ---------------------------------------------------------------------------
// Pure JS validation checks
// ---------------------------------------------------------------------------

/**
 * Check that implied EV/EBITDA from DCF is within range of selected comps.
 */
function checkImpliedMultiple(dcf, comps) {
  const flags = [];
  if (!dcf?.impliedMultiples?.evEbitda || !comps || comps.length === 0) return flags;

  const compMultiples = comps
    .map((c) => c.ev_ebitda)
    .filter((v) => v != null && isFinite(v));

  if (compMultiples.length === 0) return flags;

  const compMin = Math.min(...compMultiples);
  const compMax = Math.max(...compMultiples);
  const implied = dcf.impliedMultiples.evEbitda;

  // Allow 50% buffer around the comp range
  const lowerBound = compMin * 0.5;
  const upperBound = compMax * 1.5;

  if (implied < lowerBound) {
    flags.push({
      severity: SEVERITY.WARNING,
      category: CATEGORY.MULTIPLE,
      message: `Implied EV/EBITDA (${implied}x) is well below comp range (${compMin}x - ${compMax}x)`,
      details: { implied, compMin, compMax, lowerBound },
    });
  } else if (implied > upperBound) {
    flags.push({
      severity: SEVERITY.WARNING,
      category: CATEGORY.MULTIPLE,
      message: `Implied EV/EBITDA (${implied}x) is well above comp range (${compMin}x - ${compMax}x)`,
      details: { implied, compMin, compMax, upperBound },
    });
  }

  return flags;
}

/**
 * Check terminal value as % of total enterprise value.
 * Should be 40-80% for typical growth companies.
 */
function checkTerminalValuePct(dcf) {
  const flags = [];
  if (!dcf?.terminalValuePct) return flags;

  const pct = dcf.terminalValuePct;

  if (pct > 90) {
    flags.push({
      severity: SEVERITY.ERROR,
      category: CATEGORY.TERMINAL,
      message: `Terminal value is ${pct}% of total EV, which is extremely high. The model may be over-relying on distant cash flows.`,
      details: { terminalValuePct: pct },
    });
  } else if (pct > 80) {
    flags.push({
      severity: SEVERITY.WARNING,
      category: CATEGORY.TERMINAL,
      message: `Terminal value is ${pct}% of total EV, which is above the typical 40-80% range.`,
      details: { terminalValuePct: pct },
    });
  } else if (pct < 30) {
    flags.push({
      severity: SEVERITY.WARNING,
      category: CATEGORY.TERMINAL,
      message: `Terminal value is only ${pct}% of total EV, which is unusually low. Near-term projections may be overly aggressive.`,
      details: { terminalValuePct: pct },
    });
  }

  return flags;
}

/**
 * Check that YoY revenue/margin changes are smooth (no wild jumps).
 */
function checkGrowthSmoothness(assumptions) {
  const flags = [];
  if (!assumptions) return flags;

  const { revenueGrowth, ebitdaMargins } = assumptions;

  // Check revenue growth trajectory
  if (Array.isArray(revenueGrowth) && revenueGrowth.length > 1) {
    for (let i = 1; i < revenueGrowth.length; i++) {
      const delta = Math.abs(revenueGrowth[i] - revenueGrowth[i - 1]);
      if (delta > 0.10) {
        flags.push({
          severity: SEVERITY.WARNING,
          category: CATEGORY.GROWTH,
          message: `Revenue growth changes by ${(delta * 100).toFixed(1)}pp from year ${i} to ${i + 1} (${(revenueGrowth[i - 1] * 100).toFixed(1)}% -> ${(revenueGrowth[i] * 100).toFixed(1)}%). Abrupt changes may not be realistic.`,
          details: { year: i + 1, previousGrowth: revenueGrowth[i - 1], currentGrowth: revenueGrowth[i] },
        });
      }
    }

    // Check for negative growth in any year
    for (let i = 0; i < revenueGrowth.length; i++) {
      if (revenueGrowth[i] < -0.05) {
        flags.push({
          severity: SEVERITY.INFO,
          category: CATEGORY.GROWTH,
          message: `Revenue decline of ${(revenueGrowth[i] * 100).toFixed(1)}% projected in year ${i + 1}. Ensure this is intentional.`,
          details: { year: i + 1, growth: revenueGrowth[i] },
        });
      }
    }
  }

  // Check EBITDA margin trajectory
  if (Array.isArray(ebitdaMargins) && ebitdaMargins.length > 1) {
    for (let i = 1; i < ebitdaMargins.length; i++) {
      const delta = Math.abs(ebitdaMargins[i] - ebitdaMargins[i - 1]);
      if (delta > 0.05) {
        flags.push({
          severity: SEVERITY.WARNING,
          category: CATEGORY.MARGIN,
          message: `EBITDA margin changes by ${(delta * 100).toFixed(1)}pp from year ${i} to ${i + 1} (${(ebitdaMargins[i - 1] * 100).toFixed(1)}% -> ${(ebitdaMargins[i] * 100).toFixed(1)}%). Rapid margin expansion/contraction is unusual.`,
          details: { year: i + 1, previousMargin: ebitdaMargins[i - 1], currentMargin: ebitdaMargins[i] },
        });
      }
    }

    // Total margin expansion over 5 years
    const totalMarginChange = ebitdaMargins[ebitdaMargins.length - 1] - ebitdaMargins[0];
    if (totalMarginChange > 0.15) {
      flags.push({
        severity: SEVERITY.WARNING,
        category: CATEGORY.MARGIN,
        message: `Total EBITDA margin expansion of ${(totalMarginChange * 100).toFixed(1)}pp over the projection period is aggressive.`,
        details: { startMargin: ebitdaMargins[0], endMargin: ebitdaMargins[ebitdaMargins.length - 1] },
      });
    }
  }

  return flags;
}

/**
 * Check that WACC is in a reasonable range for most sectors.
 */
function checkWACC(assumptions) {
  const flags = [];
  if (assumptions?.wacc == null) return flags;

  const wacc = assumptions.wacc;

  if (wacc < 0.06) {
    flags.push({
      severity: SEVERITY.ERROR,
      category: CATEGORY.WACC,
      message: `WACC of ${(wacc * 100).toFixed(1)}% is unusually low. Even investment-grade companies rarely have a WACC below 6%.`,
      details: { wacc },
    });
  } else if (wacc < 0.08) {
    flags.push({
      severity: SEVERITY.INFO,
      category: CATEGORY.WACC,
      message: `WACC of ${(wacc * 100).toFixed(1)}% is on the low end. Verify the risk profile supports this.`,
      details: { wacc },
    });
  } else if (wacc > 0.18) {
    flags.push({
      severity: SEVERITY.WARNING,
      category: CATEGORY.WACC,
      message: `WACC of ${(wacc * 100).toFixed(1)}% is very high. This significantly discounts future cash flows.`,
      details: { wacc },
    });
  }

  return flags;
}

/**
 * Check cross-validation between DCF and comps implied values.
 */
function checkCrossValidation(dcf, compsResult) {
  const flags = [];
  if (!dcf?.enterpriseValue || !compsResult?.impliedValues) return flags;

  const dcfEV = dcf.enterpriseValue;
  const compsEV = compsResult.impliedValues?.evEbitda?.mid
    || compsResult.impliedValues?.evRevenue?.mid;

  if (!compsEV) return flags;

  const divergence = Math.abs(dcfEV - compsEV) / ((dcfEV + compsEV) / 2);

  if (divergence > 0.50) {
    flags.push({
      severity: SEVERITY.WARNING,
      category: CATEGORY.CROSS_VAL,
      message: `DCF enterprise value ($${dcfEV.toFixed(1)}M) and trading comps ($${compsEV.toFixed(1)}M) diverge by ${(divergence * 100).toFixed(0)}%. Investigate the source of disagreement.`,
      details: { dcfEV, compsEV, divergencePct: divergence * 100 },
    });
  } else if (divergence > 0.25) {
    flags.push({
      severity: SEVERITY.INFO,
      category: CATEGORY.CROSS_VAL,
      message: `DCF ($${dcfEV.toFixed(1)}M) and trading comps ($${compsEV.toFixed(1)}M) diverge by ${(divergence * 100).toFixed(0)}%.`,
      details: { dcfEV, compsEV, divergencePct: divergence * 100 },
    });
  }

  return flags;
}

/**
 * Check IRR and MOIC are in reasonable ranges.
 */
function checkIRRandMOIC(scenario) {
  const flags = [];

  if (scenario.irr != null) {
    const irrPct = scenario.irr * 100;
    if (irrPct < 5) {
      flags.push({
        severity: SEVERITY.WARNING,
        category: CATEGORY.IRR,
        message: `IRR of ${irrPct.toFixed(1)}% is below most PE hurdle rates (typically 15-20%). The deal may not meet return requirements.`,
        details: { irr: scenario.irr },
      });
    } else if (irrPct > 50) {
      flags.push({
        severity: SEVERITY.WARNING,
        category: CATEGORY.IRR,
        message: `IRR of ${irrPct.toFixed(1)}% is exceptionally high. Verify that entry value and exit assumptions are realistic.`,
        details: { irr: scenario.irr },
      });
    }
  }

  if (scenario.moic != null) {
    if (scenario.moic < 1.0) {
      flags.push({
        severity: SEVERITY.ERROR,
        category: CATEGORY.IRR,
        message: `MOIC of ${scenario.moic.toFixed(2)}x indicates a loss on invested capital.`,
        details: { moic: scenario.moic },
      });
    } else if (scenario.moic > 6.0) {
      flags.push({
        severity: SEVERITY.INFO,
        category: CATEGORY.IRR,
        message: `MOIC of ${scenario.moic.toFixed(2)}x is exceptionally high. Verify exit assumptions.`,
        details: { moic: scenario.moic },
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// LLM-powered narrative summary
// ---------------------------------------------------------------------------

const VALIDATION_SUMMARY_PROMPT = `You are a senior investment committee reviewer. You have received a set of validation flags from an automated check of a financial valuation model.

Produce a brief, professional plain-language summary (3-5 sentences) that:
1. States whether the model is generally sound or has material issues.
2. Highlights the most important flag(s) by category.
3. Suggests 1-2 concrete next steps for the analyst.

Do NOT repeat every flag. Focus on what matters most for decision-making.

Respond with ONLY a JSON object:
{
  "summary": "...",
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a model draft across a comprehensive set of checks.
 *
 * Runs deterministic JS checks first, then calls Claude Haiku
 * for a plain-language summary and suggestions.
 *
 * @param {Object} params
 * @param {Object} params.modelDraft - The complete model draft from buildModel().
 *   Must contain scenarios.base at minimum.
 * @param {Array}  [params.comps=[]] - Comparable companies used in the model.
 * @param {Object} [params.financials={}] - Target company financials.
 *
 * @returns {Object} ValidationReport
 *   { passed: boolean, flags: Array, suggestions: Array, summary: string,
 *     metadata: { checksRun, flagCount, llmUsage } }
 */
export async function validateModel({ modelDraft, comps = [], financials = {} }) {
  if (!modelDraft?.scenarios) {
    throw new Error('validateModel requires a modelDraft with scenarios');
  }

  const allFlags = [];
  let checksRun = 0;

  // Validate each scenario
  for (const [scenarioName, scenario] of Object.entries(modelDraft.scenarios)) {
    const { assumptions, dcf, tradingComps, precedentTransactions } = scenario;
    const prefix = scenarioName === 'base' ? '' : `[${scenarioName}] `;

    // 1. Implied multiples vs comps
    const multipleFlags = checkImpliedMultiple(dcf, comps);
    checksRun++;
    for (const f of multipleFlags) {
      allFlags.push({ ...f, message: `${prefix}${f.message}`, scenario: scenarioName });
    }

    // 2. Terminal value %
    const tvFlags = checkTerminalValuePct(dcf);
    checksRun++;
    for (const f of tvFlags) {
      allFlags.push({ ...f, message: `${prefix}${f.message}`, scenario: scenarioName });
    }

    // 3. Growth smoothness
    const growthFlags = checkGrowthSmoothness(assumptions);
    checksRun++;
    for (const f of growthFlags) {
      allFlags.push({ ...f, message: `${prefix}${f.message}`, scenario: scenarioName });
    }

    // 4. WACC reasonableness
    const waccFlags = checkWACC(assumptions);
    checksRun++;
    for (const f of waccFlags) {
      allFlags.push({ ...f, message: `${prefix}${f.message}`, scenario: scenarioName });
    }

    // 5. Cross-validation (DCF vs comps)
    const crossValFlags = checkCrossValidation(dcf, tradingComps);
    checksRun++;
    for (const f of crossValFlags) {
      allFlags.push({ ...f, message: `${prefix}${f.message}`, scenario: scenarioName });
    }

    // 6. IRR and MOIC
    const irrFlags = checkIRRandMOIC(scenario);
    checksRun++;
    for (const f of irrFlags) {
      allFlags.push({ ...f, message: `${prefix}${f.message}`, scenario: scenarioName });
    }
  }

  // Cross-scenario consistency checks
  checksRun++;
  const crossScenarioFlags = checkCrossScenarioConsistency(modelDraft.scenarios);
  allFlags.push(...crossScenarioFlags);

  // Determine pass/fail: fail if any ERROR-level flags exist
  const hasErrors = allFlags.some((f) => f.severity === SEVERITY.ERROR);
  const passed = !hasErrors;

  // Call Claude Haiku for a narrative summary
  let summary = '';
  let suggestions = [];
  let llmUsage = null;

  if (allFlags.length > 0) {
    try {
      const flagSummaryInput = allFlags.map((f) =>
        `[${f.severity.toUpperCase()}] (${f.category}) ${f.message}`
      ).join('\n');

      const llmResult = await callLLM({
        tier: 'light',
        temperature: 0,
        maxTokens: 1024,
        system: VALIDATION_SUMMARY_PROMPT,
        messages: [{
          role: 'user',
          content: `Validation flags for the model:\n\n${flagSummaryInput}\n\nTarget company revenue: $${financials.revenue ?? '?'}M, EBITDA: $${financials.ebitda ?? '?'}M`,
        }],
      });

      llmUsage = llmResult.usage;

      let parsed;
      try {
        let raw = llmResult.content.trim();
        if (raw.startsWith('```')) {
          raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        }
        parsed = JSON.parse(raw);
      } catch {
        parsed = { summary: llmResult.content, suggestions: [] };
      }

      summary = parsed.summary || '';
      suggestions = parsed.suggestions || [];
    } catch {
      // If LLM call fails, still return the deterministic results
      summary = passed
        ? 'Model passed all critical checks with some informational flags.'
        : 'Model has one or more critical issues that should be addressed before proceeding.';
      suggestions = hasErrors
        ? ['Review and address all error-level flags before submitting for approval.']
        : [];
    }
  } else {
    summary = 'Model passed all validation checks with no flags. Assumptions and outputs appear reasonable.';
  }

  return {
    passed,
    flags: allFlags,
    suggestions,
    summary,
    metadata: {
      checksRun,
      flagCount: {
        total: allFlags.length,
        errors: allFlags.filter((f) => f.severity === SEVERITY.ERROR).length,
        warnings: allFlags.filter((f) => f.severity === SEVERITY.WARNING).length,
        info: allFlags.filter((f) => f.severity === SEVERITY.INFO).length,
      },
      llmUsage,
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-scenario consistency
// ---------------------------------------------------------------------------

/**
 * Verify that upside > base > downside for key metrics.
 */
function checkCrossScenarioConsistency(scenarios) {
  const flags = [];

  if (!scenarios.base || !scenarios.upside || !scenarios.downside) return flags;

  const baseEV = scenarios.base.dcf?.enterpriseValue;
  const upsideEV = scenarios.upside.dcf?.enterpriseValue;
  const downsideEV = scenarios.downside.dcf?.enterpriseValue;

  if (baseEV != null && upsideEV != null && downsideEV != null) {
    if (upsideEV <= baseEV) {
      flags.push({
        severity: SEVERITY.ERROR,
        category: CATEGORY.CONSISTENCY,
        message: `Upside EV ($${upsideEV.toFixed(1)}M) is not greater than base case ($${baseEV.toFixed(1)}M). Scenario ordering is inconsistent.`,
        details: { baseEV, upsideEV, downsideEV },
      });
    }
    if (downsideEV >= baseEV) {
      flags.push({
        severity: SEVERITY.ERROR,
        category: CATEGORY.CONSISTENCY,
        message: `Downside EV ($${downsideEV.toFixed(1)}M) is not less than base case ($${baseEV.toFixed(1)}M). Scenario ordering is inconsistent.`,
        details: { baseEV, upsideEV, downsideEV },
      });
    }
  }

  // Check WACC ordering: upside < base < downside (lower WACC = more optimistic)
  const baseWACC = scenarios.base.assumptions?.wacc;
  const upsideWACC = scenarios.upside.assumptions?.wacc;
  const downsideWACC = scenarios.downside.assumptions?.wacc;

  if (baseWACC != null && upsideWACC != null && downsideWACC != null) {
    if (upsideWACC > baseWACC) {
      flags.push({
        severity: SEVERITY.WARNING,
        category: CATEGORY.CONSISTENCY,
        message: `Upside WACC (${(upsideWACC * 100).toFixed(1)}%) is higher than base case (${(baseWACC * 100).toFixed(1)}%). Upside scenarios typically use a lower discount rate.`,
        details: { baseWACC, upsideWACC, downsideWACC },
      });
    }
    if (downsideWACC < baseWACC) {
      flags.push({
        severity: SEVERITY.WARNING,
        category: CATEGORY.CONSISTENCY,
        message: `Downside WACC (${(downsideWACC * 100).toFixed(1)}%) is lower than base case (${(baseWACC * 100).toFixed(1)}%). Downside scenarios typically use a higher discount rate.`,
        details: { baseWACC, upsideWACC, downsideWACC },
      });
    }
  }

  return flags;
}
