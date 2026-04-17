import { Router } from 'express';
import { auditLog } from '../database.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { deal_id, scenario } = req.query;
    let sql = 'SELECT * FROM model_outputs';
    const conds = [], params = [];
    if (deal_id) { conds.push('deal_id = ?'); params.push(deal_id); }
    if (scenario) { conds.push('scenario = ?'); params.push(scenario); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY output_id';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch outputs', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM model_outputs WHERE output_id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body;
    if (!b.deal_id || !b.scenario || !b.metric_name) return res.status(400).json({ error: 'deal_id, scenario, metric_name required' });
    req.db.run(
      `INSERT INTO model_outputs (deal_id,scenario,metric_name,metric_value,unit,calculation_method,confidence_score,data_source) VALUES (?,?,?,?,?,?,?,'calculated')`,
      b.deal_id, b.scenario, b.metric_name, b.metric_value, b.unit, b.calculation_method, b.confidence_score
    );
    const created = req.db.get('SELECT * FROM model_outputs ORDER BY output_id DESC LIMIT 1');
    auditLog(req.db, 'output.created', 'model_outputs', created?.output_id, 'user', { deal_id: b.deal_id, metric_name: b.metric_name });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create', details: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM model_outputs WHERE output_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const allowed = ['deal_id','scenario','metric_name','metric_value','unit','calculation_method','confidence_score'];
    const updates = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = updates.map(f => `${f} = ?`).join(', ');
    const vals = updates.map(f => req.body[f]);
    req.db.run(`UPDATE model_outputs SET ${sets}, updated_at = datetime('now') WHERE output_id = ?`, ...vals, req.params.id);
    auditLog(req.db, 'output.updated', 'model_outputs', req.params.id, 'user', req.body);
    res.json(req.db.get('SELECT * FROM model_outputs WHERE output_id = ?', req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update', details: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM model_outputs WHERE output_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    req.db.run('DELETE FROM model_outputs WHERE output_id = ?', req.params.id);
    auditLog(req.db, 'output.deleted', 'model_outputs', req.params.id, 'user', {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

export default router;
