import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA } from '../schema.js';
import { seedDatabase } from '../seed.js';
import { auditLog } from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// GET /health
router.get('/health', (req, res) => {
  try {
    req.db.get('SELECT 1 as ok');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', timestamp: new Date().toISOString(), details: err.message });
  }
});

// GET /counts — row counts for all tables (fixed table names)
router.get('/counts', (req, res) => {
  try {
    const tables = [
      'deal_pipeline',
      'target_company_financials',
      'comparable_companies',
      'comparable_transactions',
      'valuation_assumptions',
      'model_outputs',
      'model_runs',
      'deal_documents',
      'extraction_jobs',
      'hitl_reviews',
      'scenario_definitions',
      'chat_conversations',
      'chat_messages',
      'audit_log'
    ];

    const counts = {};
    for (const table of tables) {
      try {
        const row = req.db.get(`SELECT COUNT(*) as count FROM ${table}`);
        counts[table] = row ? row.count : 0;
      } catch {
        counts[table] = null;
      }
    }

    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch counts', details: err.message });
  }
});

// GET /schemas — column info for all data tables (for upload mapping)
router.get('/schemas', (req, res) => {
  try {
    const tables = {
      deal_pipeline: {
        label: 'Deals',
        columns: [
          { name: 'deal_id', type: 'text', required: true, description: 'Unique deal identifier (e.g., DEAL-007)' },
          { name: 'deal_name', type: 'text', required: true, description: 'Project code name' },
          { name: 'stage', type: 'enum', required: true, options: ['screening','due_diligence','negotiation','closed','passed'], description: 'Deal stage' },
          { name: 'sector', type: 'text', description: 'Industry sector' },
          { name: 'target_company', type: 'text', description: 'Target company name' },
          { name: 'deal_size_estimate', type: 'number', description: 'Estimated deal size ($M)' },
          { name: 'lead_analyst', type: 'text', description: 'Lead analyst name' },
          { name: 'date_entered', type: 'date', description: 'Date deal entered pipeline' },
          { name: 'expected_close', type: 'date', description: 'Expected close date' },
          { name: 'status_notes', type: 'text', description: 'Current status notes' }
        ]
      },
      target_company_financials: {
        label: 'Target Financials',
        columns: [
          { name: 'deal_id', type: 'text', description: 'Associated deal ID' },
          { name: 'company_name', type: 'text', required: true, description: 'Company name' },
          { name: 'period', type: 'text', required: true, description: 'Fiscal period (e.g., FY2023)' },
          { name: 'revenue', type: 'number', description: 'Revenue ($M)' },
          { name: 'revenue_growth_pct', type: 'number', description: 'Revenue growth (%)' },
          { name: 'gross_profit', type: 'number', description: 'Gross profit ($M)' },
          { name: 'gross_margin_pct', type: 'number', description: 'Gross margin (%)' },
          { name: 'ebitda', type: 'number', description: 'EBITDA ($M)' },
          { name: 'ebitda_margin_pct', type: 'number', description: 'EBITDA margin (%)' },
          { name: 'net_income', type: 'number', description: 'Net income ($M)' },
          { name: 'total_assets', type: 'number', description: 'Total assets ($M)' },
          { name: 'total_debt', type: 'number', description: 'Total debt ($M)' },
          { name: 'free_cash_flow', type: 'number', description: 'Free cash flow ($M)' },
          { name: 'employees', type: 'integer', description: 'Number of employees' },
          { name: 'currency', type: 'text', description: 'Currency (default: USD)' }
        ]
      },
      comparable_companies: {
        label: 'Comparable Companies',
        columns: [
          { name: 'company_name', type: 'text', required: true, description: 'Company name' },
          { name: 'ticker', type: 'text', description: 'Stock ticker' },
          { name: 'sector', type: 'text', description: 'Industry sector' },
          { name: 'ev_ebitda', type: 'number', description: 'EV/EBITDA multiple' },
          { name: 'ev_revenue', type: 'number', description: 'EV/Revenue multiple' },
          { name: 'pe_ratio', type: 'number', description: 'P/E ratio' },
          { name: 'revenue_growth_pct', type: 'number', description: 'Revenue growth (%)' },
          { name: 'ebitda_margin_pct', type: 'number', description: 'EBITDA margin (%)' },
          { name: 'market_cap', type: 'number', description: 'Market cap ($M)' },
          { name: 'as_of_date', type: 'date', description: 'Data as-of date' }
        ]
      },
      comparable_transactions: {
        label: 'Precedent Transactions',
        columns: [
          { name: 'transaction_name', type: 'text', required: true, description: 'Transaction name (e.g., Acquirer / Target)' },
          { name: 'announcement_date', type: 'date', description: 'Announcement date' },
          { name: 'close_date', type: 'date', description: 'Close date' },
          { name: 'acquirer', type: 'text', description: 'Acquirer name' },
          { name: 'target', type: 'text', description: 'Target company name' },
          { name: 'sector', type: 'text', description: 'Industry sector' },
          { name: 'deal_value', type: 'number', description: 'Deal value ($M)' },
          { name: 'ev_ebitda', type: 'number', description: 'EV/EBITDA multiple' },
          { name: 'ev_revenue', type: 'number', description: 'EV/Revenue multiple' },
          { name: 'premium_pct', type: 'number', description: 'Acquisition premium (%)' }
        ]
      },
      valuation_assumptions: {
        label: 'Valuation Assumptions',
        columns: [
          { name: 'deal_id', type: 'text', required: true, description: 'Associated deal ID' },
          { name: 'assumption_name', type: 'text', required: true, description: 'Assumption name' },
          { name: 'base_case', type: 'number', description: 'Base case value' },
          { name: 'upside_case', type: 'number', description: 'Upside case value' },
          { name: 'downside_case', type: 'number', description: 'Downside case value' },
          { name: 'unit', type: 'text', description: 'Unit (%, x, $M)' },
          { name: 'source_rationale', type: 'text', description: 'Rationale for assumption' }
        ]
      },
      model_outputs: {
        label: 'Model Outputs',
        columns: [
          { name: 'deal_id', type: 'text', required: true, description: 'Associated deal ID' },
          { name: 'scenario', type: 'enum', required: true, options: ['base','upside','downside'], description: 'Scenario type' },
          { name: 'metric_name', type: 'text', required: true, description: 'Metric name' },
          { name: 'metric_value', type: 'number', description: 'Metric value' },
          { name: 'unit', type: 'text', description: 'Unit ($M, %, x)' },
          { name: 'calculation_method', type: 'text', description: 'Calculation method used' },
          { name: 'confidence_score', type: 'number', description: 'Confidence (0-1)' }
        ]
      }
    };
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schemas', details: err.message });
  }
});

// POST /meta/reset-demo — wipe all tables and re-seed the sample data
router.post('/reset-demo', (req, res) => {
  try {
    const tables = [
      'audit_log',
      'chat_messages',
      'chat_conversations',
      'scenario_definitions',
      'hitl_reviews',
      'model_runs',
      'model_outputs',
      'extraction_jobs',
      'deal_documents',
      'valuation_assumptions',
      'comparable_transactions',
      'comparable_companies',
      'target_company_financials',
      'deal_pipeline',
    ];

    req.db.transaction(() => {
      for (const t of tables) {
        try { req.db.run(`DELETE FROM ${t}`); } catch {}
      }
    });

    // Clear uploaded storage files (per-deal folders)
    try {
      const storageDir = path.join(__dirname, '..', 'storage');
      if (fs.existsSync(storageDir)) {
        for (const entry of fs.readdirSync(storageDir)) {
          const full = path.join(storageDir, entry);
          try {
            fs.rmSync(full, { recursive: true, force: true });
          } catch {}
        }
      }
    } catch {}

    // Re-seed
    req.db.exec(SCHEMA);
    seedDatabase(req.db);

    auditLog(req.db, 'demo.reset', 'system', 'all', 'user', {});
    res.json({ success: true, message: 'Demo data reset to seeded state' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed', details: err.message });
  }
});

export default router;
