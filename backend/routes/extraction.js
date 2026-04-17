import { Router } from 'express';
import { auditLog } from '../database.js';
import { createJob, getJob, runJob, updateJob } from '../jobs/queue.js';
import { runIntakePipeline } from '../agents/intake/pipeline.js';
import { generateAssumptionsForDeal } from '../agents/intake/assumptionGenerator.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { deal_id } = req.query;
    let sql = 'SELECT * FROM extraction_jobs';
    const params = [];
    if (deal_id) { sql += ' WHERE deal_id = ?'; params.push(deal_id); }
    sql += ' ORDER BY id DESC';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    // Accept either numeric DB id or memory-job id (e.g. "extraction-42")
    const raw = String(req.params.id);
    const numericId = raw.startsWith('extraction-') ? raw.split('-').pop() : raw;

    const memJob = getJob(`extraction-${numericId}`) || getJob(raw);
    const dbRow = req.db.get('SELECT * FROM extraction_jobs WHERE id = ?', numericId);

    if (!memJob && !dbRow) return res.status(404).json({ error: 'Job not found' });

    // Merge both so the frontend always gets the freshest fields
    const merged = {
      ...(dbRow || {}),
      // Normalize to the fields the frontend expects
      id: dbRow?.id ?? numericId,
      status: memJob?.status || dbRow?.status || 'pending',
      stage: memJob?.stage || dbRow?.stage || 'parsing',
      progress_pct: memJob?.progress ?? dbRow?.progress_pct ?? 0,
      progress: memJob?.progress ?? dbRow?.progress_pct ?? 0,
      message: memJob?.message || dbRow?.stage || '',
      error: memJob?.error || dbRow?.error_message || null,
      result: memJob?.result || null,
      extracted_data: memJob?.result?.extracted_data || null,
    };

    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/start/:dealId', async (req, res) => {
  try {
    const { dealId } = req.params;
    const deal = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    // Take pending OR failed docs — let user retry
    const docs = req.db.all(
      `SELECT * FROM deal_documents
       WHERE deal_id = ?
         AND (extraction_status = 'pending' OR extraction_status = 'failed' OR extraction_status IS NULL)`,
      dealId
    );
    if (docs.length === 0) {
      return res.status(400).json({ error: 'No documents pending extraction' });
    }

    // Create DB record (pipeline will update it as it runs)
    req.db.run(
      `INSERT INTO extraction_jobs (deal_id, status, stage, progress_pct, started_at, document_ids)
       VALUES (?, 'running', 'parsing', 0, datetime('now'), ?)`,
      dealId, JSON.stringify(docs.map(d => d.id))
    );
    const jobRow = req.db.get('SELECT * FROM extraction_jobs ORDER BY id DESC LIMIT 1');
    const jobId = jobRow.id;
    const memoryJobId = `extraction-${jobId}`;
    createJob(memoryJobId, { dealId, dbJobId: jobId });

    // Fire-and-forget — run the real pipeline
    runJob(memoryJobId, async (onProgress) => {
      // Mark docs as "processing"
      for (const d of docs) {
        req.db.run(
          "UPDATE deal_documents SET extraction_status = 'processing' WHERE id = ?",
          d.id
        );
      }

      const documentPaths = docs.map(d => ({
        filePath: d.file_path,
        filename: d.filename,
      }));

      // Wrap onProgress to also stash a human-readable message
      const progressCb = (pct, stage, details) => {
        onProgress(pct, stage);
        updateJob(memoryJobId, { message: details || stage });
      };

      let result;
      try {
        result = await runIntakePipeline(req.db, dealId, documentPaths, progressCb);
      } catch (err) {
        // Mark all docs as failed
        for (const d of docs) {
          req.db.run(
            "UPDATE deal_documents SET extraction_status = 'failed' WHERE id = ?",
            d.id
          );
        }
        req.db.run(
          "UPDATE extraction_jobs SET status = 'failed', error_message = ? WHERE id = ?",
          err.message, jobId
        );
        throw err;
      }

      // Update doc statuses based on pipeline result
      const finalDocStatus =
        result.status === 'completed' ? 'completed' :
        result.status === 'paused_for_review' ? 'needs_review' : 'failed';
      for (const d of docs) {
        req.db.run(
          "UPDATE deal_documents SET extraction_status = ? WHERE id = ?",
          finalDocStatus, d.id
        );
      }

      // Kick off auto-assumption-generation if we successfully loaded data
      if (result.status === 'completed') {
        try {
          const existingAssumptions = req.db.all(
            'SELECT assumption_id FROM valuation_assumptions WHERE deal_id = ?', dealId
          );
          if (existingAssumptions.length === 0) {
            await generateAssumptionsForDeal(req.db, dealId, result);
          }
        } catch (e) {
          // Non-fatal — user can still build model manually
          console.error('Auto-assumption generation failed:', e.message);
        }
      }

      auditLog(req.db, 'extraction.completed', 'extraction_jobs', jobId, 'agent', {
        deal_id: dealId,
        docs: docs.length,
        status: result.status,
        errors: result.errors?.length || 0,
      });

      // Surface extracted summary to the frontend review step
      const extractedSummary = {
        status: result.status,
        sector: result.classification?.classification?.primary_sector,
        periods: result.loadedFinancials
          ? { inserted: result.loadedFinancials.inserted, updated: result.loadedFinancials.updated }
          : null,
        qualityScore: result.qualityReport?.score,
        qualityIssues: result.qualityReport?.issues?.filter(i => i.severity === 'error').length || 0,
        selectedComps: result.selectedComps?.comps?.length || 0,
        selectedTransactions: result.selectedComps?.transactions?.length || 0,
        errors: result.errors || [],
      };

      return { success: result.status === 'completed', extracted_data: extractedSummary };
    }).catch(err => {
      req.db.run(
        "UPDATE extraction_jobs SET status = 'failed', error_message = ? WHERE id = ?",
        err.message, jobId
      );
      console.error('Extraction pipeline failed:', err);
    });

    res.json({
      success: true,
      jobId,
      job_id: jobId, // aliased for older clients
      memoryJobId,
      documentsQueued: docs.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start extraction', details: err.message });
  }
});

// Resume a paused job after HITL review
router.post('/:id/resume', async (req, res) => {
  try {
    const job = req.db.get('SELECT * FROM extraction_jobs WHERE id = ?', req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'paused') {
      return res.status(400).json({ error: `Job is ${job.status}, cannot resume` });
    }

    // Mark as re-running — actual resume would re-run loader stage
    req.db.run(
      "UPDATE extraction_jobs SET status = 'running', stage = 'loading' WHERE id = ?",
      req.params.id
    );

    // For demo completeness we just mark as completed if pipeline_state exists
    if (job.pipeline_state) {
      try {
        const state = JSON.parse(job.pipeline_state);
        // Defer to loader — reuse reconciled + sector result
        const { loadExtractedData } = await import('../agents/intake/loader.js');
        const loadResult = await loadExtractedData(
          req.db, job.deal_id, state.reconciled, state.sectorResult, req.params.id
        );
        req.db.run(
          "UPDATE extraction_jobs SET status = 'completed', progress_pct = 100, completed_at = datetime('now') WHERE id = ?",
          req.params.id
        );
        return res.json({ success: true, loaded: loadResult });
      } catch (e) {
        req.db.run(
          "UPDATE extraction_jobs SET status = 'failed', error_message = ? WHERE id = ?",
          e.message, req.params.id
        );
        return res.status(500).json({ error: 'Resume failed', details: e.message });
      }
    }

    res.json({ success: true, message: 'Job resumed (no state to apply)' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume', details: err.message });
  }
});

export default router;
