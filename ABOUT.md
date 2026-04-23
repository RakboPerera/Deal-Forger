# DealForge

**AI-Powered M&A Deal Analysis Platform**

DealForge takes the manual grind out of evaluating acquisition targets. Drop in a CIM or financial spreadsheet, and a pipeline of Claude agents extracts the numbers, classifies the sector, selects comparables, runs the valuation math, and drafts an investment-committee memo — in about 4 minutes instead of 4 days.

The agents supply the *inputs*. Deterministic JavaScript does the *math*. Every number is sourced, every agent action is auditable, and every recommendation is grounded in real deal data.

---

## The problem it solves

M&A analysts burn days on work that doesn't differentiate them:

| Painful today | What DealForge does |
|---|---|
| Manually copy 3-5 years of financials from a CIM into Excel | Agents parse PDFs/DOCX/CSV/XLSX and extract structured financials with confidence scores |
| Hand-build a DCF template, hand-pick comps, hand-compute multiples | Pre-built math engine runs DCF + trading comps + precedent transactions + football field blend + sensitivity in one call |
| Assumptions live in analyst's head | Every assumption stored with `source_rationale`, anchored to observed metrics, tagged by origin (auto / manual / extracted) |
| IC memos written from scratch | Claude Sonnet drafts a 4-section memo from live deal data; user edits, versions persist to DB |
| No audit trail, no "show your work" | 7-stage Agent Pipeline Trace on every deal + Timeline tab showing every event |

---

## What's in the box

### 7-stage agent intake pipeline

```
  Upload PDF/DOCX/CSV/XLSX
         ↓
  1. Parse         pdf-parse / mammoth / xlsx / papaparse
  2. Classify      Claude Haiku + fast heuristic for financial spreadsheets
  3. Extract       Claude Sonnet maps to canonical fields
  4. Reconcile     Resolve cross-document conflicts
  5. Sector        Claude Sonnet classifies + selects matching comps (vocab-constrained)
  6. Quality       Validation rules (growth sanity, margin bands, missing fields)
  7. Load          Insert to DB with confidence scores, audit log, auto-generated assumptions
```

Real-time progress via polling job queue. If quality fails, pipeline pauses and creates an HITL review.

### Deterministic valuation engine (pure JavaScript)

The math module (`backend/models/math.js`, ~860 lines) runs entirely without AI involvement:

- **DCF** — 5-year projections, Gordon Growth terminal value, WACC discounting
- **Trading Comps** — EV/EBITDA, EV/Revenue, P/E with statistical stats (median, mean, p25, p75)
- **Precedent Transactions** — M&A multiples with control premium
- **Football Field** — Weighted blend of the three methods
- **Sensitivity Grid** — 5×5 WACC × Terminal Growth heat map per scenario
- **IRR / MOIC** — Computed from entry (ask) to year-5 exit (EBITDA × exit multiple)

Every scenario (base / upside / downside) runs end-to-end deterministically, then ships as JSON in `model_runs.outputs_json`.

### Auto-generated assumptions, observation-anchored

When a user uploads financials, `assumptionGenerator.js` produces a full 15-row assumption set within a transaction. Year-1 growth and EBITDA margin are anchored on the *observed* FY numbers, not generic sector defaults. Every row stores a human-readable `source_rationale` like:

> "Anchored on observed FY growth of 44.1% (FY2023)"

### Claude chat agent with 6 database tools

Three-tier architecture in `agents/chat/orchestrator.js`:

1. **Router (Haiku)** — classifies the query
2. **Worker (Sonnet with tool use)** — calls tools:
   - `query_deal` — full deal context
   - `query_model_outputs` — valuation metrics
   - `compare_scenarios` — base/upside/downside deltas
   - `query_comps_for_deal` — sector-matched comps
   - `find_similar_deals` — pipeline search
   - `summarize_assumptions` — assumption rationale
3. **Synthesizer (Haiku)** — formats the final response

Every tool-use call is logged, returned with confidence scoring, and rendered inline in the chat bubble ("Show work" expander).

Falls back to deterministic SQL queries when no Anthropic API key is configured — the app stays useful offline.

### AI-drafted investment-committee memos

Click **"Draft with AI"** on any deal's Recommendation tab → Claude Sonnet receives the full deal context (financials, comps, model outputs, valuation gap signal) and returns a 4-section JSON memo:

- Investment Thesis
- Key Risks
- Valuation Summary
- Recommended Action
- Structured **Decision** enum (`proceed / conditional / pass / hold`)

The memo is persisted server-side in a versioned `investment_recommendations` table, not localStorage. Auto-save with 1.5s debounce. Linked to the specific model run it was drafted against — if the model is rebuilt later, a "stale model" banner appears with a one-click regenerate.

### Human-in-the-loop review queue

When the quality stage fails or a model run is flagged for approval, an item lands in the Reviews tab. Analysts see:

- The entity and reason for review
- Full audit details (raw `pipeline_state` JSON, error message, quality score)
- Approve / Reject actions with optional notes (captured to audit log)
- Approving a paused extraction resumes the pipeline automatically

### Agent Pipeline Trace — full provenance per deal

On every deal's Overview tab, an expandable panel shows exactly what each of the 7 agents did:

```
✓ Parse         novatek_cim.csv (3 KB, 4 rows)
✓ Classify      audited_financial_statement (90%)    [Claude Haiku]
✓ Extract       3 periods, avg confidence 85%        [Claude Sonnet]
✓ Reconcile     1 source — no conflicts
⚠ Sector        Agent suggested Enterprise SaaS; kept user's setting
✓ Quality       Score 88/100 — 0 errors, 2 warnings
✓ Load          3 financial rows, 15 assumptions
```

Footer reminds users: *"All math is deterministic JavaScript. AI agents supply the inputs, never perform arithmetic."*

### Portfolio Dashboard

Beyond per-deal views, the Dashboard aggregates:

- **Valuation vs Analyst Estimate** — diverging bar chart flagging each deal as *upside / fair / overpriced*
- **IRR / MOIC Ranking** — sorted by base-case IRR (excludes passed deals), click-through to deal
- **Pipeline Funnel** — count + total value per stage
- **Sector Distribution** — donut with $-weighted slices
- **Sector Benchmarks** — average trading multiples from comps
- **Growth vs Margin scatter** — every target's (FY growth, EBITDA margin), bubble size = revenue
- **Valuation Range** — base/upside/downside blended EV per deal
- **Model Coverage, Extraction Success Rate, HITL Queue Size**
- **Recent Activity** — live audit log feed
- Silent auto-refresh every 60 seconds (Promise.allSettled so one failure doesn't blank a widget)

### Deal Detail page — 7 tabs per deal

| Tab | Contents |
|---|---|
| **Overview** | Next-step CTA, recommendation card, Agent Pipeline Trace, deal summary, valuation range, quick stats, status |
| **Documents** | Drop zone, one-click extraction with live progress, per-doc status + confidence, delete |
| **Target Financials** | CAGR, latest revenue/margin/headcount KPIs; **revenue + EBITDA bar chart with margin line**; historical table with per-row confidence badges |
| **Comparables** | Sector-matched peer set (full table) + precedent transactions + aggregate statistics |
| **Model** | Scenario tabs (base/upside/downside), 15-row key assumptions with source badges + rationale tooltips, 5-year DCF projections, DCF bridge, valuation summary, football field with weighted blend, **5×5 sensitivity heat map with colour-coded cells** |
| **Recommendation** | AI-drafted 4-section memo, decision dropdown, auto-save, export as Markdown / PDF, linked model run, stale-model banner |
| **Timeline** | Per-deal audit-log stream — every agent action, every upload, every approval, in order |

### HITL Reviews, Chat, Data Workspace, Settings

- **Reviews** — Filterable queue (pending / approved / rejected / all), detail drawer with parsed `pipeline_state`, approve/reject with notes that append to audit log
- **Chat** — Conversation history, "Show work" expander on every tool call, API-key status banner, starter prompts that auto-send
- **Data Workspace** — Bulk CSV/XLSX import per table, inline edit, column mapping, clear sample data
- **Settings** — API key validation via live Anthropic round-trip, model selector (Sonnet 4.5/4.6, Haiku 4.5), reset demo, system health

---

## Under the hood

### Schema (16 tables)

```
deal_pipeline                  — core deal record
target_company_financials      — extracted financial periods
comparable_companies           — public comps with multiples
comparable_transactions        — precedent M&A data
valuation_assumptions          — 15+ rows per deal, 3 scenarios
model_outputs                  — per-scenario metric values
model_runs                     — full snapshot with inputs/outputs/validation JSON
deal_documents                 — uploaded files + extraction status
extraction_jobs                — async pipeline runs with pipeline_state
hitl_reviews                   — human approval queue
investment_recommendations     — versioned IC memos w/ decision enum
scenario_definitions           — custom scenario deltas
chat_conversations             — message threads
chat_messages                  — per-message content + tool calls + confidence
audit_log                      — every user/agent action
```

### Tech stack

**Frontend**
- React 18 with React Router 6
- Vite 6 for build + HMR
- Recharts for all data viz
- Lucide icons
- Inline styles + minimal global CSS (no Tailwind, no UI library)
- ToastContext + ErrorBoundary + resilient axios interceptor (auto-retry on 429)

**Backend**
- Express 4 on Node 22+
- sql.js (in-memory SQLite with disk persistence, no native bindings — runs anywhere)
- multer for file uploads (50MB cap)
- mammoth, pdf-parse, xlsx, papaparse for document parsing
- @anthropic-ai/sdk with retry + timeout wrapper

**AI**
- Claude **Haiku 4.5** for router, classifier, synthesizer (fast, cheap)
- Claude **Sonnet 4.5** for extractor, sector classifier, chat worker, IC drafter (reasoning quality)

### Design principles

1. **Templates, not generation.** Valuation models come from pre-defined math templates — AI never invents a formula.
2. **All math in JS.** Deterministic, auditable, reproducible. AI supplies numbers, never calculates them.
3. **Every assumption sourced.** `source_rationale` on every row. Users can always ask "where did this number come from?"
4. **Human in the loop.** Extraction pauses on low quality. Every model run has an approval state. Reviewers leave notes that land in the audit log.
5. **No black box.** Agent Pipeline Trace exposes which model ran which stage with what confidence. Tool calls in chat are expandable.
6. **Pure JS, no native deps.** sql.js means no compilation, no platform drift — runs the same on Mac, Windows, Linux, Render, Docker.

---

## Demo flow (5 minutes)

1. **Pipeline page** — 6 sample deals across 5 stages. Each card shows Sample badge, blended EV, IRR badge, and recommendation decision.
2. **Open Project Falcon** (DEAL-001) — full Overview with Agent Pipeline Trace expanded, Recommendation card showing AI-drafted memo, valuation range football field
3. **Model tab** — scenario tabs, 5-year DCF projections with year-by-year FCF, DCF bridge, 5×5 sensitivity heat map (WACC × terminal growth)
4. **Recommendation tab** — click "Draft with AI" on an empty deal (e.g. Project Raven) — in ~30-40 seconds, Claude Sonnet produces a full IC memo grounded in live data
5. **Chat** — "Which 3 deals have the highest IRR?" — watch the tool calls fire (`find_similar_deals`, `query_model_outputs` × N), confidence 94%, answer cites exact numbers
6. **Dashboard** — valuation-gap signals flag Project Hawk as overpriced (-12%), Project Raven as +17% upside. Click any row to drill through.
7. **Reviews** — approve a paused extraction, watch it resume with a logged reviewer note
8. **Upload your own** — create a new deal, drop a financial CSV, watch the 7-stage pipeline live, see every insight populate

---

## Metrics (from the current seeded demo)

| | |
|---|---|
| Deals in pipeline | 6 (4 active, 1 closed, 1 passed) |
| Active pipeline value | $2.5B |
| Probability-weighted pipeline | $1.1B |
| Model coverage | 100% — every deal has 3 scenarios × 6 metrics |
| Extraction success rate | 93% — 13/14 documents loaded |
| Average IRR (base cases) | 14.5% |
| Total financial records | 18 periods |
| Trading comparables | 19 across 5 sectors |
| Precedent transactions | 12 M&A deals |
| Assumptions seeded | 90 (15 per deal × 6 deals) |
| Model outputs stored | 108 (6 deals × 3 scenarios × 6 metrics) |
| Audit log entries | 20+ per fresh reseed |

---

## What it's *not*

- Not a full trading platform or multi-user SaaS — single-tenant by design
- Not a data vendor — the seeded comps are illustrative, not live market data
- Not a replacement for an analyst — it accelerates the obvious work so analysts spend time on judgment, not data entry
- Not intended as compliance-grade audited output without human review — the HITL flow is mandatory for a reason

---

## Repository layout

```
dealforge-v2/
├── backend/
│   ├── server.js                  Express bootstrap + middleware
│   ├── database.js                sql.js wrapper with auto-save
│   ├── schema.js                  16-table SQL schema
│   ├── seed.js                    Calibrated demo data with live math
│   ├── routes/                    15 REST modules (deals, models, chat, etc.)
│   ├── agents/
│   │   ├── llm.js                 Anthropic SDK wrapper with retry + timeout
│   │   ├── loop.js                Generic agentic tool-use loop
│   │   ├── confidence.js          5-factor confidence scorer
│   │   ├── intake/                7-stage intake pipeline
│   │   │   ├── parser.js
│   │   │   ├── classifier.js      + fast heuristic bypass
│   │   │   ├── extractor.js
│   │   │   ├── reconciler.js
│   │   │   ├── sector.js          Vocab-constrained
│   │   │   ├── quality.js
│   │   │   ├── loader.js          Non-destructive sector handling
│   │   │   ├── assumptionGenerator.js  Observation-anchored
│   │   │   └── pipeline.js        Orchestrator
│   │   └── chat/
│   │       ├── orchestrator.js    Router → Worker → Synthesizer
│   │       └── tools.js           6 DB query tools
│   ├── models/
│   │   └── math.js                Deterministic valuation engine (~860 LOC)
│   └── jobs/queue.js              In-process async job tracker
├── frontend/
│   └── src/
│       ├── App.jsx                Router + ErrorBoundary + ToastProvider
│       ├── api.js                 Axios client + 429 auto-retry interceptor
│       ├── pages/                 10 pages (Overview, Pipeline, DealDetail, …)
│       └── components/            Sidebar, TopNav, UploadModal, Tooltip, etc.
├── render.yaml                    Render Blueprint for 1-click deploy
├── README.md                      Quick-start + architecture
└── ABOUT.md                       This file
```

---

## Status

- ✅ **End-to-end flow validated with live Anthropic API** — create deal → upload CSV → 7-stage pipeline → model build → sensitivity heat map → AI draft recommendation → export
- ✅ **Deployed-ready** — single Web Service on Render, Node 22, no native deps
- ✅ **Clean repo** — no secrets, no `node_modules`, no `.db` files committed
- ⚠️ **Free-tier note** — Render's ephemeral filesystem means uploads/new deals are wiped on restart. Add a persistent disk on Starter plan for production persistence

---

*DealForge is a reference implementation of an agent-assisted analyst workspace — opinionated about where AI adds value (intake, drafting, analysis) and where it doesn't (arithmetic, reproducibility, audit).*
