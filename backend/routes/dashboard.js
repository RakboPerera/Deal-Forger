import { Router } from 'express';

const router = Router();

router.get('/pipeline-summary', (req, res) => {
  try {
    const stages = ['screening', 'due_diligence', 'negotiation', 'closed', 'passed'];
    const summary = stages.map(stage => {
      const row = req.db.get(
        'SELECT COUNT(*) as count, COALESCE(SUM(deal_size_estimate), 0) as total_value FROM deal_pipeline WHERE stage = ?', stage
      );
      return { stage, count: row?.count || 0, total_value: row?.total_value || 0 };
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/sector-distribution', (req, res) => {
  try {
    const rows = req.db.all(
      `SELECT sector, COUNT(*) as count, COALESCE(SUM(deal_size_estimate), 0) as total_value
       FROM deal_pipeline WHERE sector IS NOT NULL GROUP BY sector ORDER BY count DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/valuation-ranges', (req, res) => {
  try {
    const deals = req.db.all("SELECT deal_id, deal_name, target_company, deal_size_estimate, stage FROM deal_pipeline");
    const result = deals.map(deal => {
      const outputs = req.db.all(
        "SELECT scenario, metric_name, metric_value FROM model_outputs WHERE deal_id = ? AND metric_name LIKE '%Blended%'", deal.deal_id
      );
      return { ...deal, valuations: outputs };
    }).filter(d => d.valuations.length > 0);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/recent-activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const rows = req.db.all('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?', limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// Valuation vs. analyst estimate — which deals are above/below the blended model output
router.get('/valuation-gap', (req, res) => {
  try {
    const deals = req.db.all(
      "SELECT deal_id, deal_name, target_company, stage, sector, deal_size_estimate FROM deal_pipeline"
    );
    const rows = [];
    for (const d of deals) {
      if (!d.deal_size_estimate) continue;
      const base = req.db.get(
        "SELECT metric_value FROM model_outputs WHERE deal_id = ? AND scenario = 'base' AND metric_name = 'Blended Valuation'", d.deal_id
      );
      if (!base) continue;
      const blended = base.metric_value;
      const gap = blended - d.deal_size_estimate;
      const gapPct = d.deal_size_estimate ? (gap / d.deal_size_estimate) * 100 : 0;
      rows.push({
        deal_id: d.deal_id,
        deal_name: d.deal_name,
        target_company: d.target_company,
        stage: d.stage,
        sector: d.sector,
        estimate: d.deal_size_estimate,
        blended,
        gap,
        gap_pct: gapPct,
        signal: gapPct > 10 ? 'upside' : gapPct < -10 ? 'risk' : 'fair',
      });
    }
    res.json(rows.sort((a, b) => b.gap_pct - a.gap_pct));
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// IRR / MOIC ranking across all deals
router.get('/irr-ranking', (req, res) => {
  try {
    // Exclude "passed" deals — we don't need returns data on deals we declined.
    const deals = req.db.all(
      "SELECT deal_id, deal_name, target_company, sector, stage FROM deal_pipeline WHERE stage != 'passed'"
    );
    const rows = [];
    for (const d of deals) {
      const irr = req.db.get(
        "SELECT metric_value FROM model_outputs WHERE deal_id = ? AND scenario = 'base' AND metric_name = 'Implied IRR'", d.deal_id
      );
      const moic = req.db.get(
        "SELECT metric_value FROM model_outputs WHERE deal_id = ? AND scenario = 'base' AND metric_name = 'MOIC'", d.deal_id
      );
      if (irr == null && moic == null) continue;
      rows.push({
        ...d,
        irr: irr?.metric_value ?? null,
        moic: moic?.metric_value ?? null,
      });
    }
    // Sort by IRR desc
    rows.sort((a, b) => (b.irr ?? -Infinity) - (a.irr ?? -Infinity));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// Sector benchmarks (avg multiples) from comps table
router.get('/sector-multiples', (req, res) => {
  try {
    const rows = req.db.all(
      `SELECT sector,
              AVG(ev_ebitda)         AS avg_ev_ebitda,
              AVG(ev_revenue)        AS avg_ev_revenue,
              AVG(revenue_growth_pct) AS avg_growth,
              AVG(ebitda_margin_pct) AS avg_margin,
              COUNT(*)               AS n
       FROM comparable_companies
       WHERE sector IS NOT NULL
       GROUP BY sector
       ORDER BY avg_ev_ebitda DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// Growth vs margin scatter per target company (latest period)
router.get('/growth-margin', (req, res) => {
  try {
    // Latest period per company
    const rows = req.db.all(`
      SELECT deal_id, company_name,
             revenue, revenue_growth_pct, ebitda_margin_pct,
             period
      FROM target_company_financials t1
      WHERE period = (SELECT MAX(period) FROM target_company_financials t2 WHERE t2.deal_id = t1.deal_id)
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// Single "insights" endpoint with headline numbers for the top stat strip
router.get('/insights', (req, res) => {
  try {
    const totalDeals = req.db.get('SELECT COUNT(*) AS n FROM deal_pipeline').n;
    const active = req.db.get("SELECT COUNT(*) AS n FROM deal_pipeline WHERE stage NOT IN ('closed','passed')").n;
    const totalPipeline = req.db.get("SELECT COALESCE(SUM(deal_size_estimate),0) AS v FROM deal_pipeline WHERE stage NOT IN ('closed','passed')").v;
    const closedValue   = req.db.get("SELECT COALESCE(SUM(deal_size_estimate),0) AS v FROM deal_pipeline WHERE stage = 'closed'").v;

    // Weighted pipeline value — stage-based probability
    const stageWeights = { screening: 0.15, due_diligence: 0.45, negotiation: 0.75, closed: 1, passed: 0 };
    const stageSums = req.db.all("SELECT stage, COALESCE(SUM(deal_size_estimate),0) AS v FROM deal_pipeline GROUP BY stage");
    const weighted = stageSums.reduce((sum, r) => sum + (stageWeights[r.stage] ?? 0) * r.v, 0);

    // Modeled deals — how many have at least one model output row
    const modeled = req.db.get(
      'SELECT COUNT(DISTINCT deal_id) AS n FROM model_outputs'
    ).n;

    // Average IRR across active base cases
    const avgIrr = req.db.get(
      `SELECT AVG(metric_value) AS v
       FROM model_outputs mo
       JOIN deal_pipeline dp ON dp.deal_id = mo.deal_id
       WHERE mo.scenario = 'base' AND mo.metric_name = 'Implied IRR'
         AND dp.stage NOT IN ('passed')`
    ).v;

    // Documents processed + extraction success rate
    const docsTotal = req.db.get('SELECT COUNT(*) AS n FROM deal_documents').n;
    const docsDone  = req.db.get("SELECT COUNT(*) AS n FROM deal_documents WHERE extraction_status = 'completed'").n;
    const extractionRate = docsTotal ? (docsDone / docsTotal) * 100 : 0;

    // HITL pending
    const pendingReviews = req.db.get('SELECT COUNT(*) AS n FROM hitl_reviews WHERE decision IS NULL').n;
    const approvedReviews = req.db.get("SELECT COUNT(*) AS n FROM hitl_reviews WHERE decision = 'approved'").n;

    res.json({
      totalDeals,
      active,
      totalPipeline,
      closedValue,
      weightedPipeline: weighted,
      modeledDeals: modeled,
      modelCoverage: totalDeals ? (modeled / totalDeals) * 100 : 0,
      avgIrr: avgIrr != null ? Number(avgIrr) : null,
      docsTotal,
      docsDone,
      extractionRate,
      pendingReviews,
      approvedReviews,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

export default router;
