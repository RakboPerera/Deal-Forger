import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { auditLog } from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: path.join(__dirname, '..', 'storage', 'imports'), limits: { fileSize: 20 * 1024 * 1024 } });

// Table column definitions for validation
const TABLE_CONFIGS = {
  deal_pipeline: {
    insertCols: ['deal_id','deal_name','stage','sector','target_company','deal_size_estimate','lead_analyst','date_entered','expected_close','status_notes'],
    required: ['deal_id', 'deal_name', 'stage'],
    idCol: 'deal_id'
  },
  target_company_financials: {
    insertCols: ['deal_id','company_name','period','revenue','revenue_growth_pct','gross_profit','gross_margin_pct','ebitda','ebitda_margin_pct','net_income','total_assets','total_debt','free_cash_flow','employees','currency'],
    required: ['company_name', 'period'],
    idCol: 'record_id'
  },
  comparable_companies: {
    insertCols: ['company_name','ticker','sector','ev_ebitda','ev_revenue','pe_ratio','revenue_growth_pct','ebitda_margin_pct','market_cap','as_of_date'],
    required: ['company_name'],
    idCol: 'record_id'
  },
  comparable_transactions: {
    insertCols: ['transaction_name','announcement_date','close_date','acquirer','target','sector','deal_value','ev_ebitda','ev_revenue','premium_pct'],
    required: ['transaction_name'],
    idCol: 'record_id'
  },
  valuation_assumptions: {
    insertCols: ['deal_id','assumption_name','base_case','upside_case','downside_case','unit','source_rationale'],
    required: ['deal_id', 'assumption_name'],
    idCol: 'assumption_id'
  },
  model_outputs: {
    insertCols: ['deal_id','scenario','metric_name','metric_value','unit','calculation_method','confidence_score'],
    required: ['deal_id', 'scenario', 'metric_name'],
    idCol: 'output_id'
  }
};

const router = Router();

// POST /import/:table — import data from CSV or JSON file
router.post('/:table', upload.single('file'), async (req, res) => {
  const { table } = req.params;
  const config = TABLE_CONFIGS[table];

  if (!config) {
    return res.status(400).json({ error: `Unknown table: ${table}. Valid tables: ${Object.keys(TABLE_CONFIGS).join(', ')}` });
  }

  try {
    let rows;

    if (req.file) {
      // File upload — parse CSV or JSON
      const content = fs.readFileSync(req.file.path, 'utf-8');
      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === '.json') {
        const parsed = JSON.parse(content);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else if (ext === '.csv' || ext === '.tsv') {
        const Papa = await import('papaparse');
        const result = Papa.default.parse(content, { header: true, skipEmptyLines: true, dynamicTyping: true });
        rows = result.data;
      } else if (ext === '.xlsx' || ext === '.xls') {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(fs.readFileSync(req.file.path), { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet);
      } else {
        return res.status(400).json({ error: `Unsupported file format: ${ext}. Use .csv, .json, or .xlsx` });
      }

      // Clean up temp file
      fs.unlinkSync(req.file.path);
    } else if (req.body.rows) {
      // JSON body with rows array
      rows = Array.isArray(req.body.rows) ? req.body.rows : [req.body.rows];
    } else {
      return res.status(400).json({ error: 'Provide a file upload or JSON body with "rows" array' });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No data rows found' });
    }

    // Validate and insert
    const results = { inserted: 0, errors: [], skipped: 0 };

    // Normalize column names (lowercase, trim, replace spaces with underscores)
    rows = rows.map(row => {
      const normalized = {};
      for (const [key, val] of Object.entries(row)) {
        const col = key.toLowerCase().trim().replace(/\s+/g, '_');
        normalized[col] = val;
      }
      return normalized;
    });

    const placeholders = config.insertCols.map(() => '?').join(',');
    const sql = `INSERT INTO ${table} (${config.insertCols.join(',')}, data_source, is_dummy) VALUES (${placeholders}, 'user_upload', 0)`;

    req.db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Check required fields
        const missing = config.required.filter(col => !row[col] && row[col] !== 0);
        if (missing.length > 0) {
          results.errors.push({ row: i + 1, error: `Missing required fields: ${missing.join(', ')}` });
          results.skipped++;
          continue;
        }

        try {
          const values = config.insertCols.map(col => {
            const val = row[col];
            if (val === undefined || val === null || val === '') return null;
            return val;
          });

          req.db.run(sql, ...values);
          results.inserted++;
        } catch (err) {
          results.errors.push({ row: i + 1, error: err.message });
          results.skipped++;
        }
      }
    });

    auditLog(req.db, 'data.import', table, null, 'user', {
      table, totalRows: rows.length, inserted: results.inserted, skipped: results.skipped
    });

    res.json({
      success: true,
      table,
      totalRows: rows.length,
      ...results
    });
  } catch (err) {
    res.status(500).json({ error: 'Import failed', details: err.message });
  }
});

// DELETE /import/:table/sample — delete all sample data from a table
router.delete('/:table/sample', (req, res) => {
  const { table } = req.params;
  if (!TABLE_CONFIGS[table]) {
    return res.status(400).json({ error: `Unknown table: ${table}` });
  }

  try {
    const result = req.db.run(`DELETE FROM ${table} WHERE is_dummy = 1 OR data_source = 'sample'`);
    auditLog(req.db, 'data.clear_sample', table, null, 'user', { rowsDeleted: result.changes });
    res.json({ success: true, rowsDeleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear sample data', details: err.message });
  }
});

// GET /import/:table/template — download a CSV template for a table
router.get('/:table/template', (req, res) => {
  const { table } = req.params;
  const config = TABLE_CONFIGS[table];
  if (!config) {
    return res.status(400).json({ error: `Unknown table: ${table}` });
  }

  const header = config.insertCols.join(',');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${table}_template.csv`);
  res.send(header + '\n');
});

export default router;
