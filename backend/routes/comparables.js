import { Router } from 'express';
import { auditLog } from '../database.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { sector } = req.query;
    let sql = 'SELECT * FROM comparable_companies';
    const params = [];
    if (sector) { sql += ' WHERE sector = ?'; params.push(sector); }
    sql += ' ORDER BY market_cap DESC';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comparables', details: err.message });
  }
});

router.get('/sectors', (req, res) => {
  try {
    res.json(req.db.all('SELECT sector, COUNT(*) as count FROM comparable_companies GROUP BY sector ORDER BY count DESC'));
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM comparable_companies WHERE record_id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body;
    if (!b.company_name) return res.status(400).json({ error: 'company_name required' });
    req.db.run(
      `INSERT INTO comparable_companies (company_name,ticker,sector,ev_ebitda,ev_revenue,pe_ratio,revenue_growth_pct,ebitda_margin_pct,market_cap,as_of_date,data_source) VALUES (?,?,?,?,?,?,?,?,?,?,'manual')`,
      b.company_name, b.ticker, b.sector, b.ev_ebitda, b.ev_revenue, b.pe_ratio, b.revenue_growth_pct, b.ebitda_margin_pct, b.market_cap, b.as_of_date
    );
    const created = req.db.get('SELECT * FROM comparable_companies ORDER BY record_id DESC LIMIT 1');
    auditLog(req.db, 'comparable.created', 'comparable_companies', created?.record_id, 'user', { company_name: b.company_name });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create', details: err.message });
  }
});

router.post('/import', (req, res) => {
  try {
    const rows = req.body.rows || req.body;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Provide rows array' });
    let inserted = 0, errors = [];
    req.db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const b = rows[i];
        if (!b.company_name) { errors.push({ row: i + 1, error: 'Missing company_name' }); continue; }
        try {
          req.db.run(
            `INSERT INTO comparable_companies (company_name,ticker,sector,ev_ebitda,ev_revenue,pe_ratio,revenue_growth_pct,ebitda_margin_pct,market_cap,as_of_date,data_source) VALUES (?,?,?,?,?,?,?,?,?,?,'import')`,
            b.company_name, b.ticker, b.sector, b.ev_ebitda, b.ev_revenue, b.pe_ratio, b.revenue_growth_pct, b.ebitda_margin_pct, b.market_cap, b.as_of_date
          );
          inserted++;
        } catch (e) { errors.push({ row: i + 1, error: e.message }); }
      }
    });
    auditLog(req.db, 'comparable.bulk_import', 'comparable_companies', null, 'user', { inserted, errors: errors.length });
    res.json({ success: true, inserted, errors });
  } catch (err) {
    res.status(500).json({ error: 'Import failed', details: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM comparable_companies WHERE record_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const allowed = ['company_name','ticker','sector','ev_ebitda','ev_revenue','pe_ratio','revenue_growth_pct','ebitda_margin_pct','market_cap','as_of_date'];
    const updates = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = updates.map(f => `${f} = ?`).join(', ');
    const vals = updates.map(f => req.body[f]);
    req.db.run(`UPDATE comparable_companies SET ${sets}, updated_at = datetime('now') WHERE record_id = ?`, ...vals, req.params.id);
    auditLog(req.db, 'comparable.updated', 'comparable_companies', req.params.id, 'user', req.body);
    res.json(req.db.get('SELECT * FROM comparable_companies WHERE record_id = ?', req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update', details: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = req.db.get('SELECT * FROM comparable_companies WHERE record_id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    req.db.run('DELETE FROM comparable_companies WHERE record_id = ?', req.params.id);
    auditLog(req.db, 'comparable.deleted', 'comparable_companies', req.params.id, 'user', {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

export default router;
