import { Router } from 'express';
import { auditLog } from '../database.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { deal_id } = req.query;
    let sql = 'SELECT * FROM valuation_assumptions';
    const params = [];
    if (deal_id) { sql += ' WHERE deal_id = ?'; params.push(deal_id); }
    sql += ' ORDER BY assumption_id';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assumptions', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM valuation_assumptions WHERE assumption_id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body;
    if (!b.deal_id || !b.assumption_name) return res.status(400).json({ error: 'deal_id and assumption_name required' });
    req.db.run(
      `INSERT INTO valuation_assumptions (deal_id,assumption_name,base_case,upside_case,downside_case,unit,source_rationale,data_source) VALUES (?,?,?,?,?,?,?,'manual')`,
      b.deal_id, b.assumption_name, b.base_case, b.upside_case, b.downside_case, b.unit, b.source_rationale
    );
    const created = req.db.get('SELECT * FROM valuation_assumptions ORDER BY assumption_id DESC LIMIT 1');
    auditLog(req.db, 'assumption.created', 'valuation_assumptions', created?.assumption_id, 'user', { deal_id: b.deal_id, assumption_name: b.assumption_name });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create', details: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM valuation_assumptions WHERE assumption_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const allowed = ['deal_id','assumption_name','base_case','upside_case','downside_case','unit','source_rationale'];
    const updates = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = updates.map(f => `${f} = ?`).join(', ');
    const vals = updates.map(f => req.body[f]);
    req.db.run(`UPDATE valuation_assumptions SET ${sets}, updated_at = datetime('now') WHERE assumption_id = ?`, ...vals, req.params.id);
    auditLog(req.db, 'assumption.updated', 'valuation_assumptions', req.params.id, 'user', req.body);
    res.json(req.db.get('SELECT * FROM valuation_assumptions WHERE assumption_id = ?', req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update', details: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM valuation_assumptions WHERE assumption_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    req.db.run('DELETE FROM valuation_assumptions WHERE assumption_id = ?', req.params.id);
    auditLog(req.db, 'assumption.deleted', 'valuation_assumptions', req.params.id, 'user', {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

export default router;
