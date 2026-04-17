# DealForge — AI-Powered Deal Analysis Platform

An end-to-end M&A deal-analysis workspace that uses Claude agents to parse CIMs, extract financials, run DCF / comps / precedent-transaction valuations, and draft investment-committee memos.

## What's in the box

- **7-stage intake pipeline** — Parse → Classify (Haiku) → Extract (Sonnet) → Reconcile → Sector (Sonnet) → Quality → Load
- **Deterministic valuation engine** (pure JS) — DCF with terminal value, trading comps, precedent transactions, football field blend, WACC × terminal-growth sensitivity grid, IRR/MOIC
- **Auto-generated assumptions** — anchored on observed financials + sector defaults; transparent `source_rationale` on every row
- **Chat agent** — Claude Sonnet with 6 database tools (`query_deal`, `query_model_outputs`, `compare_scenarios`, `query_comps_for_deal`, `find_similar_deals`, `summarize_assumptions`); SQL-backed fallback when no API key is configured
- **AI-drafted IC memos** — grounded on deal financials + model outputs + comps; auto-decision (Proceed / Conditional / Pass / Hold)
- **HITL review queue** — paused extractions or model runs surface for human approval
- **Agent Pipeline Trace** — per-stage transparency on every deal showing which model ran, what it produced, confidence

## Architecture

```
frontend (Vite + React)          backend (Express + sql.js)
├── Overview                     ├── routes/
├── Pipeline (Kanban + badges)   │   ├── deals, financials, comparables, transactions
├── DealDetail (7 tabs)          │   ├── extraction (orchestrates intake pipeline)
│   ├── Overview + Agent Trace   │   ├── models (DCF builder)
│   ├── Documents                │   ├── chat (orchestrator with tools)
│   ├── Target Financials        │   ├── recommendations (AI-draft + persistence)
│   ├── Comparables              │   ├── hitl, dashboard, meta, settings
│   ├── Model + Sensitivity      │   ├── dataimport (CSV/XLSX)
│   ├── Recommendation           │   └── documents (multer upload)
│   └── Timeline                 ├── agents/
├── Data Workspace               │   ├── intake/ (parser, classifier, extractor,
├── Comparables browser          │   │           reconciler, sector, quality, loader, pipeline)
├── Reviews (HITL queue)         │   ├── chat/ (orchestrator + 6 tools)
├── Chat                         │   ├── llm.js (Anthropic SDK wrapper)
├── Dashboard                    │   ├── confidence.js
└── Settings                     │   └── loop.js (tool-use agent loop)
                                 ├── models/math.js (858 lines of deterministic valuation math)
                                 └── schema.js (16 tables + indexes)
```

## Quick start

### Prerequisites
- Node 20+ (tested on Node 24)
- An Anthropic API key (optional — app runs without it using deterministic SQL fallback for chat, but AI draft / full extraction pipeline need it)

### First time
```bash
cd backend && npm install
cd ../frontend && npm install
```

### Run (two terminals)

**Terminal 1 — backend (port 8000):**
```bash
cd backend
npm run dev
```

**Terminal 2 — frontend (port 5173):**
```bash
cd frontend
npm run dev
```

Open http://localhost:5173.

### Add your Anthropic key
Settings → paste key → Validate → Save. Keys are held in server memory only (never written to disk).

### Reset demo data
Settings → Data Management → Reset to Sample Data. Or delete `backend/data/dealforge.db` and restart.

## Demo flow (works with or without API key)

1. **Pipeline** — 6 sample deals across 5 stages; each card shows blended EV, IRR, and recommendation decision badges
2. **Open any deal** → see Agent Pipeline Trace (what each agent produced), valuation signal (upside/fair/risk), and full IC memo
3. **Model tab** — scenario tabs (base/upside/downside), DCF bridge, football field, WACC × terminal growth sensitivity heat map
4. **Recommendation tab** — click **"Draft with AI"** for a 4-section memo grounded on real deal data
5. **Dashboard** — pipeline funnel, valuation gap signals, IRR ranking, sector benchmarks, growth/margin scatter
6. **Chat** — ask analytical questions ("Which deals have the highest IRR?") and watch the tool calls expand
7. **Reviews** — paused extraction / model-approval queue with audit-logged notes
8. **Data Workspace** — bulk import/export CSV and XLSX per table

## Key design principles

- **Templates, not generation** — valuation models come from pre-defined math templates, not AI invention
- **All math in JS** — every calculation deterministic; AI never performs arithmetic
- **Every assumption sourced** — `source_rationale` on each assumption row shows where the number came from
- **Human in the loop** — extraction pauses on low quality; every model run has an approval state
- **Audit trail** — every agent action hits `audit_log`; Timeline tab per deal shows full history

## Stack

- **Frontend** — React 18, React Router 6, Recharts, Lucide icons, Vite
- **Backend** — Express 4, sql.js (in-memory SQLite with disk persistence), multer, mammoth (DOCX), pdf-parse, xlsx, papaparse
- **AI** — @anthropic-ai/sdk (Claude Haiku 4.5 for classification/router, Claude Sonnet 4.5 for extraction/analysis/chat/drafting)

## License

MIT — this is a demo / reference implementation.
