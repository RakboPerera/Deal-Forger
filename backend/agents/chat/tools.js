/**
 * Chat tools for querying deal data.
 * Each tool follows the Anthropic tool-use format:
 *   { name, description, input_schema, handler(input) }
 *
 * The getChatTools factory binds the database instance so handlers
 * can query directly without the caller managing the connection.
 */


/**
 * Create chat tool definitions bound to a database instance.
 * @param {Object} db - better-sqlite3 (or compatible) database instance
 * @returns {Array<Object>} Array of tool definitions with handlers
 */
export function getChatTools(db) {
  return [
    // ------------------------------------------------------------------
    // 1. query_deal
    // ------------------------------------------------------------------
    {
      name: 'query_deal',
      description: 'Get full context for a specific deal including financials, assumptions, model outputs, and pipeline status. Returns the deal record, latest financials, key assumptions, and current stage.',
      input_schema: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal_id from the deal_pipeline table',
          },
        },
        required: ['deal_id'],
      },
      handler: async (input) => {
        const { deal_id } = input;

        const deal = db.prepare(
          'SELECT * FROM deal_pipeline WHERE deal_id = ?'
        ).get(deal_id);

        if (!deal) {
          return { error: `Deal "${deal_id}" not found` };
        }

        // Latest financials (most recent period)
        const financials = db.prepare(
          `SELECT * FROM target_company_financials
           WHERE deal_id = ?
           ORDER BY period DESC
           LIMIT 3`
        ).all(deal_id);

        // Key assumptions
        const assumptions = db.prepare(
          `SELECT assumption_name, base_case, upside_case, downside_case, unit, source_rationale
           FROM valuation_assumptions
           WHERE deal_id = ?
           ORDER BY assumption_name`
        ).all(deal_id);

        // Latest model run
        const latestRun = db.prepare(
          `SELECT id, scenario, template_name, approval_state, created_at
           FROM model_runs
           WHERE deal_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        ).get(deal_id);

        // Document count
        const docCount = db.prepare(
          'SELECT COUNT(*) as count FROM deal_documents WHERE deal_id = ?'
        ).get(deal_id);

        return {
          deal,
          financials,
          assumptions,
          latestModelRun: latestRun || null,
          documentCount: docCount?.count || 0,
        };
      },
    },

    // ------------------------------------------------------------------
    // 2. query_model_outputs
    // ------------------------------------------------------------------
    {
      name: 'query_model_outputs',
      description: 'Get model valuation outputs for a deal, optionally filtered by scenario (base, upside, downside). Returns all metrics including enterprise value, equity value, implied multiples, IRR, and MOIC.',
      input_schema: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal_id to query outputs for',
          },
          scenario: {
            type: 'string',
            enum: ['base', 'upside', 'downside'],
            description: 'Filter to a specific scenario. Omit to get all scenarios.',
          },
        },
        required: ['deal_id'],
      },
      handler: async (input) => {
        const { deal_id, scenario } = input;

        let query = `SELECT metric_name, metric_value, unit, scenario, calculation_method, confidence_score
                     FROM model_outputs
                     WHERE deal_id = ?`;
        const params = [deal_id];

        if (scenario) {
          query += ' AND scenario = ?';
          params.push(scenario);
        }

        query += ' ORDER BY scenario, metric_name';

        const outputs = db.prepare(query).all(...params);

        if (outputs.length === 0) {
          return { error: `No model outputs found for deal "${deal_id}"${scenario ? ` scenario "${scenario}"` : ''}` };
        }

        // Group by scenario for easier consumption
        const grouped = {};
        for (const row of outputs) {
          if (!grouped[row.scenario]) {
            grouped[row.scenario] = {};
          }
          grouped[row.scenario][row.metric_name] = {
            value: row.metric_value,
            unit: row.unit,
            method: row.calculation_method,
            confidence: row.confidence_score,
          };
        }

        return { deal_id, outputs: grouped };
      },
    },

    // ------------------------------------------------------------------
    // 3. compare_scenarios
    // ------------------------------------------------------------------
    {
      name: 'compare_scenarios',
      description: 'Compare valuation metrics across scenarios (base, upside, downside) for a deal. Shows side-by-side values and computes deltas between scenarios.',
      input_schema: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal_id to compare scenarios for',
          },
          metrics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of specific metric names to compare. If omitted, compares all available metrics.',
          },
        },
        required: ['deal_id'],
      },
      handler: async (input) => {
        const { deal_id, metrics } = input;

        let query = `SELECT metric_name, metric_value, unit, scenario
                     FROM model_outputs
                     WHERE deal_id = ?`;
        const params = [deal_id];

        if (metrics && metrics.length > 0) {
          const placeholders = metrics.map(() => '?').join(',');
          query += ` AND metric_name IN (${placeholders})`;
          params.push(...metrics);
        }

        query += ' ORDER BY metric_name, scenario';

        const rows = db.prepare(query).all(...params);

        if (rows.length === 0) {
          return { error: `No model outputs found for deal "${deal_id}"` };
        }

        // Pivot: metric_name -> { base, upside, downside, delta_up, delta_down }
        const comparison = {};
        for (const row of rows) {
          if (!comparison[row.metric_name]) {
            comparison[row.metric_name] = { unit: row.unit, base: null, upside: null, downside: null };
          }
          comparison[row.metric_name][row.scenario] = row.metric_value;
        }

        // Compute deltas
        for (const [name, values] of Object.entries(comparison)) {
          if (values.base != null && values.upside != null) {
            values.delta_upside = round(values.upside - values.base, 2);
            values.delta_upside_pct = values.base !== 0
              ? round(((values.upside - values.base) / Math.abs(values.base)) * 100, 1)
              : null;
          }
          if (values.base != null && values.downside != null) {
            values.delta_downside = round(values.downside - values.base, 2);
            values.delta_downside_pct = values.base !== 0
              ? round(((values.downside - values.base) / Math.abs(values.base)) * 100, 1)
              : null;
          }
        }

        return { deal_id, comparison };
      },
    },

    // ------------------------------------------------------------------
    // 4. query_comps_for_deal
    // ------------------------------------------------------------------
    {
      name: 'query_comps_for_deal',
      description: 'Get comparable companies and precedent transactions relevant to a deal, based on the deal sector. Returns trading multiples, growth rates, and transaction premiums.',
      input_schema: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal_id to find comps for',
          },
        },
        required: ['deal_id'],
      },
      handler: async (input) => {
        const { deal_id } = input;

        // Get the deal to find its sector
        const deal = db.prepare(
          'SELECT sector FROM deal_pipeline WHERE deal_id = ?'
        ).get(deal_id);

        if (!deal) {
          return { error: `Deal "${deal_id}" not found` };
        }

        // Get comparable companies in the same sector
        const comps = db.prepare(
          `SELECT company_name, ticker, sector, ev_ebitda, ev_revenue, pe_ratio,
                  revenue_growth_pct, ebitda_margin_pct, market_cap, as_of_date
           FROM comparable_companies
           WHERE sector = ?
           ORDER BY market_cap DESC`
        ).all(deal.sector);

        // Get precedent transactions in the same sector
        const transactions = db.prepare(
          `SELECT transaction_name, acquirer, target, sector, deal_value,
                  ev_ebitda, ev_revenue, premium_pct, announcement_date
           FROM comparable_transactions
           WHERE sector = ?
           ORDER BY announcement_date DESC`
        ).all(deal.sector);

        return {
          deal_id,
          sector: deal.sector,
          comparableCompanies: comps,
          precedentTransactions: transactions,
        };
      },
    },

    // ------------------------------------------------------------------
    // 5. find_similar_deals
    // ------------------------------------------------------------------
    {
      name: 'find_similar_deals',
      description: 'Search the deal pipeline for deals matching criteria such as sector, stage, or deal size range. Useful for finding comparable internal deals.',
      input_schema: {
        type: 'object',
        properties: {
          sector: {
            type: 'string',
            description: 'Filter by sector (e.g., "Technology", "Healthcare")',
          },
          stage: {
            type: 'string',
            enum: ['screening', 'due_diligence', 'negotiation', 'closed', 'passed'],
            description: 'Filter by deal stage',
          },
          min_size: {
            type: 'number',
            description: 'Minimum deal size estimate ($M)',
          },
          max_size: {
            type: 'number',
            description: 'Maximum deal size estimate ($M)',
          },
        },
      },
      handler: async (input) => {
        const { sector, stage, min_size, max_size } = input;

        const conditions = [];
        const params = [];

        if (sector) {
          conditions.push('sector = ?');
          params.push(sector);
        }
        if (stage) {
          conditions.push('stage = ?');
          params.push(stage);
        }
        if (min_size != null) {
          conditions.push('deal_size_estimate >= ?');
          params.push(min_size);
        }
        if (max_size != null) {
          conditions.push('deal_size_estimate <= ?');
          params.push(max_size);
        }

        let query = `SELECT deal_id, deal_name, stage, sector, target_company,
                            deal_size_estimate, lead_analyst, date_entered, expected_close
                     FROM deal_pipeline`;

        if (conditions.length > 0) {
          query += ` WHERE ${conditions.join(' AND ')}`;
        }

        query += ' ORDER BY date_entered DESC LIMIT 20';

        const deals = db.prepare(query).all(...params);

        if (deals.length === 0) {
          return { message: 'No deals found matching the specified criteria', criteria: input };
        }

        return { deals, count: deals.length };
      },
    },

    // ------------------------------------------------------------------
    // 6. summarize_assumptions
    // ------------------------------------------------------------------
    {
      name: 'summarize_assumptions',
      description: 'Get all key assumptions for a deal with their values across scenarios and the rationale behind each. Useful for understanding the model inputs and agent reasoning.',
      input_schema: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal_id to get assumptions for',
          },
        },
        required: ['deal_id'],
      },
      handler: async (input) => {
        const { deal_id } = input;

        const assumptions = db.prepare(
          `SELECT assumption_name, base_case, upside_case, downside_case,
                  unit, source_rationale, data_source, updated_at
           FROM valuation_assumptions
           WHERE deal_id = ?
           ORDER BY assumption_name`
        ).all(deal_id);

        if (assumptions.length === 0) {
          return { error: `No assumptions found for deal "${deal_id}"` };
        }

        // Separate into categories for clearer presentation
        const categorized = {
          growth: [],
          margins: [],
          discount_rate: [],
          other: [],
        };

        for (const a of assumptions) {
          const name = a.assumption_name.toLowerCase();
          if (name.includes('growth') || name.includes('revenue')) {
            categorized.growth.push(a);
          } else if (name.includes('margin') || name.includes('ebitda')) {
            categorized.margins.push(a);
          } else if (name.includes('wacc') || name.includes('terminal') || name.includes('discount')) {
            categorized.discount_rate.push(a);
          } else {
            categorized.other.push(a);
          }
        }

        // Count user-edited vs agent-generated
        const userEdited = assumptions.filter((a) => a.data_source === 'manual').length;
        const agentGenerated = assumptions.filter((a) => a.data_source === 'agent').length;

        return {
          deal_id,
          totalAssumptions: assumptions.length,
          userEdited,
          agentGenerated,
          categorized,
          allAssumptions: assumptions,
        };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function round(value, decimals) {
  if (value == null || !isFinite(value)) return value;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
