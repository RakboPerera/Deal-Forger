import { Router } from 'express';
import { auditLog } from '../database.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    let sql = 'SELECT * FROM hitl_reviews';
    const conds = [], params = [];
    if (entity_type) { conds.push('entity_type = ?'); params.push(entity_type); }
    if (entity_id) { conds.push('entity_id = ?'); params.push(entity_id); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM hitl_reviews WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body;
    if (!b.entity_type || !b.entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });
    req.db.run(
      `INSERT INTO hitl_reviews (entity_type, entity_id, tier, reviewer, decision, modifications_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      b.entity_type, b.entity_id, b.tier || 2, b.reviewer, b.decision, b.modifications_json ? JSON.stringify(b.modifications_json) : null, b.notes
    );
    const created = req.db.get('SELECT * FROM hitl_reviews ORDER BY id DESC LIMIT 1');
    auditLog(req.db, 'hitl.created', 'hitl_reviews', created?.id, 'user', { entity_type: b.entity_type, entity_id: b.entity_id });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create', details: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM hitl_reviews WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { decision, reviewer, modifications_json, notes } = req.body;
    req.db.run(
      `UPDATE hitl_reviews SET decision = ?, reviewer = ?, modifications_json = ?, notes = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE approved_at END WHERE id = ?`,
      decision || existing.decision, reviewer || existing.reviewer, modifications_json ? JSON.stringify(modifications_json) : existing.modifications_json, notes || existing.notes, decision, req.params.id
    );
    auditLog(req.db, 'hitl.updated', 'hitl_reviews', req.params.id, reviewer || 'user', { decision });
    res.json(req.db.get('SELECT * FROM hitl_reviews WHERE id = ?', req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update', details: err.message });
  }
});

export default router;
