// ---------------------------------------------------------------------------
// sector.js — Sector Classification & Comparables Selection (Claude Sonnet)
// ---------------------------------------------------------------------------
// Two-step agent:
//   Step 1: Classify sector from financials + business description.
//   Step 2: Select best comparable companies and transactions.
// ---------------------------------------------------------------------------

import { callLLM } from '../llm.js';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const CLASSIFY_SYSTEM_PROMPT = `You are a senior M&A analyst classifying a target company's sector, sub-sector, and business model for the purpose of selecting valuation comparables.

## Instructions

Analyze the provided financial profile and any business description to determine:

1. **primary_sector**: You MUST pick exactly one value from this enumerated list (no other values accepted):
   - "Enterprise SaaS"
   - "HealthTech"
   - "FinTech"
   - "Industrial IoT"
   - "Cybersecurity"
   If none of these fit well, pick the closest match — do NOT invent a new label like "Technology" or "Software".
2. **sub_sector**: More specific grouping within the primary_sector (e.g., "Observability", "Specialty Pharma", "Payment Infrastructure").
3. **vertical**: Niche market or end-market focus (e.g., "Cybersecurity for Financial Services", "Orthopedic Devices", "Last-Mile Logistics").
4. **business_model**: Revenue model type. One of: recurring_subscription, recurring_contractual, transactional, project_based, marketplace, licensing, hybrid.
5. **stage**: Company lifecycle stage. One of: early_stage, growth, scaling, mature, turnaround, distressed.
6. **comparable_archetypes**: 3-5 short descriptions of the ideal comparable company profile (e.g., "Mid-market SaaS with 80%+ recurring revenue and $20-80M ARR").

Use financial metrics (margins, growth rates, revenue scale) to inform the classification. For example:
- High gross margins (70%+) + recurring revenue -> likely SaaS/software
- Low gross margins (20-40%) + high asset base -> likely manufacturing/industrial
- High employee count relative to revenue -> likely services business

Respond with ONLY a JSON object:
{
  "primary_sector": "...",
  "sub_sector": "...",
  "vertical": "...",
  "business_model": "...",
  "stage": "...",
  "comparable_archetypes": ["...", "...", "..."]
}`;

const COMPS_SYSTEM_PROMPT = `You are a senior M&A analyst selecting comparable companies and precedent transactions for a valuation exercise.

## Instructions

Given the target company's sector classification and financial profile, review the provided lists of available comparable companies and precedent transactions. Select the most relevant ones.

## Selection Criteria

1. **Business model similarity**: Same revenue model (recurring vs. transactional vs. project-based).
2. **Size proximity**: Revenue within 0.3x to 3x of the target (prefer closer matches).
3. **Growth profile similarity**: Similar revenue growth rates (within 10 percentage points).
4. **Margin profile**: Similar EBITDA margins (within 10 percentage points).
5. **End-market overlap**: Serving similar customers or industries.
6. **Geography**: Same primary market preferred but not required.

## Output Requirements

- Select 5-15 comparable companies (fewer if the available pool is small).
- Select 3-10 precedent transactions.
- For each selected comp/transaction, provide:
  - relevance_score (0.0-1.0): How relevant is this comparable
  - reasoning: 1-2 sentence explanation of why selected
- Include a rejected_with_reasons array for notable near-misses (top 5 rejected).

Respond with ONLY a JSON object:
{
  "selected_comps": [
    { "record_id": "...", "company_name": "...", "relevance_score": 0.85, "reasoning": "..." }
  ],
  "selected_transactions": [
    { "record_id": "...", "transaction_name": "...", "relevance_score": 0.80, "reasoning": "..." }
  ],
  "rejected_with_reasons": [
    { "record_id": "...", "name": "...", "reason": "..." }
  ]
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a financial profile summary for the classifier. */
function buildProfileSummary(extractedProfile) {
  const parts = [];

  if (extractedProfile.company_name) {
    parts.push(`Company: ${extractedProfile.company_name}`);
  }

  if (extractedProfile.currency) {
    parts.push(`Currency: ${extractedProfile.currency} (${extractedProfile.unit || 'units'})`);
  }

  const periods = extractedProfile.periods || [];
  if (periods.length === 0) {
    parts.push('No financial periods available.');
    return parts.join('\n');
  }

  // Sort periods by year
  const sorted = [...periods].sort((a, b) => (a.year > b.year ? 1 : -1));

  for (const period of sorted) {
    parts.push(`\n--- ${period.year} ---`);
    const f = period.fields || {};
    for (const [key, value] of Object.entries(f)) {
      parts.push(`  ${key}: ${value}`);
    }

    // Compute derived metrics if possible
    if (f.revenue && f.gross_profit) {
      parts.push(`  gross_margin: ${((f.gross_profit / f.revenue) * 100).toFixed(1)}%`);
    }
    if (f.revenue && f.ebitda) {
      parts.push(`  ebitda_margin: ${((f.ebitda / f.revenue) * 100).toFixed(1)}%`);
    }
    if (f.revenue && f.net_income) {
      parts.push(`  net_margin: ${((f.net_income / f.revenue) * 100).toFixed(1)}%`);
    }
  }

  // YoY revenue growth if multiple periods
  if (sorted.length >= 2) {
    const recent = sorted[sorted.length - 1].fields?.revenue;
    const prior = sorted[sorted.length - 2].fields?.revenue;
    if (recent && prior && prior !== 0) {
      const growth = ((recent - prior) / Math.abs(prior)) * 100;
      parts.push(`\nRevenue YoY growth: ${growth.toFixed(1)}%`);
    }
  }

  return parts.join('\n');
}

/** Build a compact summary of available comps for the LLM. */
function summarizeComps(comps) {
  if (!comps || comps.length === 0) return 'No comparable companies available.';

  return comps
    .map((c) => {
      const parts = [`ID: ${c.record_id}, Name: ${c.company_name}`];
      if (c.sector) parts.push(`Sector: ${c.sector}`);
      if (c.revenue) parts.push(`Revenue: ${c.revenue}`);
      if (c.ebitda_margin) parts.push(`EBITDA Margin: ${c.ebitda_margin}`);
      if (c.revenue_growth) parts.push(`Growth: ${c.revenue_growth}`);
      if (c.description) parts.push(`Desc: ${c.description.slice(0, 100)}`);
      return parts.join(' | ');
    })
    .join('\n');
}

/** Build a compact summary of available transactions for the LLM. */
function summarizeTransactions(transactions) {
  if (!transactions || transactions.length === 0) return 'No precedent transactions available.';

  return transactions
    .map((t) => {
      const parts = [`ID: ${t.record_id}, Name: ${t.transaction_name || t.target_name}`];
      if (t.sector) parts.push(`Sector: ${t.sector}`);
      if (t.ev) parts.push(`EV: ${t.ev}`);
      if (t.ev_revenue) parts.push(`EV/Rev: ${t.ev_revenue}`);
      if (t.ev_ebitda) parts.push(`EV/EBITDA: ${t.ev_ebitda}`);
      if (t.date) parts.push(`Date: ${t.date}`);
      if (t.description) parts.push(`Desc: ${t.description.slice(0, 100)}`);
      return parts.join(' | ');
    })
    .join('\n');
}

/** Parse JSON response with fallback. */
function parseJsonResponse(content, fallback) {
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch { /* fall through */ }
    }
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch { /* fall through */ }
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify sector and select comparable companies/transactions.
 *
 * @param {object} extractedProfile - Reconciled financial extraction (or single extraction).
 * @param {Array} allComps - All available comparable companies from the database.
 * @param {Array} allTransactions - All available precedent transactions from the database.
 * @returns {{ classification: object, selected_comps: Array, selected_transactions: Array, rejected_with_reasons: Array }}
 */
export async function classifyAndSelectComps(extractedProfile, allComps, allTransactions) {
  // ---- Step 1: Classify sector ----
  const profileSummary = buildProfileSummary(extractedProfile);

  const classifyResult = await callLLM({
    tier: 'heavy',
    temperature: 0,
    maxTokens: 1024,
    system: CLASSIFY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Financial profile:\n${profileSummary}` }],
  });

  const classification = parseJsonResponse(classifyResult.content, {
    primary_sector: 'Unknown',
    sub_sector: 'Unknown',
    vertical: 'Unknown',
    business_model: 'hybrid',
    stage: 'mature',
    comparable_archetypes: [],
  });

  // Enforce the enumerated sector vocabulary. If the LLM returned something
  // outside the list (e.g. "Technology"), map to the closest valid value by
  // substring or default to the first option. Prevents downstream comp-matching
  // failures because no row in comparable_companies has sector="Technology".
  const VALID_SECTORS = ['Enterprise SaaS', 'HealthTech', 'FinTech', 'Industrial IoT', 'Cybersecurity'];
  const sectorSynonyms = {
    technology: 'Enterprise SaaS',
    saas: 'Enterprise SaaS',
    software: 'Enterprise SaaS',
    healthcare: 'HealthTech',
    medical: 'HealthTech',
    medtech: 'HealthTech',
    'financial services': 'FinTech',
    payments: 'FinTech',
    finance: 'FinTech',
    industrial: 'Industrial IoT',
    manufacturing: 'Industrial IoT',
    iot: 'Industrial IoT',
    security: 'Cybersecurity',
    cyber: 'Cybersecurity',
  };
  if (!VALID_SECTORS.includes(classification.primary_sector)) {
    const lower = String(classification.primary_sector || '').toLowerCase();
    const matched =
      VALID_SECTORS.find((v) => v.toLowerCase() === lower) ||
      Object.entries(sectorSynonyms).find(([k]) => lower.includes(k))?.[1];
    classification.sector_original = classification.primary_sector;
    classification.primary_sector = matched || VALID_SECTORS[0];
    classification.sector_coerced = !matched ? 'defaulted' : 'mapped';
  }

  // ---- Step 2: Select comparables ----
  // If no comps or transactions available, skip this step
  if ((!allComps || allComps.length === 0) && (!allTransactions || allTransactions.length === 0)) {
    return {
      classification,
      selected_comps: [],
      selected_transactions: [],
      rejected_with_reasons: [],
    };
  }

  const compsMessage = `## Target Company Classification
Primary Sector: ${classification.primary_sector}
Sub-Sector: ${classification.sub_sector}
Vertical: ${classification.vertical}
Business Model: ${classification.business_model}
Stage: ${classification.stage}
Comparable Archetypes: ${(classification.comparable_archetypes || []).join('; ')}

## Target Financial Profile
${profileSummary}

## Available Comparable Companies (${(allComps || []).length} total)
${summarizeComps(allComps || [])}

## Available Precedent Transactions (${(allTransactions || []).length} total)
${summarizeTransactions(allTransactions || [])}`;

  const compsResult = await callLLM({
    tier: 'heavy',
    temperature: 0,
    maxTokens: 4096,
    system: COMPS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: compsMessage }],
  });

  const compsSelection = parseJsonResponse(compsResult.content, {
    selected_comps: [],
    selected_transactions: [],
    rejected_with_reasons: [],
  });

  // Normalize scores
  const selected_comps = (compsSelection.selected_comps || []).map((c) => ({
    record_id: c.record_id,
    company_name: c.company_name,
    relevance_score: Math.max(0, Math.min(1, Number(c.relevance_score) || 0)),
    reasoning: c.reasoning || '',
  }));

  const selected_transactions = (compsSelection.selected_transactions || []).map((t) => ({
    record_id: t.record_id,
    transaction_name: t.transaction_name,
    relevance_score: Math.max(0, Math.min(1, Number(t.relevance_score) || 0)),
    reasoning: t.reasoning || '',
  }));

  return {
    classification,
    selected_comps,
    selected_transactions,
    rejected_with_reasons: compsSelection.rejected_with_reasons || [],
  };
}
