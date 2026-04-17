import { Router } from 'express';
import { auditLog } from '../database.js';

const router = Router();

// GET / — list all deals
router.get('/', (req, res) => {
  try {
    const { stage, sector } = req.query;
    let sql = 'SELECT * FROM deal_pipeline';
    const conditions = [];
    const params = [];

    if (stage) { conditions.push('stage = ?'); params.push(stage); }
    if (sector) { conditions.push('sector = ?'); params.push(sector); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY date_entered DESC';

    const rows = req.db.all(sql, ...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deals', details: err.message });
  }
});

// GET /:id — single deal
router.get('/:id', (req, res) => {
  try {
    const deal = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    res.json(deal);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deal', details: err.message });
  }
});

// GET /:id/full — deal + all related data
router.get('/:id/full', (req, res) => {
  try {
    const deal = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    deal.financials = req.db.all('SELECT * FROM target_company_financials WHERE deal_id = ? ORDER BY period', req.params.id);
    deal.assumptions = req.db.all('SELECT * FROM valuation_assumptions WHERE deal_id = ?', req.params.id);
    deal.outputs = req.db.all('SELECT * FROM model_outputs WHERE deal_id = ?', req.params.id);
    deal.documents = req.db.all('SELECT * FROM deal_documents WHERE deal_id = ?', req.params.id);
    deal.model_runs = req.db.all('SELECT * FROM model_runs WHERE deal_id = ? ORDER BY created_at DESC', req.params.id);
    deal.scenarios = req.db.all('SELECT * FROM scenario_definitions WHERE deal_id = ?', req.params.id);

    // Sector-matched comps & precedent transactions used for this deal's model
    deal.comps = deal.sector
      ? req.db.all('SELECT * FROM comparable_companies WHERE sector = ?', deal.sector)
      : [];
    deal.transactions = deal.sector
      ? req.db.all('SELECT * FROM comparable_transactions WHERE sector = ?', deal.sector)
      : [];

    res.json(deal);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deal details', details: err.message });
  }
});

// GET /:id/timeline — audit log events for this deal
router.get('/:id/timeline', (req, res) => {
  try {
    const id = req.params.id;
    // Events directly on this deal, plus events on related extraction/model_run ids
    const extractionRows = req.db.all(
      "SELECT id FROM extraction_jobs WHERE deal_id = ?", id
    ).map(r => String(r.id));
    const runRows = req.db.all(
      "SELECT id FROM model_runs WHERE deal_id = ?", id
    ).map(r => String(r.id));

    const placeholders = [
      "(entity_type = 'deal_pipeline' AND entity_id = ?)",
      "(entity_type = 'deal' AND entity_id = ?)",
      "(entity_type = 'deal_documents' AND entity_id = ?)",
    ];
    const params = [id, id, id];
    if (extractionRows.length) {
      placeholders.push(`(entity_type = 'extraction_jobs' AND entity_id IN (${extractionRows.map(() => '?').join(',')}))`);
      params.push(...extractionRows);
    }
    if (runRows.length) {
      placeholders.push(`(entity_type = 'model_runs' AND entity_id IN (${runRows.map(() => '?').join(',')}))`);
      params.push(...runRows);
    }

    const events = req.db.all(
      `SELECT * FROM audit_log WHERE ${placeholders.join(' OR ')} ORDER BY timestamp DESC LIMIT 100`,
      ...params
    );

    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch timeline', details: err.message });
  }
});

// POST / — create deal
router.post('/', (req, res) => {
  try {
    const { deal_name, stage, sector, target_company, deal_size_estimate, lead_analyst, date_entered, expected_close, status_notes } = req.body;
    if (!deal_name) return res.status(400).json({ error: 'deal_name is required' });

    const maxRow = req.db.get("SELECT deal_id FROM deal_pipeline ORDER BY deal_id DESC LIMIT 1");
    const lastNum = maxRow ? parseInt(maxRow.deal_id.replace('DEAL-', ''), 10) || 0 : 0;
    const deal_id = `DEAL-${String(lastNum + 1).padStart(3, '0')}`;

    // sql.js bind() refuses `undefined` — coerce to null for optional fields.
    const nn = (v) => (v === undefined || v === '' ? null : v);
    const sizeVal = (deal_size_estimate === undefined || deal_size_estimate === '' || deal_size_estimate === null)
      ? null
      : Number(deal_size_estimate);

    req.db.run(
      `INSERT INTO deal_pipeline (deal_id, deal_name, stage, sector, target_company, deal_size_estimate, lead_analyst, date_entered, expected_close, status_notes, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
      deal_id,
      deal_name,
      nn(stage) || 'screening',
      nn(sector),
      nn(target_company),
      sizeVal,
      nn(lead_analyst),
      nn(date_entered) || new Date().toISOString().split('T')[0],
      nn(expected_close),
      nn(status_notes),
    );

    auditLog(req.db, 'deal.created', 'deal_pipeline', deal_id, 'user', { deal_name, sector });
    const created = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', deal_id);
    res.status(201).json(created);
  } catch (err) {
    console.error('POST /deals failed:', err);
    res.status(500).json({ error: 'Failed to create deal', details: err.message || String(err) });
  }
});

// PUT /:id — update deal
router.put('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Deal not found' });

    const allowed = ['deal_name','stage','sector','target_company','deal_size_estimate','lead_analyst','expected_close','status_notes'];
    const updates = Object.keys(req.body).filter(k => allowed.includes(k));
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const sets = updates.map(f => `${f} = ?`).join(', ');
    const values = updates.map(f => req.body[f]);
    req.db.run(`UPDATE deal_pipeline SET ${sets}, updated_at = datetime('now') WHERE deal_id = ?`, ...values, req.params.id);

    auditLog(req.db, 'deal.updated', 'deal_pipeline', req.params.id, 'user', req.body);
    const updated = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update deal', details: err.message });
  }
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Deal not found' });

    req.db.run('DELETE FROM deal_pipeline WHERE deal_id = ?', req.params.id);
    auditLog(req.db, 'deal.deleted', 'deal_pipeline', req.params.id, 'user', { deal_name: existing.deal_name });
    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete deal', details: err.message });
  }
});

export default router;
