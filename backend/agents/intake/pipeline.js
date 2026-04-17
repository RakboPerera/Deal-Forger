// ---------------------------------------------------------------------------
// pipeline.js — Pipeline Orchestrator
// ---------------------------------------------------------------------------
// Chains all 7 intake agents in sequence, handling parallelization,
// progress reporting, and error recovery.
// ---------------------------------------------------------------------------

import path from 'path';
import { parseDocument } from './parser.js';
import { classifyDocument } from './classifier.js';
import { extractFinancials } from './extractor.js';
import { reconcileExtractions } from './reconciler.js';
import { classifyAndSelectComps } from './sector.js';
import { checkQuality } from './quality.js';
import { loadExtractedData } from './loader.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pipeline stages with their weight in the overall progress calculation. */
const STAGES = {
  parsing:       { weight: 10, label: 'Parsing documents' },
  classifying:   { weight: 10, label: 'Classifying documents' },
  extracting:    { weight: 35, label: 'Extracting financial data' },
  reconciling:   { weight: 10, label: 'Reconciling cross-document data' },
  sector:        { weight: 15, label: 'Classifying sector & selecting comps' },
  quality:       { weight: 10, label: 'Running quality checks' },
  loading:       { weight: 10, label: 'Loading data into database' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calculate overall progress percentage. */
function calcProgress(completedStages, currentStage, stageProgress) {
  let total = 0;

  for (const [name, stage] of Object.entries(STAGES)) {
    if (completedStages.has(name)) {
      total += stage.weight;
    } else if (name === currentStage) {
      total += stage.weight * (stageProgress / 100);
      break;
    } else {
      break;
    }
  }

  return Math.min(100, Math.round(total));
}

/** Safe progress reporter. */
function reportProgress(onProgress, completedStages, currentStage, stageProgress, details) {
  if (typeof onProgress !== 'function') return;

  const percentage = calcProgress(completedStages, currentStage, stageProgress);
  const label = STAGES[currentStage]?.label || currentStage;

  try {
    onProgress(percentage, label, details || '');
  } catch {
    // Don't let progress callback errors break the pipeline
  }
}

/** Update extraction job status in DB. */
function updateJobStatus(db, jobId, status, stage, progressPct, errorMessage) {
  if (!db || !jobId) return;

  try {
    const updates = ['status = ?', 'stage = ?', 'progress_pct = ?'];
    const params = [status, stage, progressPct];

    if (status === 'running' && !errorMessage) {
      updates.push("started_at = COALESCE(started_at, datetime('now'))");
    }
    if (errorMessage) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }
    if (status === 'completed' || status === 'failed') {
      updates.push("completed_at = datetime('now')");
    }

    params.push(jobId);
    db.run(`UPDATE extraction_jobs SET ${updates.join(', ')} WHERE id = ?`, ...params);
  } catch {
    // Non-critical: don't let job status updates break the pipeline
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the complete intake pipeline for a set of documents.
 *
 * @param {object} db - DatabaseWrapper instance.
 * @param {string} dealId - Deal ID.
 * @param {Array<{ filePath: string, filename: string }>} documentPaths
 *   Array of document descriptors with absolute file path and original filename.
 * @param {function} [onProgress] - Progress callback: (percentage, stage, details) => void
 * @returns {{ status: string, loadedFinancials: object|null, classification: object|null, selectedComps: object|null, qualityReport: object|null, errors: string[] }}
 */
export async function runIntakePipeline(db, dealId, documentPaths, onProgress) {
  const completedStages = new Set();
  const errors = [];
  let jobId = null;

  // Create or find extraction job
  try {
    const docIds = documentPaths.map((d) => d.filename).join(',');
    db.run(
      `INSERT INTO extraction_jobs (deal_id, status, stage, progress_pct, started_at, document_ids)
       VALUES (?, 'running', 'parsing', 0, datetime('now'), ?)`,
      dealId,
      docIds,
    );
    const job = db.get(
      'SELECT id FROM extraction_jobs WHERE deal_id = ? ORDER BY id DESC LIMIT 1',
      dealId,
    );
    jobId = job?.id;
  } catch (err) {
    errors.push(`Failed to create extraction job: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // Stage 1: Parse all documents
  // ---------------------------------------------------------------------------
  reportProgress(onProgress, completedStages, 'parsing', 0, 'Starting document parsing');
  updateJobStatus(db, jobId, 'running', 'parsing', 0);

  const parsedDocs = [];

  for (let i = 0; i < documentPaths.length; i++) {
    const doc = documentPaths[i];
    const stageProgress = ((i + 1) / documentPaths.length) * 100;
    reportProgress(onProgress, completedStages, 'parsing', stageProgress, `Parsing ${doc.filename}`);

    try {
      const parsed = await parseDocument(doc.filePath, doc.filename);
      parsedDocs.push({ ...doc, parsed });
    } catch (err) {
      const msg = `Failed to parse ${doc.filename}: ${err.message}`;
      errors.push(msg);
      updateJobStatus(db, jobId, 'running', 'parsing', stageProgress, msg);
    }
  }

  if (parsedDocs.length === 0) {
    updateJobStatus(db, jobId, 'failed', 'parsing', 10, 'All documents failed to parse');
    return {
      status: 'failed',
      loadedFinancials: null,
      classification: null,
      selectedComps: null,
      qualityReport: null,
      errors: [...errors, 'No documents were successfully parsed.'],
    };
  }

  completedStages.add('parsing');

  // ---------------------------------------------------------------------------
  // Stage 2: Classify all parsed documents
  // ---------------------------------------------------------------------------
  reportProgress(onProgress, completedStages, 'classifying', 0, 'Classifying documents');
  updateJobStatus(db, jobId, 'running', 'classifying', 10);

  const classifiedDocs = [];
  const documentTypeMap = {};

  for (let i = 0; i < parsedDocs.length; i++) {
    const doc = parsedDocs[i];
    const stageProgress = ((i + 1) / parsedDocs.length) * 100;
    reportProgress(onProgress, completedStages, 'classifying', stageProgress, `Classifying ${doc.filename}`);

    try {
      const classification = await classifyDocument(doc.parsed);
      classifiedDocs.push({ ...doc, classification });
      documentTypeMap[doc.filename] = classification.document_type;

      // Store classification in deal_documents if record exists
      try {
        db.run(
          `UPDATE deal_documents SET
            document_type = ?,
            classification_confidence = ?,
            classification_reasoning = ?,
            extraction_status = 'classified'
          WHERE deal_id = ? AND filename = ?`,
          classification.document_type,
          classification.confidence,
          classification.reasoning,
          dealId,
          doc.filename,
        );
      } catch {
        // Non-critical
      }
    } catch (err) {
      errors.push(`Failed to classify ${doc.filename}: ${err.message}`);
      // Still include the doc with a fallback classification
      classifiedDocs.push({
        ...doc,
        classification: {
          document_type: 'narrative_memo',
          confidence: 0,
          extraction_priority: 'low',
          fiscal_periods_referenced: [],
          company_name: null,
          language: 'en',
          reasoning: `Classification failed: ${err.message}`,
        },
      });
      documentTypeMap[doc.filename] = 'narrative_memo';
    }
  }

  completedStages.add('classifying');

  // ---------------------------------------------------------------------------
  // Stage 3: Extract financials (parallelized across extractable docs)
  // ---------------------------------------------------------------------------
  const extractableDocs = classifiedDocs.filter(
    (d) => d.classification.extraction_priority === 'high' || d.classification.extraction_priority === 'medium',
  );

  reportProgress(onProgress, completedStages, 'extracting', 0, `Extracting from ${extractableDocs.length} document(s)`);
  updateJobStatus(db, jobId, 'running', 'extracting', 20);

  const extractions = [];

  if (extractableDocs.length === 0) {
    errors.push('No documents with extractable financial data found.');
  } else {
    // Run extractions in parallel
    const extractionPromises = extractableDocs.map(async (doc, i) => {
      try {
        const extraction = await extractFinancials(doc.parsed, doc.classification);

        // Report progress as each extraction completes
        const stageProgress = ((i + 1) / extractableDocs.length) * 100;
        reportProgress(onProgress, completedStages, 'extracting', stageProgress, `Extracted ${doc.filename}`);

        return { extraction, sourceFile: doc.filename };
      } catch (err) {
        errors.push(`Failed to extract from ${doc.filename}: ${err.message}`);
        return null;
      }
    });

    const results = await Promise.all(extractionPromises);
    for (const result of results) {
      if (result) extractions.push(result);
    }
  }

  if (extractions.length === 0) {
    updateJobStatus(db, jobId, 'failed', 'extracting', 55, 'No financial data could be extracted');
    return {
      status: 'failed',
      loadedFinancials: null,
      classification: null,
      selectedComps: null,
      qualityReport: null,
      errors: [...errors, 'No financial data could be extracted from any document.'],
    };
  }

  completedStages.add('extracting');

  // ---------------------------------------------------------------------------
  // Stage 4: Reconcile across all extractions
  // ---------------------------------------------------------------------------
  reportProgress(onProgress, completedStages, 'reconciling', 0, 'Reconciling data across documents');
  updateJobStatus(db, jobId, 'running', 'reconciling', 55);

  let reconciled;

  try {
    reconciled = await reconcileExtractions(extractions, documentTypeMap);
    reportProgress(onProgress, completedStages, 'reconciling', 100, `${reconciled.conflicts.length} conflict(s) resolved`);
  } catch (err) {
    errors.push(`Reconciliation failed: ${err.message}`);
    // Fallback: use the first extraction's data directly
    const fallback = extractions[0].extraction;
    reconciled = {
      conflicts: [],
      resolved_values: Object.fromEntries(
        (fallback.periods || []).map((p) => [p.year, p.fields]),
      ),
      explanations: [],
    };
  }

  completedStages.add('reconciling');

  // ---------------------------------------------------------------------------
  // Stage 5: Sector classification & comps selection
  // ---------------------------------------------------------------------------
  reportProgress(onProgress, completedStages, 'sector', 0, 'Classifying sector');
  updateJobStatus(db, jobId, 'running', 'sector', 65);

  let sectorResult = null;

  try {
    // Build a profile from the first extraction (company name, currency, etc.)
    // plus resolved values
    const primaryExtraction = extractions[0].extraction;
    const profile = {
      company_name: primaryExtraction.company_name,
      currency: primaryExtraction.currency,
      unit: primaryExtraction.unit,
      periods: Object.entries(reconciled.resolved_values).map(([year, fields]) => ({
        year,
        fields,
      })),
    };

    // Fetch available comps and transactions from DB
    const allComps = db.all('SELECT * FROM comparable_companies');
    const allTransactions = db.all('SELECT * FROM comparable_transactions');

    sectorResult = await classifyAndSelectComps(profile, allComps, allTransactions);
    reportProgress(onProgress, completedStages, 'sector', 100, `Sector: ${sectorResult.classification?.primary_sector}`);
  } catch (err) {
    errors.push(`Sector classification failed: ${err.message}`);
    sectorResult = {
      classification: { primary_sector: 'Unknown' },
      selected_comps: [],
      selected_transactions: [],
      rejected_with_reasons: [],
    };
  }

  completedStages.add('sector');

  // ---------------------------------------------------------------------------
  // Stage 6: Quality check
  // ---------------------------------------------------------------------------
  reportProgress(onProgress, completedStages, 'quality', 0, 'Running quality checks');
  updateJobStatus(db, jobId, 'running', 'quality', 80);

  let qualityReport;

  try {
    qualityReport = await checkQuality(reconciled, sectorResult?.classification, extractions);
    reportProgress(onProgress, completedStages, 'quality', 100, `Quality score: ${qualityReport.score}/100`);
  } catch (err) {
    errors.push(`Quality check failed: ${err.message}`);
    qualityReport = {
      passed: false,
      score: 0,
      issues: [{ severity: 'error', field: '_system', message: `Quality check error: ${err.message}` }],
      summary: 'Quality check could not be completed due to an error.',
    };
  }

  completedStages.add('quality');

  // ---------------------------------------------------------------------------
  // Stage 7: Load into database (only if quality passes)
  // ---------------------------------------------------------------------------
  reportProgress(onProgress, completedStages, 'loading', 0, 'Preparing to load data');
  updateJobStatus(db, jobId, 'running', 'loading', 90);

  let loadResult = null;

  if (qualityReport.passed) {
    try {
      loadResult = await loadExtractedData(db, dealId, reconciled, sectorResult, jobId);
      reportProgress(onProgress, completedStages, 'loading', 100, `Loaded ${loadResult.inserted} records`);
    } catch (err) {
      errors.push(`Data loading failed: ${err.message}`);
      updateJobStatus(db, jobId, 'failed', 'loading', 95, err.message);
    }
  } else {
    // Quality failed — pause the pipeline for human review
    const failReason = `Quality check failed (score: ${qualityReport.score}/100). ${qualityReport.issues.filter((i) => i.severity === 'error').length} error(s) found.`;
    errors.push(failReason);
    updateJobStatus(db, jobId, 'paused', 'quality_review', 90, failReason);

    // Store pipeline state so it can be resumed after review
    try {
      db.run(
        `UPDATE extraction_jobs SET pipeline_state = ? WHERE id = ?`,
        JSON.stringify({
          reconciled,
          sectorResult,
          qualityReport,
          extractions: extractions.map((e) => ({
            sourceFile: e.sourceFile,
            extraction: e.extraction,
          })),
        }),
        jobId,
      );
    } catch {
      // Non-critical
    }

    // Create an HITL review row so it shows up in the Reviews page
    try {
      db.run(
        `INSERT INTO hitl_reviews (entity_type, entity_id, tier, notes, decision)
         VALUES ('extraction_job', ?, 2, ?, NULL)`,
        String(jobId),
        `Quality score ${qualityReport.score}/100. Issues: ${(qualityReport.issues || []).map((i) => i.message).slice(0, 3).join('; ')}`,
      );
    } catch {
      // Non-critical
    }
  }

  completedStages.add('loading');

  // ---------------------------------------------------------------------------
  // Final result
  // ---------------------------------------------------------------------------
  const status = loadResult
    ? 'completed'
    : qualityReport.passed
      ? 'failed'
      : 'paused_for_review';

  reportProgress(onProgress, completedStages, 'loading', 100, `Pipeline ${status}`);

  return {
    status,
    loadedFinancials: loadResult,
    classification: sectorResult,
    selectedComps: sectorResult
      ? {
          comps: sectorResult.selected_comps,
          transactions: sectorResult.selected_transactions,
        }
      : null,
    qualityReport,
    errors,
  };
}
