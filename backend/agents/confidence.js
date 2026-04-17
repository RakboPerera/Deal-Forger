// ---------------------------------------------------------------------------
// Confidence Scorer
//
// 5-factor scoring system for valuation model outputs and chat answers.
// Each factor produces a 0–1 score; the weighted combination yields an
// overall confidence that maps to a traffic-light badge.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Factor weights
// ---------------------------------------------------------------------------
const MODEL_WEIGHTS = {
  completeness: 0.25,
  freshness: 0.15,
  assumptions: 0.20,
  crossValidation: 0.20,
  benchmarkDeviation: 0.20,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function badge(score) {
  if (score >= 0.75) return 'green';
  if (score >= 0.50) return 'yellow';
  return 'red';
}

// ---------------------------------------------------------------------------
// Factor scorers
// ---------------------------------------------------------------------------

/**
 * Data completeness — what percentage of required model inputs were sourced
 * from hard data (documents, filings, market data) vs. assumptions/defaults?
 *
 * @param {object} inputs - Model input map.  Each value should have a `source`
 *   field: 'data' | 'assumption' | 'default'.
 * @returns {number} 0–1
 */
function scoreCompleteness(inputs) {
  if (!inputs || typeof inputs !== 'object') return 0;

  const entries = Object.values(inputs);
  if (entries.length === 0) return 0;

  let dataCount = 0;
  for (const entry of entries) {
    const source = typeof entry === 'object' && entry !== null ? entry.source : entry;
    if (source === 'data' || source === 'extracted' || source === 'market') {
      dataCount++;
    }
  }

  return dataCount / entries.length;
}

/**
 * Data freshness — penalise stale data.  Expects an array of date strings or
 * timestamps representing when the underlying data was generated / published.
 *
 * Scoring curve:
 *   <=  3 months old → 1.0
 *   <=  6 months old → 0.85
 *   <= 12 months old → 0.65
 *   <= 24 months old → 0.40
 *   >  24 months old → 0.20
 *
 * The final score is the *average* freshness across all data points.
 *
 * @param {Array<string|number|Date>} dates
 * @returns {number} 0–1
 */
function scoreFreshness(dates) {
  if (!dates || dates.length === 0) return 0.5; // neutral when unknown

  const now = Date.now();
  const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

  let total = 0;
  for (const d of dates) {
    const ts = new Date(d).getTime();
    if (Number.isNaN(ts)) {
      total += 0.5;
      continue;
    }
    const ageMonths = (now - ts) / MONTH_MS;
    if (ageMonths <= 3) total += 1.0;
    else if (ageMonths <= 6) total += 0.85;
    else if (ageMonths <= 12) total += 0.65;
    else if (ageMonths <= 24) total += 0.40;
    else total += 0.20;
  }

  return total / dates.length;
}

/**
 * Assumption count — each assumption deducts from a perfect base of 1.0.
 * Deduction per assumption is configurable; default 0.08 (so ~12 assumptions
 * drive the score to zero).
 *
 * @param {Array} assumptions - List of assumption objects / strings.
 * @param {number} [deductionPer=0.08]
 * @returns {number} 0–1
 */
function scoreAssumptions(assumptions, deductionPer = 0.08) {
  if (!assumptions || assumptions.length === 0) return 1.0;
  return clamp(1.0 - assumptions.length * deductionPer);
}

/**
 * Cross-validation — do independent valuation methods agree?
 *
 * Compares pairs of valuation outputs (e.g. DCF vs comps).  If all pairs
 * agree within `threshold` (default 25%), score is 1.0.  Score degrades
 * linearly as divergence increases, hitting 0 at 100% divergence.
 *
 * @param {object} outputs - Map of method name -> enterprise value (number).
 * @param {number} [threshold=0.25]
 * @returns {number} 0–1
 */
function scoreCrossValidation(outputs, threshold = 0.25) {
  if (!outputs || typeof outputs !== 'object') return 0.5;

  const values = Object.values(outputs).filter((v) => typeof v === 'number' && v > 0);
  if (values.length < 2) return 0.5; // can't cross-validate a single method

  // Compute pairwise relative divergence and take the worst.
  let maxDivergence = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const avg = (values[i] + values[j]) / 2;
      const divergence = Math.abs(values[i] - values[j]) / avg;
      if (divergence > maxDivergence) maxDivergence = divergence;
    }
  }

  if (maxDivergence <= threshold) return 1.0;
  // Linear degradation from 1.0 at threshold to 0.0 at 1.0 (100% divergence).
  return clamp(1.0 - (maxDivergence - threshold) / (1.0 - threshold));
}

/**
 * Benchmark deviation — are the model's output multiples / margins within
 * typical sector ranges?
 *
 * Expects an array of { metric, value, sectorLow, sectorHigh } objects.
 * Score is 1.0 when all metrics fall within range; degrades linearly as
 * values deviate beyond the boundaries.
 *
 * @param {Array<{ metric: string, value: number, sectorLow: number, sectorHigh: number }>} benchmarks
 * @returns {number} 0–1
 */
function scoreBenchmarkDeviation(benchmarks) {
  if (!benchmarks || benchmarks.length === 0) return 0.5; // no benchmarks available

  let total = 0;

  for (const b of benchmarks) {
    const { value, sectorLow, sectorHigh } = b;
    if (typeof value !== 'number' || typeof sectorLow !== 'number' || typeof sectorHigh !== 'number') {
      total += 0.5;
      continue;
    }

    if (value >= sectorLow && value <= sectorHigh) {
      total += 1.0;
    } else {
      // How far outside the range?
      const range = sectorHigh - sectorLow || 1;
      const overshoot = value < sectorLow
        ? (sectorLow - value) / range
        : (value - sectorHigh) / range;
      total += clamp(1.0 - overshoot);
    }
  }

  return total / benchmarks.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score confidence for a valuation model's outputs.
 *
 * @param {object} opts
 * @param {object} opts.inputs       - Model input map (each value has `.source`).
 * @param {object} opts.outputs      - Valuation results by method, e.g.
 *                                     { dcf: 500e6, comps: 480e6 }.
 * @param {Array}  [opts.comps]      - Comparable-company benchmark data.
 *                                     Array of { metric, value, sectorLow, sectorHigh }.
 * @param {Array}  [opts.assumptions]- List of assumptions made by the model.
 * @param {Array<string|Date>} [opts.dataDates] - Dates of underlying data sources.
 *
 * @returns {{
 *   overall: number,
 *   factors: {
 *     completeness: number,
 *     freshness: number,
 *     assumptions: number,
 *     crossValidation: number,
 *     benchmarkDeviation: number,
 *   },
 *   badge: 'green'|'yellow'|'red'
 * }}
 */
export function scoreModelConfidence({ inputs, outputs, comps, assumptions, dataDates } = {}) {
  const factors = {
    completeness: scoreCompleteness(inputs),
    freshness: scoreFreshness(dataDates),
    assumptions: scoreAssumptions(assumptions),
    crossValidation: scoreCrossValidation(outputs),
    benchmarkDeviation: scoreBenchmarkDeviation(comps),
  };

  let overall = 0;
  for (const [key, weight] of Object.entries(MODEL_WEIGHTS)) {
    overall += (factors[key] ?? 0) * weight;
  }
  overall = clamp(Math.round(overall * 1000) / 1000); // 3 decimal places

  return {
    overall,
    factors,
    badge: badge(overall),
  };
}

/**
 * Score confidence for a chat / Q&A answer.
 *
 * Simpler version: considers how many tool calls returned data, how many
 * data points back the answer, and how many assumptions were needed.
 *
 * @param {object} opts
 * @param {Array}  opts.toolCalls    - Array of { tool, output } from the agent loop.
 * @param {number} opts.dataPoints   - Number of concrete data points cited.
 * @param {Array}  [opts.assumptions]- Assumptions made to answer.
 *
 * @returns {{ overall: number, factors: { toolSuccess: number, dataDensity: number, assumptions: number }, badge: 'green'|'yellow'|'red' }}
 */
export function scoreChatConfidence({ toolCalls, dataPoints, assumptions } = {}) {
  // Factor 1: Tool success rate (40%).
  let toolSuccess = 0.5;
  if (toolCalls && toolCalls.length > 0) {
    const successes = toolCalls.filter(
      (tc) => tc.output && !tc.output.error && tc.output !== null,
    ).length;
    toolSuccess = successes / toolCalls.length;
  }

  // Factor 2: Data density (35%) — more data points → higher confidence.
  // Curve: 0 points = 0, 1 = 0.4, 3 = 0.7, 5+ = 1.0
  const dp = typeof dataPoints === 'number' ? dataPoints : 0;
  let dataDensity;
  if (dp === 0) dataDensity = 0;
  else if (dp === 1) dataDensity = 0.4;
  else if (dp === 2) dataDensity = 0.6;
  else if (dp <= 4) dataDensity = 0.7 + (dp - 3) * 0.1;
  else dataDensity = 1.0;
  dataDensity = clamp(dataDensity);

  // Factor 3: Assumptions penalty (25%).
  const assumptionScore = scoreAssumptions(assumptions);

  const factors = {
    toolSuccess,
    dataDensity,
    assumptions: assumptionScore,
  };

  const weights = { toolSuccess: 0.40, dataDensity: 0.35, assumptions: 0.25 };
  let overall = 0;
  for (const [key, weight] of Object.entries(weights)) {
    overall += (factors[key] ?? 0) * weight;
  }
  overall = clamp(Math.round(overall * 1000) / 1000);

  return {
    overall,
    factors,
    badge: badge(overall),
  };
}
