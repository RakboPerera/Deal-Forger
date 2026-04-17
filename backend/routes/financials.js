import { Router } from 'express';
import { auditLog } from '../database.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { company, deal_id } = req.query;
    let sql = 'SELECT * FROM target_company_financials';
    const conds = [], params = [];
    if (company) { conds.push('company_name = ?'); params.push(company); }
    if (deal_id) { conds.push('deal_id = ?'); params.push(deal_id); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY company_name, period';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch financials', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM target_company_financials WHERE record_id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body;
    if (!b.company_name || !b.period) return res.status(400).json({ error: 'company_name and period required' });
    req.db.run(
      `INSERT INTO target_company_financials (deal_id,company_name,period,revenue,revenue_growth_pct,gross_profit,gross_margin_pct,ebitda,ebitda_margin_pct,net_income,total_assets,total_debt,free_cash_flow,employees,currency,data_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manual')`,
      b.deal_id, b.company_name, b.period, b.revenue, b.revenue_growth_pct, b.gross_profit, b.gross_margin_pct, b.ebitda, b.ebitda_margin_pct, b.net_income, b.total_assets, b.total_debt, b.free_cash_flow, b.employees, b.currency || 'USD'
    );
    const created = req.db.get('SELECT * FROM target_company_financials ORDER BY record_id DESC LIMIT 1');
    auditLog(req.db, 'financial.created', 'target_company_financials', created?.record_id, 'user', { company_name: b.company_name, period: b.period });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create', details: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM target_company_financials WHERE record_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const allowed = ['deal_id','company_name','period','revenue','revenue_growth_pct','gross_profit','gross_margin_pct','ebitda','ebitda_margin_pct','net_income','total_assets','total_debt','free_cash_flow','employees','currency'];
    const updates = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = updates.map(f => `${f} = ?`).join(', ');
    const vals = updates.map(f => req.body[f]);
    req.db.run(`UPDATE target_company_financials SET ${sets}, updated_at = datetime('now') WHERE record_id = ?`, ...vals, req.params.id);
    auditLog(req.db, 'financial.updated', 'target_company_financials', req.params.id, 'user', req.body);
    res.json(req.db.get('SELECT * FROM target_company_financials WHERE record_id = ?', req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update', details: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM target_company_financials WHERE record_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    req.db.run('DELETE FROM target_company_financials WHERE record_id = ?', req.params.id);
    auditLog(req.db, 'financial.deleted', 'target_company_financials', req.params.id, 'user', {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

export default router;
