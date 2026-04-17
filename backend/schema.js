export const SCHEMA = `
-- Core Deal Tables

CREATE TABLE IF NOT EXISTS deal_pipeline (
  deal_id TEXT PRIMARY KEY,
  deal_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'screening' CHECK(stage IN ('screening','due_diligence','negotiation','closed','passed')),
  sector TEXT,
  target_company TEXT,
  deal_size_estimate REAL,
  lead_analyst TEXT,
  date_entered TEXT DEFAULT (date('now')),
  expected_close TEXT,
  status_notes TEXT,
  data_source TEXT DEFAULT 'manual',
  is_dummy INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS target_company_financials (
  record_id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT,
  company_name TEXT NOT NULL,
  period TEXT NOT NULL,
  revenue REAL,
  revenue_growth_pct REAL,
  gross_profit REAL,
  gross_margin_pct REAL,
  ebitda REAL,
  ebitda_margin_pct REAL,
  net_income REAL,
  total_assets REAL,
  total_debt REAL,
  free_cash_flow REAL,
  employees INTEGER,
  currency TEXT DEFAULT 'USD',
  data_source TEXT DEFAULT 'manual',
  confidence REAL DEFAULT 1.0,
  is_dummy INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id)
);

CREATE TABLE IF NOT EXISTS comparable_companies (
  record_id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  ticker TEXT,
  sector TEXT,
  ev_ebitda REAL,
  ev_revenue REAL,
  pe_ratio REAL,
  revenue_growth_pct REAL,
  ebitda_margin_pct REAL,
  market_cap REAL,
  as_of_date TEXT,
  data_source TEXT DEFAULT 'manual',
  is_dummy INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comparable_transactions (
  record_id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_name TEXT NOT NULL,
  announcement_date TEXT,
  close_date TEXT,
  acquirer TEXT,
  target TEXT,
  sector TEXT,
  deal_value REAL,
  ev_ebitda REAL,
  ev_revenue REAL,
  premium_pct REAL,
  data_source TEXT DEFAULT 'manual',
  is_dummy INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS valuation_assumptions (
  assumption_id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL,
  assumption_name TEXT NOT NULL,
  base_case REAL,
  upside_case REAL,
  downside_case REAL,
  unit TEXT,
  source_rationale TEXT,
  data_source TEXT DEFAULT 'agent',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id)
);

CREATE TABLE IF NOT EXISTS model_outputs (
  output_id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL,
  scenario TEXT NOT NULL CHECK(scenario IN ('base','upside','downside')),
  metric_name TEXT NOT NULL,
  metric_value REAL,
  unit TEXT,
  calculation_method TEXT,
  confidence_score REAL DEFAULT 0.8,
  data_source TEXT DEFAULT 'calculated',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id)
);

-- Platform / Operational Tables

CREATE TABLE IF NOT EXISTS deal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT,
  document_type TEXT,
  upload_date TEXT DEFAULT (datetime('now')),
  extraction_status TEXT DEFAULT 'pending',
  parsed_text TEXT,
  structured_data TEXT,
  page_count INTEGER,
  parser_warnings TEXT,
  classification_confidence REAL,
  classification_reasoning TEXT,
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id)
);

CREATE TABLE IF NOT EXISTS extraction_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed')),
  stage TEXT DEFAULT 'parsing',
  progress_pct REAL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  document_ids TEXT,
  pipeline_state TEXT,
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id)
);

CREATE TABLE IF NOT EXISTS model_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL,
  scenario TEXT NOT NULL,
  template_name TEXT,
  template_version TEXT DEFAULT '1.0',
  inputs_json TEXT,
  outputs_json TEXT,
  validation_json TEXT,
  agent_version TEXT DEFAULT 'v1',
  approval_state TEXT DEFAULT 'pending' CHECK(approval_state IN ('pending','approved','rejected','changes_requested')),
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT DEFAULT 'agent',
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id)
);

CREATE TABLE IF NOT EXISTS hitl_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  tier INTEGER DEFAULT 2,
  reviewer TEXT,
  decision TEXT CHECK(decision IN ('approved','rejected','changes_requested')),
  modifications_json TEXT,
  approved_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenario_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  description TEXT,
  delta_assumptions_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id)
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT 'New conversation',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  confidence REAL,
  tokens_used INTEGER,
  latency_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
);

CREATE TABLE IF NOT EXISTS investment_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  decision TEXT CHECK(decision IN ('proceed','conditional','pass','hold','draft')),
  thesis TEXT,
  risks TEXT,
  valuation_summary TEXT,
  recommended_action TEXT,
  linked_model_run_id INTEGER,
  drafted_by_ai INTEGER DEFAULT 0,
  author TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deal_id) REFERENCES deal_pipeline(deal_id),
  FOREIGN KEY (linked_model_run_id) REFERENCES model_runs(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  actor TEXT DEFAULT 'system',
  details_json TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_financials_company ON target_company_financials(company_name);
CREATE INDEX IF NOT EXISTS idx_financials_deal ON target_company_financials(deal_id);
CREATE INDEX IF NOT EXISTS idx_financials_period ON target_company_financials(period);
CREATE INDEX IF NOT EXISTS idx_comps_sector ON comparable_companies(sector);
CREATE INDEX IF NOT EXISTS idx_transactions_sector ON comparable_transactions(sector);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deal_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_assumptions_deal ON valuation_assumptions(deal_id);
CREATE INDEX IF NOT EXISTS idx_outputs_deal ON model_outputs(deal_id);
CREATE INDEX IF NOT EXISTS idx_documents_deal ON deal_documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_extraction_deal ON extraction_jobs(deal_id);
CREATE INDEX IF NOT EXISTS idx_model_runs_deal ON model_runs(deal_id);
CREATE INDEX IF NOT EXISTS idx_hitl_entity ON hitl_reviews(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_deal ON investment_recommendations(deal_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
`;
