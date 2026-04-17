// ---------------------------------------------------------------------------
// reconciler.js — Cross-Document Reconciliation (JS + Claude Haiku)
// ---------------------------------------------------------------------------
// Compares financial extractions from multiple documents for the same fiscal
// periods. Pure JS identifies discrepancies; Claude Haiku explains them.
// ---------------------------------------------------------------------------

import { callLLM } from '../llm.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Source hierarchy: higher number = higher authority. */
const SOURCE_HIERARCHY = {
  audited_financial_statement: 100,
  management_presentation: 70,
  cim: 60,
  due_diligence_report: 80,
  narrative_memo: 40,
  customer_list: 30,
  data_room_index: 10,
  legal_document: 20,
  irrelevant: 0,
};

/** Threshold for flagging a discrepancy (5%). */
const DISCREPANCY_THRESHOLD = 0.05;

/** Fields that are counts (not currency amounts). */
const COUNT_FIELDS = new Set(['employees']);

// ---------------------------------------------------------------------------
// Pure JS: Conflict Detection
// ---------------------------------------------------------------------------

/**
 * Find matching extractions by company + period and detect discrepancies.
 *
 * @param {Array} extractions - Array of { extraction, documentType, sourceFile }
 * @returns {{ conflicts: Array, periodSourceMap: Map }}
 */
function detectConflicts(extractions) {
  // Build a map: period -> field -> [{ source, value, docType, priority }]
  const periodFieldMap = new Map();

  for (const { extraction, documentType, sourceFile } of extractions) {
    const priority = SOURCE_HIERARCHY[documentType] ?? 0;

    for (const period of extraction.periods || []) {
      const periodKey = period.year;

      if (!periodFieldMap.has(periodKey)) {
        periodFieldMap.set(periodKey, new Map());
      }

      const fieldMap = periodFieldMap.get(periodKey);

      for (const [field, value] of Object.entries(period.fields || {})) {
        if (value === null || value === undefined) continue;

        if (!fieldMap.has(field)) {
          fieldMap.set(field, []);
        }

        fieldMap.get(field).push({
          source: sourceFile,
          value: Number(value),
          docType: documentType,
          priority,
          confidence: period.confidence?.[field] ?? 0.5,
        });
      }
    }
  }

  // Detect discrepancies
  const conflicts = [];

  for (const [period, fieldMap] of periodFieldMap) {
    for (const [field, sources] of fieldMap) {
      if (sources.length < 2) continue;

      // Compare all pairs for discrepancies
      const values = sources.map((s) => s.value);
      const maxVal = Math.max(...values.map(Math.abs));

      if (maxVal === 0) continue; // All zeros, no meaningful discrepancy

      // Check if any pair exceeds the threshold
      let hasDiscrepancy = false;
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const diff = Math.abs(values[i] - values[j]);
          const pctDiff = diff / maxVal;
          if (pctDiff > DISCREPANCY_THRESHOLD) {
            hasDiscrepancy = true;
            break;
          }
        }
        if (hasDiscrepancy) break;
      }

      if (hasDiscrepancy) {
        // Resolve by hierarchy: pick the source with highest priority,
        // breaking ties by confidence.
        const sorted = [...sources].sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return b.confidence - a.confidence;
        });

        conflicts.push({
          field,
          period,
          values: sources.map((s) => ({
            source: s.source,
            value: s.value,
            docType: s.docType,
          })),
          resolved_value: sorted[0].value,
          resolution_method: `Selected from ${sorted[0].docType} (highest authority source)`,
        });
      }
    }
  }

  return { conflicts, periodFieldMap };
}

/**
 * Build the resolved values object from all extractions + conflict resolutions.
 */
function buildResolvedValues(extractions, conflicts) {
  // Start with a merged view favoring higher-priority sources
  const resolved = {};

  // Collect all period data, sorted by source priority (lowest first, so
  // higher priority overwrites).
  const periodData = [];

  for (const { extraction, documentType } of extractions) {
    const priority = SOURCE_HIERARCHY[documentType] ?? 0;
    for (const period of extraction.periods || []) {
      periodData.push({ period, priority });
    }
  }

  periodData.sort((a, b) => a.priority - b.priority);

  for (const { period } of periodData) {
    const periodKey = period.year;
    if (!resolved[periodKey]) resolved[periodKey] = {};

    for (const [field, value] of Object.entries(period.fields || {})) {
      if (value !== null && value !== undefined) {
        resolved[periodKey][field] = Number(value);
      }
    }
  }

  // Apply explicit conflict resolutions (override with resolved_value)
  for (const conflict of conflicts) {
    if (resolved[conflict.period]) {
      resolved[conflict.period][conflict.field] = conflict.resolved_value;
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Claude Haiku: Explain Conflicts
// ---------------------------------------------------------------------------

const EXPLAIN_SYSTEM_PROMPT = `You are a financial analyst explaining data discrepancies found across multiple deal documents. For each conflict, provide a concise, plain-language explanation of why the numbers might differ and whether the resolved value is appropriate.

Respond with ONLY a JSON array of explanation strings, one per conflict. Each explanation should be 1-2 sentences.`;

async function explainConflicts(conflicts) {
  if (conflicts.length === 0) return [];

  const conflictSummaries = conflicts.map((c) => {
    const valueSummary = c.values
      .map((v) => `${v.source} (${v.docType}): ${v.value}`)
      .join('; ');
    return `${c.field} for ${c.period}: ${valueSummary}. Resolved to ${c.resolved_value} via "${c.resolution_method}"`;
  });

  const userMessage = `Explain these financial data discrepancies:\n\n${conflictSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

  const result = await callLLM({
    tier: 'light',
    temperature: 0,
    maxTokens: 2048,
    system: EXPLAIN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Parse explanations
  try {
    const parsed = JSON.parse(result.content);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Try extracting array from code block
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // Fall through
      }
    }
  }

  // Fallback: return the raw content split by lines
  return conflicts.map(
    (c) => `Discrepancy in ${c.field} for ${c.period}: values differ by more than 5% across sources.`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile extractions from multiple documents.
 *
 * @param {Array<{ extraction: object, sourceFile: string }>} extractions
 *   Each has: extraction (ExtractionProposal), sourceFile (filename)
 * @param {Object<string, string>} documentTypes
 *   Map of sourceFile -> document_type
 * @returns {{ conflicts: Array, resolved_values: object, explanations: string[] }}
 */
export async function reconcileExtractions(extractions, documentTypes) {
  // Enrich extractions with document types
  const enriched = extractions.map((e) => ({
    ...e,
    documentType: documentTypes[e.sourceFile] || 'narrative_memo',
  }));

  // Step 1: Pure JS conflict detection
  const { conflicts } = detectConflicts(enriched);

  // Step 2: Build resolved values
  const resolved_values = buildResolvedValues(enriched, conflicts);

  // Step 3: Claude Haiku explanations for conflicts
  let explanations = [];
  if (conflicts.length > 0) {
    explanations = await explainConflicts(conflicts);
  }

  return {
    conflicts,
    resolved_values,
    explanations,
  };
}
