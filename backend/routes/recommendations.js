import { Router } from 'express';
import { auditLog } from '../database.js';
import { callLLM } from '../agents/llm.js';

const router = Router();

// --------------------------------------------------------------------------
// GET /api/deals/:dealId/recommendation
// Returns the latest recommendation for a deal, or null.
// --------------------------------------------------------------------------
router.get('/deals/:dealId/recommendation', (req, res) => {
  try {
    const { dealId } = req.params;
    const row = req.db.get(
      `SELECT * FROM investment_recommendations
       WHERE deal_id = ?
       ORDER BY version DESC
       LIMIT 1`,
      dealId
    );
    res.json(row || null);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// --------------------------------------------------------------------------
// GET /api/deals/:dealId/recommendation/history
// Returns all versions (most recent first).
// --------------------------------------------------------------------------
router.get('/deals/:dealId/recommendation/history', (req, res) => {
  try {
    const { dealId } = req.params;
    const rows = req.db.all(
      `SELECT * FROM investment_recommendations
       WHERE deal_id = ?
       ORDER BY version DESC`,
      dealId
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// --------------------------------------------------------------------------
// PUT /api/deals/:dealId/recommendation
// Create a new version. If a prior version exists, increment version number.
// --------------------------------------------------------------------------
router.put('/deals/:dealId/recommendation', (req, res) => {
  try {
    const { dealId } = req.params;
    const { decision, thesis, risks, valuation_summary, recommended_action,
            linked_model_run_id, drafted_by_ai, author } = req.body;

    const deal = req.db.get('SELECT deal_id FROM deal_pipeline WHERE deal_id = ?', dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const prev = req.db.get(
      'SELECT MAX(version) AS v FROM investment_recommendations WHERE deal_id = ?',
      dealId
    );
    const version = (prev?.v || 0) + 1;

    // Link to latest base model run if none provided
    let linkedRunId = linked_model_run_id;
    if (!linkedRunId) {
      const latestRun = req.db.get(
        `SELECT id FROM model_runs
         WHERE deal_id = ? AND scenario = 'base'
         ORDER BY created_at DESC LIMIT 1`,
        dealId
      );
      linkedRunId = latestRun?.id ?? null;
    }

    req.db.run(
      `INSERT INTO investment_recommendations
       (deal_id, version, decision, thesis, risks, valuation_summary,
        recommended_action, linked_model_run_id, drafted_by_ai, author)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      dealId,
      version,
      decision || 'draft',
      thesis || '',
      risks || '',
      valuation_summary || '',
      recommended_action || '',
      linkedRunId,
      drafted_by_ai ? 1 : 0,
      author || 'analyst',
    );

    const created = req.db.get(
      `SELECT * FROM investment_recommendations
       WHERE deal_id = ? AND version = ?`,
      dealId, version
    );

    auditLog(
      req.db, 'recommendation.updated', 'deal_pipeline', dealId, author || 'analyst',
      { version, decision: decision || 'draft', drafted_by_ai: !!drafted_by_ai, linked_model_run_id: linkedRunId }
    );

    res.status(201).json(created);
  } catch (err) {
    console.error('PUT recommendation failed:', err);
    res.status(500).json({ error: 'Failed', details: err.message || String(err) });
  }
});

// --------------------------------------------------------------------------
// POST /api/deals/:dealId/recommendation/draft
// AI-assisted draft via Claude Sonnet. Grounds the memo in the latest base-case
// model run, financials, sector comps. Does NOT auto-save — returns the draft
// for the user to review and edit before PUT.
// --------------------------------------------------------------------------
const DRAFT_SYSTEM = `You are a senior private-equity investment analyst drafting an Investment Committee (IC) memo.

OUTPUT FORMAT — respond with ONLY a JSON object (no markdown fences, no prose):
{
  "decision": "proceed" | "conditional" | "pass" | "hold",
  "thesis": "3-5 bullet points describing the investment thesis, strategic rationale, value creation levers.",
  "risks": "3-5 numbered risks with severity and mitigants.",
  "valuation_summary": "Paragraph covering DCF, trading comps, precedent transactions, blended EV, and implied IRR/MOIC.",
  "recommended_action": "Specific action — recommended bid range, conditions precedent, or pass rationale."
}

RULES:
- Ground every number in the data provided. Do NOT invent metrics.
- Be concise. Each section 80-160 words.
- Structure thesis and risks with bullets or numbered lists, one per line.
- Use the analyst register: direct, quantified, assumption-aware.
- Pick decision based on:
  * "proceed"    — valuation gap positive, IRR >= 18%, no structural risks
  * "conditional" — attractive economics but specific dealbreakers to close out
  * "pass"        — economics marginal or structural risk material
  * "hold"        — need more data before deciding`;

router.post('/deals/:dealId/recommendation/draft', async (req, res) => {
  try {
    const { dealId } = req.params;
    const deal = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    // Gather all context
    const financials = req.db.all(
      'SELECT * FROM target_company_financials WHERE deal_id = ? ORDER BY period',
      dealId
    );
    const assumptions = req.db.all(
      'SELECT assumption_name, base_case, upside_case, downside_case, unit, source_rationale FROM valuation_assumptions WHERE deal_id = ?',
      dealId
    );
    const outputs = req.db.all(
      "SELECT scenario, metric_name, metric_value, unit FROM model_outputs WHERE deal_id = ?",
      dealId
    );
    const comps = deal.sector
      ? req.db.all('SELECT company_name, ev_ebitda, ev_revenue, revenue_growth_pct, ebitda_margin_pct FROM comparable_companies WHERE sector = ?', deal.sector)
      : [];
    const txns = deal.sector
      ? req.db.all('SELECT transaction_name, deal_value, ev_ebitda, premium_pct FROM comparable_transactions WHERE sector = ?', deal.sector)
      : [];
    const baseRun = req.db.get(
      "SELECT id, outputs_json FROM model_runs WHERE deal_id = ? AND scenario = 'base' ORDER BY created_at DESC LIMIT 1",
      dealId
    );
    const baseOutputs = outputs.filter(o => o.scenario === 'base');
    const blendedRow   = baseOutputs.find(o => o.metric_name === 'Blended Valuation');
    const irrRow       = baseOutputs.find(o => o.metric_name === 'Implied IRR');
    const moicRow      = baseOutputs.find(o => o.metric_name === 'MOIC');

    // Valuation gap signal
    const blendedVal = blendedRow?.metric_value;
    const gapPct = blendedVal && deal.deal_size_estimate
      ? ((blendedVal - deal.deal_size_estimate) / deal.deal_size_estimate) * 100
      : null;
    const signal = gapPct == null ? 'no-model'
                 : gapPct >= 10  ? 'upside'
                 : gapPct <= -10 ? 'risk (overpriced)'
                 : 'fair';

    const userMessage = `
DEAL CONTEXT
  deal_id: ${deal.deal_id}
  name: ${deal.deal_name}
  target: ${deal.target_company}
  sector: ${deal.sector}
  stage: ${deal.stage}
  deal_size_estimate: $${deal.deal_size_estimate}M (the ask)
  lead_analyst: ${deal.lead_analyst || 'unassigned'}

FINANCIALS (most recent first)
${financials.slice().reverse().map(f => `  ${f.period}: revenue=$${f.revenue}M  EBITDA=$${f.ebitda}M  margin=${f.ebitda_margin_pct}%  growth=${f.revenue_growth_pct ?? '-'}%  FCF=$${f.free_cash_flow}M`).join('\n')}

BASE-CASE MODEL OUTPUTS
  Blended Enterprise Value: $${blendedVal ?? '?'}M
  Implied IRR: ${irrRow?.metric_value ?? '?'}%
  MOIC: ${moicRow?.metric_value ?? '?'}x
  Valuation gap vs ask: ${gapPct != null ? gapPct.toFixed(1) + '% (' + signal + ')' : 'no model built yet'}

KEY ASSUMPTIONS
${assumptions.slice(0, 8).map(a => `  ${a.assumption_name}: base=${a.base_case} upside=${a.upside_case} downside=${a.downside_case} ${a.unit} — ${a.source_rationale}`).join('\n')}

SECTOR COMPS (${deal.sector || '-'})
${comps.slice(0, 8).map(c => `  ${c.company_name}: EV/EBITDA=${c.ev_ebitda}x  EV/Rev=${c.ev_revenue}x  growth=${c.revenue_growth_pct}%  margin=${c.ebitda_margin_pct}%`).join('\n')}

PRECEDENT TRANSACTIONS
${txns.slice(0, 6).map(t => `  ${t.transaction_name}: $${t.deal_value}M  EV/EBITDA=${t.ev_ebitda}x  premium=${t.premium_pct}%`).join('\n')}

Draft the IC memo now.`;

    const result = await callLLM({
      tier: 'heavy',
      temperature: 0.2,
      maxTokens: 2500,
      system: DRAFT_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Parse JSON from Sonnet output (strip fences if any)
    let parsed;
    try {
      let raw = result.content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      }
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({
        error: 'Draft parsing failed',
        details: 'The AI returned an unparseable response',
        raw: result.content.slice(0, 500),
      });
    }

    res.json({
      decision: parsed.decision || 'draft',
      thesis: parsed.thesis || '',
      risks: parsed.risks || '',
      valuation_summary: parsed.valuation_summary || '',
      recommended_action: parsed.recommended_action || '',
      linked_model_run_id: baseRun?.id ?? null,
      drafted_by_ai: true,
      tokensUsed: result.usage?.inputTokens + result.usage?.outputTokens,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    console.error('AI draft failed:', err);
    res.status(500).json({ error: 'Failed to draft', details: err.message || String(err) });
  }
});

export default router;
