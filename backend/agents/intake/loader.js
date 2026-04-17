// ---------------------------------------------------------------------------
// loader.js — Loader (Pure JS)
// ---------------------------------------------------------------------------
// Wraps all inserts in a database transaction. Inserts financial data,
// creates audit log entries, and updates extraction job status.
// ---------------------------------------------------------------------------

import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute derived metrics from raw fields.
 */
function computeDerived(fields) {
  const derived = {};

  if (fields.revenue && fields.gross_profit) {
    derived.gross_margin_pct = (fields.gross_profit / fields.revenue) * 100;
  }

  if (fields.revenue && fields.ebitda) {
    derived.ebitda_margin_pct = (fields.ebitda / fields.revenue) * 100;
  }

  return derived;
}

/**
 * Compute YoY revenue growth for each period given a sorted array of periods.
 */
function computeRevenueGrowth(periodEntries) {
  const sorted = [...periodEntries].sort((a, b) => (a.year > b.year ? 1 : -1));
  const growthMap = {};

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].fields?.revenue;
    const curr = sorted[i].fields?.revenue;
    if (prev && curr && prev !== 0) {
      growthMap[sorted[i].year] = ((curr - prev) / Math.abs(prev)) * 100;
    }
  }

  return growthMap;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load extracted and reconciled financial data into the database.
 *
 * @param {object} db - DatabaseWrapper instance (from database.js).
 * @param {string} dealId - Deal ID to associate data with.
 * @param {{ resolved_values: object, conflicts: Array }} reconciled - Reconciled data from reconciler.
 * @param {{ classification: object }} classification - Sector classification from sector.js.
 * @param {string|number} jobId - Extraction job ID to update.
 * @returns {{ inserted: number, updated: number, errors: string[] }}
 */
export async function loadExtractedData(db, dealId, reconciled, classification, jobId) {
  const resolvedValues = reconciled.resolved_values || reconciled;
  const errors = [];
  let inserted = 0;
  let updated = 0;

  // Get company name from the deal record
  const deal = db.get('SELECT target_company FROM deal_pipeline WHERE deal_id = ?', dealId);
  const companyName = deal?.target_company || classification?.classification?.company_name || 'Unknown';
  const currency = classification?.classification?.currency || 'USD';

  // Build period entries for growth calculation
  const periodEntries = Object.entries(resolvedValues).map(([year, fields]) => ({ year, fields }));
  const growthMap = computeRevenueGrowth(periodEntries);

  db.transaction(() => {
    // Insert/update financials for each period
    for (const [period, fields] of Object.entries(resolvedValues)) {
      const derived = computeDerived(fields);

      // Check if a record already exists for this deal + period
      const existing = db.get(
        'SELECT record_id FROM target_company_financials WHERE deal_id = ? AND period = ?',
        dealId,
        period,
      );

      if (existing) {
        // Update existing record
        db.run(
          `UPDATE target_company_financials SET
            company_name = ?,
            revenue = ?,
            revenue_growth_pct = ?,
            gross_profit = ?,
            gross_margin_pct = ?,
            ebitda = ?,
            ebitda_margin_pct = ?,
            net_income = ?,
            total_assets = ?,
            total_debt = ?,
            free_cash_flow = ?,
            employees = ?,
            currency = ?,
            data_source = ?,
            confidence = ?,
            updated_at = datetime('now')
          WHERE record_id = ?`,
          companyName,
          fields.revenue ?? null,
          growthMap[period] ?? fields.revenue_growth_pct ?? null,
          fields.gross_profit ?? null,
          derived.gross_margin_pct ?? null,
          fields.ebitda ?? null,
          derived.ebitda_margin_pct ?? null,
          fields.net_income ?? null,
          fields.total_assets ?? null,
          fields.total_debt ?? null,
          fields.free_cash_flow ?? null,
          fields.employees ?? null,
          currency,
          'extraction_pipeline',
          0.85, // Default confidence for pipeline-extracted data
          existing.record_id,
        );
        updated++;
      } else {
        // Insert new record
        db.run(
          `INSERT INTO target_company_financials (
            deal_id, company_name, period, revenue, revenue_growth_pct,
            gross_profit, gross_margin_pct, ebitda, ebitda_margin_pct,
            net_income, total_assets, total_debt, free_cash_flow,
            employees, currency, data_source, confidence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          dealId,
          companyName,
          period,
          fields.revenue ?? null,
          growthMap[period] ?? null,
          fields.gross_profit ?? null,
          derived.gross_margin_pct ?? null,
          fields.ebitda ?? null,
          derived.ebitda_margin_pct ?? null,
          fields.net_income ?? null,
          fields.total_assets ?? null,
          fields.total_debt ?? null,
          fields.free_cash_flow ?? null,
          fields.employees ?? null,
          currency,
          'extraction_pipeline',
          0.85,
        );
        inserted++;
      }
    }

    // Sector handling — be conservative. If the user already set a sector on
    // the deal, keep theirs and only stash the agent's suggestion in case they
    // want to review it later. Prior behaviour silently overwrote the user's
    // input with whatever the classifier produced, breaking comp-matching when
    // the two vocabularies diverged.
    if (classification?.classification?.primary_sector) {
      const existing = db.get('SELECT sector FROM deal_pipeline WHERE deal_id = ?', dealId);
      const userSetSector = existing?.sector && existing.sector !== 'Unknown' && existing.sector.trim() !== '';
      if (!userSetSector) {
        db.run(
          `UPDATE deal_pipeline SET sector = ?, updated_at = datetime('now') WHERE deal_id = ?`,
          classification.classification.primary_sector,
          dealId,
        );
      }
      // Either way, log the classifier's opinion in the audit log so the
      // Agent Trace panel can surface it.
      try {
        db.run(
          `INSERT INTO audit_log (timestamp, event_type, entity_type, entity_id, actor, details_json)
           VALUES (datetime('now'), 'sector.classified', 'deal_pipeline', ?, 'sector_agent', ?)`,
          dealId,
          JSON.stringify({
            agent_sector: classification.classification.primary_sector,
            user_sector: existing?.sector || null,
            overwrote_user: !userSetSector,
            sub_sector: classification.classification.sub_sector,
            coerced: classification.classification.sector_coerced || null,
            original_agent_guess: classification.classification.sector_original || null,
          }),
        );
      } catch { /* non-critical */ }
    }

    // Create audit log entry
    db.run(
      `INSERT INTO audit_log (timestamp, event_type, entity_type, entity_id, actor, details_json)
       VALUES (datetime('now'), ?, ?, ?, ?, ?)`,
      'extraction_loaded',
      'deal',
      dealId,
      'extraction_pipeline',
      JSON.stringify({
        periods: Object.keys(resolvedValues),
        fields_per_period: Object.fromEntries(
          Object.entries(resolvedValues).map(([p, f]) => [p, Object.keys(f)]),
        ),
        conflicts_resolved: (reconciled.conflicts || []).length,
        sector: classification?.classification?.primary_sector || null,
        inserted,
        updated,
      }),
    );

    // Update extraction job status to completed
    if (jobId) {
      db.run(
        `UPDATE extraction_jobs SET
          status = 'completed',
          stage = 'loaded',
          progress_pct = 100,
          completed_at = datetime('now')
        WHERE id = ?`,
        jobId,
      );
    }
  });

  return { inserted, updated, errors };
}
