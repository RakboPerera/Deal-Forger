import { Router } from 'express';
import { auditLog } from '../database.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { sector } = req.query;
    let sql = 'SELECT * FROM comparable_transactions';
    const params = [];
    if (sector) { sql += ' WHERE sector = ?'; params.push(sector); }
    sql += ' ORDER BY announcement_date DESC';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM comparable_transactions WHERE record_id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body;
    if (!b.transaction_name) return res.status(400).json({ error: 'transaction_name required' });
    req.db.run(
      `INSERT INTO comparable_transactions (transaction_name,announcement_date,close_date,acquirer,target,sector,deal_value,ev_ebitda,ev_revenue,premium_pct,data_source) VALUES (?,?,?,?,?,?,?,?,?,?,'manual')`,
      b.transaction_name, b.announcement_date, b.close_date, b.acquirer, b.target, b.sector, b.deal_value, b.ev_ebitda, b.ev_revenue, b.premium_pct
    );
    const created = req.db.get('SELECT * FROM comparable_transactions ORDER BY record_id DESC LIMIT 1');
    auditLog(req.db, 'transaction.created', 'comparable_transactions', created?.record_id, 'user', { transaction_name: b.transaction_name });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create', details: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM comparable_transactions WHERE record_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const allowed = ['transaction_name','announcement_date','close_date','acquirer','target','sector','deal_value','ev_ebitda','ev_revenue','premium_pct'];
    const updates = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = updates.map(f => `${f} = ?`).join(', ');
    const vals = updates.map(f => req.body[f]);
    req.db.run(`UPDATE comparable_transactions SET ${sets}, updated_at = datetime('now') WHERE record_id = ?`, ...vals, req.params.id);
    auditLog(req.db, 'transaction.updated', 'comparable_transactions', req.params.id, 'user', req.body);
    res.json(req.db.get('SELECT * FROM comparable_transactions WHERE record_id = ?', req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update', details: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM comparable_transactions WHERE record_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    req.db.run('DELETE FROM comparable_transactions WHERE record_id = ?', req.params.id);
    auditLog(req.db, 'transaction.deleted', 'comparable_transactions', req.params.id, 'user', {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

export default router;
