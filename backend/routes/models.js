import { Router } from 'express';
import { auditLog } from '../database.js';
import { createJob, getJob, runJob } from '../jobs/queue.js';
import { calcDCF, calcTradingComps, calcPrecedentTransactions, calcFootballField, calcIRR, calcMOIC, sensitivityGrid } from '../models/math.js';
import { generateAssumptionsForDeal } from '../agents/intake/assumptionGenerator.js';

const router = Router();

router.get('/runs', (req, res) => {
  try {
    const { deal_id } = req.query;
    let sql = 'SELECT * FROM model_runs';
    const params = [];
    if (deal_id) { sql += ' WHERE deal_id = ?'; params.push(deal_id); }
    sql += ' ORDER BY created_at DESC';
    const runs = req.db.all(sql, ...params);
    // Parse JSON fields for convenience
    runs.forEach(run => {
      try { run.inputs = JSON.parse(run.inputs_json); } catch (_) {}
      try { run.outputs = JSON.parse(run.outputs_json); } catch (_) {}
      try { run.validation = JSON.parse(run.validation_json); } catch (_) {}
    });
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/runs/:id', (req, res) => {
  try {
    const run = req.db.get('SELECT * FROM model_runs WHERE id = ?', req.params.id);
    if (!run) return res.status(404).json({ error: 'Model run not found' });
    try { run.inputs = JSON.parse(run.inputs_json); } catch (_) {}
    try { run.outputs = JSON.parse(run.outputs_json); } catch (_) {}
    try { run.validation = JSON.parse(run.validation_json); } catch (_) {}
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

// Build model using real math engine
router.post('/build/:dealId', async (req, res) => {
  try {
    const deal = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', req.params.dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const jobId = `model-build-${req.params.dealId}-${Date.now()}`;
    createJob(jobId, { dealId: req.params.dealId, type: 'model_build' });

    runJob(jobId, async (onProgress) => {
      onProgress(5, 'Gathering data');

      const financials = req.db.all('SELECT * FROM target_company_financials WHERE deal_id = ? ORDER BY period DESC', req.params.dealId);
      let assumptions = req.db.all('SELECT * FROM valuation_assumptions WHERE deal_id = ?', req.params.dealId);
      const comps = req.db.all('SELECT * FROM comparable_companies WHERE sector = ?', deal.sector);
      const transactions = req.db.all('SELECT * FROM comparable_transactions WHERE sector = ?', deal.sector);

      if (financials.length === 0) throw new Error('No financial data found for this deal. Upload documents first.');

      // If assumptions are missing, auto-generate a sector-defaulted set so
      // Build Model never hard-fails on a freshly uploaded deal.
      if (assumptions.length === 0) {
        onProgress(8, 'Generating default assumptions');
        await generateAssumptionsForDeal(req.db, req.params.dealId, null);
        assumptions = req.db.all('SELECT * FROM valuation_assumptions WHERE deal_id = ?', req.params.dealId);
      }

      const latest = financials[0];
      const target = { revenue: latest.revenue, ebitda: latest.ebitda, netIncome: latest.net_income };

      // Parse assumptions into scenario configs
      const getAssumption = (name) => assumptions.find(a => a.assumption_name === name);
      const scenarios = ['base', 'upside', 'downside'];
      const scenarioField = { base: 'base_case', upside: 'upside_case', downside: 'downside_case' };

      onProgress(15, 'Running models');

      for (let si = 0; si < scenarios.length; si++) {
        const scenario = scenarios[si];
        const field = scenarioField[scenario];
        onProgress(15 + si * 25, `Building ${scenario} case`);

        // Build assumption set for this scenario
        const growthRates = [];
        for (let yr = 1; yr <= 5; yr++) {
          const a = getAssumption(`Revenue Growth Year ${yr}`);
          growthRates.push((a ? a[field] : 20) / 100);
        }

        const marginY1 = getAssumption('EBITDA Margin Year 1');
        const marginY5 = getAssumption('EBITDA Margin Year 5');
        const m1 = (marginY1 ? marginY1[field] : 25) / 100;
        const m5 = (marginY5 ? marginY5[field] : 32) / 100;
        const ebitdaMargins = Array.from({ length: 5 }, (_, i) => m1 + (m5 - m1) * (i / 4));

        const wacc = (getAssumption('WACC')?.[field] || 11) / 100;
        const termGrowth = (getAssumption('Terminal Growth Rate')?.[field] || 3) / 100;
        const taxRate = (getAssumption('Tax Rate')?.[field] || 25) / 100;
        const capexPct = (getAssumption('Capex as % of Revenue')?.[field] || 5) / 100;
        const daPct = (getAssumption('D&A as % of Revenue')?.[field] || 8) / 100;
        const wcPct = (getAssumption('Working Capital as % of Revenue')?.[field] || 10) / 100;
        const controlPremium = (getAssumption('Control Premium')?.[field] || 25) / 100;

        const dcfInputs = {
          revenueGrowth: growthRates,
          ebitdaMargins,
          wacc, terminalGrowthRate: termGrowth, taxRate, capexPct, daPct, wcPct,
          totalDebt: latest.total_debt || 0,
          cash: 0
        };

        // Run math engine
        const dcf = calcDCF({ revenue: latest.revenue, ebitda: latest.ebitda, ebitda_margin_pct: latest.ebitda_margin_pct }, dcfInputs);
        const tradingComps = comps.length > 0 ? calcTradingComps(target, comps) : null;
        const precedent = transactions.length > 0 ? calcPrecedentTransactions(target, transactions, controlPremium) : null;
        const footballField = calcFootballField(dcf, tradingComps, precedent);

        // IRR/MOIC
        const entryPrice = deal.deal_size_estimate || footballField.blendedValue?.weighted || 500;
        const exitValue = footballField.blendedValue?.weighted || dcf.enterpriseValue;
        const holdingYears = 5;
        const cashFlows = [-entryPrice, ...Array(holdingYears - 1).fill(0), exitValue];
        let irr = 0, moic = 0;
        try { irr = calcIRR(cashFlows); } catch (_) {}
        try { moic = calcMOIC(exitValue, entryPrice); } catch (_) {}

        // Sensitivity grid — centered on scenario WACC / terminal growth
        const waccCenter = dcfInputs.wacc;
        const tgCenter   = dcfInputs.terminalGrowthRate;
        const waccValues = [-0.02, -0.01, 0, 0.01, 0.02].map(d => +(waccCenter + d).toFixed(4));
        const growthValues = [-0.01, -0.005, 0, 0.005, 0.01].map(d => +(tgCenter + d).toFixed(4));
        const rawSensGrid = sensitivityGrid(dcfInputs, 'wacc', waccValues, 'terminalGrowthRate', growthValues, (a) => {
          return calcDCF({ revenue: latest.revenue, ebitda: latest.ebitda, ebitda_margin_pct: latest.ebitda_margin_pct }, a).enterpriseValue;
        });
        // Normalize to the shape the UI renders
        const sensGrid = rawSensGrid ? {
          param1Name: rawSensGrid.param1Name,
          param2Name: rawSensGrid.param2Name,
          columns: rawSensGrid.param2Values,
          rows: rawSensGrid.rows.map(r => ({
            label: r[rawSensGrid.param1Name],
            values: (r.values || []).map(c => (typeof c === 'object' ? c.value : c)),
          })),
        } : null;

        const outputsJson = JSON.stringify({ dcf, tradingComps, precedent, footballField, irr, moic, sensitivity: sensGrid });
        const inputsJson = JSON.stringify({ financials: latest, assumptions: dcfInputs, compsCount: comps.length, transactionsCount: transactions.length });
        const validationJson = JSON.stringify({
          passed: true,
          flags: dcf.enterpriseValue > 0 ? [] : [{ severity: 'error', message: 'Negative enterprise value' }],
          summary: `${scenario} case: EV = $${dcf.enterpriseValue?.toFixed(0)}M (DCF), Blended = $${footballField.blendedValue?.weighted?.toFixed(0)}M`
        });

        req.db.run(
          `INSERT INTO model_runs (deal_id, scenario, template_name, template_version, inputs_json, outputs_json, validation_json, approval_state, created_by)
           VALUES (?, ?, 'standard_dcf', '1.0', ?, ?, ?, 'pending', 'agent')`,
          req.params.dealId, scenario, inputsJson, outputsJson, validationJson
        );

        // Update model_outputs
        req.db.run('DELETE FROM model_outputs WHERE deal_id = ? AND scenario = ?', req.params.dealId, scenario);
        const metrics = [
          ['DCF Enterprise Value', dcf.enterpriseValue, '$M', 'dcf'],
          ['Trading Comps Implied EV', tradingComps?.impliedValues?.evEbitda?.mid, '$M', 'trading_comps'],
          ['Precedent Transactions Implied EV', precedent?.impliedValues?.evEbitda?.mid, '$M', 'precedent_transactions'],
          ['Blended Valuation', footballField.blendedValue?.weighted, '$M', 'football_field'],
          ['Implied IRR', irr * 100, '%', 'irr_calculation'],
          ['MOIC', moic, 'x', 'moic_calculation']
        ];
        for (const [name, value, unit, method] of metrics) {
          if (value != null && isFinite(value)) {
            req.db.run(
              `INSERT INTO model_outputs (deal_id, scenario, metric_name, metric_value, unit, calculation_method, confidence_score, data_source) VALUES (?, ?, ?, ?, ?, ?, 0.8, 'calculated')`,
              req.params.dealId, scenario, name, Math.round(value * 100) / 100, unit, method
            );
          }
        }
      }

      onProgress(95, 'Finalizing');
      auditLog(req.db, 'model.built', 'model_runs', req.params.dealId, 'agent', { scenarios: ['base', 'upside', 'downside'] });
      onProgress(100, 'Complete');
      return { success: true, scenarios: 3 };
    }).catch(err => {
      console.error('Model build failed:', err);
    });

    res.json({ success: true, jobId, message: 'Model build started for all 3 scenarios' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start build', details: err.message });
  }
});

// Recalculate with modified assumptions (synchronous, uses math engine)
router.post('/recalculate/:dealId', (req, res) => {
  try {
    const deal = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', req.params.dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const { assumptions, scenario } = req.body;
    if (!assumptions) return res.status(400).json({ error: 'assumptions object required' });

    const financials = req.db.all('SELECT * FROM target_company_financials WHERE deal_id = ? ORDER BY period DESC', req.params.dealId);
    const comps = req.db.all('SELECT * FROM comparable_companies WHERE sector = ?', deal.sector);
    const transactions = req.db.all('SELECT * FROM comparable_transactions WHERE sector = ?', deal.sector);

    if (financials.length === 0) return res.status(400).json({ error: 'No financial data' });
    const latest = financials[0];
    const target = { revenue: latest.revenue, ebitda: latest.ebitda, netIncome: latest.net_income };

    const dcf = calcDCF({ revenue: latest.revenue, ebitda: latest.ebitda, ebitda_margin_pct: latest.ebitda_margin_pct }, assumptions);
    const tradingComps = comps.length > 0 ? calcTradingComps(target, comps) : null;
    const precedent = transactions.length > 0 ? calcPrecedentTransactions(target, transactions, assumptions.controlPremium || 0) : null;
    const footballField = calcFootballField(dcf, tradingComps, precedent);

    res.json({
      success: true,
      scenario: scenario || 'custom',
      dcf,
      tradingComps,
      precedent,
      footballField
    });
  } catch (err) {
    res.status(500).json({ error: 'Recalculation failed', details: err.message });
  }
});

router.get('/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

export default router;
