import { useState, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Download, RefreshCw,
  AlertTriangle, TrendingUp
} from 'lucide-react';

// ============================================================
// Helper: Editable cell for assumptions
// ============================================================
function EditableCell({ value, onChange, type = 'text' }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = () => {
    setEditValue(value != null ? String(value) : '');
    setEditing(true);
  };

  const save = () => {
    setEditing(false);
    const newVal = type === 'number'
      ? (editValue === '' ? null : parseFloat(editValue))
      : editValue;
    if (newVal !== value) onChange(newVal);
  };

  if (editing) {
    return (
      <input
        type={type === 'number' ? 'number' : 'text'}
        step="any"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => e.key === 'Enter' && save()}
        autoFocus
        style={{ width: '100%', padding: '4px 6px', fontSize: '0.8rem' }}
      />
    );
  }

  return (
    <span
      className="cursor-pointer"
      onClick={startEdit}
      title="Click to edit"
    >
      {value != null && value !== '' ? value : '-'}
    </span>
  );
}

// ============================================================
// Helper: Accordion section
// ============================================================
function Section({ title, defaultOpen = false, children, badge }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="card mb-3"
      style={{ overflow: 'hidden' }}
    >
      <div
        className="flex items-center justify-between cursor-pointer"
        style={{ padding: '12px 16px' }}
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="font-semibold" style={{ fontSize: '0.9rem' }}>{title}</span>
          {badge}
        </div>
      </div>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Cell CSS class helper
// ============================================================
function cellClass(type) {
  switch (type) {
    case 'assumption': return 'cell-assumption';
    case 'historical': return 'cell-historical';
    case 'flagged': return 'cell-flagged';
    default: return 'cell-calculated';
  }
}

// ============================================================
// Sensitivity heatmap color
// ============================================================
function heatmapColor(value, min, max) {
  if (value == null || isNaN(value)) return 'transparent';
  const range = max - min;
  if (range === 0) return '#fef3c7';
  const ratio = (value - min) / range;
  // Green for high, red for low
  const r = Math.round(239 - ratio * 200);
  const g = Math.round(68 + ratio * 112);
  const b = Math.round(68);
  return `rgba(${r}, ${g}, ${b}, 0.15)`;
}

// ============================================================
// Format number for display
// ============================================================
function fmtPct(val) {
  if (val == null || val === '' || isNaN(val)) return '-';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '-';
  return `${num.toFixed(1)}%`;
}

// ============================================================
// Main ModelView Component
// ============================================================
export default function ModelView({
  dealId,
  modelRun,
  assumptions = [],
  onAssumptionChange,
  onRecalculate,
}) {
  const [activeScenario, setActiveScenario] = useState('Base');

  // Parse model data
  const outputs = useMemo(() => {
    if (!modelRun?.outputs_json) return {};
    try {
      return typeof modelRun.outputs_json === 'string'
        ? JSON.parse(modelRun.outputs_json)
        : modelRun.outputs_json;
    } catch { return {}; }
  }, [modelRun]);

  const inputs = useMemo(() => {
    if (!modelRun?.inputs_json) return {};
    try {
      return typeof modelRun.inputs_json === 'string'
        ? JSON.parse(modelRun.inputs_json)
        : modelRun.inputs_json;
    } catch { return {}; }
  }, [modelRun]);

  // Get scenario-specific data or fallback to base
  const scenarioKey = activeScenario.toLowerCase();
  const scenarioOutputs = outputs[scenarioKey] || outputs.base || outputs;
  const revenueProjections = scenarioOutputs.revenue_projections || scenarioOutputs.projections || [];
  const dcfWaterfall = scenarioOutputs.dcf_waterfall || scenarioOutputs.dcf || {};
  const terminalValue = scenarioOutputs.terminal_value || scenarioOutputs.terminal || {};
  const valuationSummary = scenarioOutputs.valuation_summary || scenarioOutputs.valuation || {};
  const sensitivityData = scenarioOutputs.sensitivity || outputs.sensitivity || {};
  const validationFlags = modelRun?.validation_flags || outputs.validation_flags || [];

  const scenarios = ['Base', 'Upside', 'Downside'];

  return (
    <div>
      {/* Scenario tabs */}
      <div className="flex items-center justify-between mb-3">
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
          {scenarios.map(s => (
            <button
              key={s}
              className={`tab ${activeScenario === s ? 'active' : ''}`}
              onClick={() => setActiveScenario(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm"
            onClick={() => alert('Export to Excel - coming soon')}
          >
            <Download size={14} /> Export
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => onRecalculate && onRecalculate(assumptions)}
          >
            <RefreshCw size={14} /> Recalculate
          </button>
        </div>
      </div>

      {/* Validation warnings */}
      {validationFlags.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '10px 14px',
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: '0.8rem',
            color: '#92400e',
          }}
        >
          {validationFlags.map((flag, i) => (
            <div key={i} className="flex items-center gap-2">
              <AlertTriangle size={14} />
              <span>{typeof flag === 'string' ? flag : flag.message || flag.description || JSON.stringify(flag)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 1. Key Assumptions */}
      <Section title="Key Assumptions" defaultOpen={true}>
        {assumptions.length > 0 ? (
          <table className="data-table mt-2">
            <thead>
              <tr>
                <th>Assumption</th>
                <th>Value</th>
                <th>Unit</th>
                <th>Source / Rationale</th>
              </tr>
            </thead>
            <tbody>
              {assumptions.map((a, i) => (
                <tr key={a.id || i}>
                  <td className="font-semibold">{a.parameter || a.name || '-'}</td>
                  <td
                    className={cellClass('assumption')}
                    title={a.formula || a.source || 'Editable assumption'}
                  >
                    <EditableCell
                      value={a.value}
                      type="number"
                      onChange={(val) => onAssumptionChange && onAssumptionChange(a.id || i, val)}
                    />
                  </td>
                  <td className="text-muted">{a.unit || '-'}</td>
                  <td className="text-muted text-sm">{a.notes || a.description || a.source || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted mt-2">No assumptions defined. Build a model to generate assumptions.</p>
        )}
      </Section>

      {/* 2. Revenue Build */}
      <Section title="Revenue Build">
        {revenueProjections.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table mt-2">
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="text-right">Revenue ($M)</th>
                  <th className="text-right">Growth %</th>
                  <th className="text-right">EBITDA ($M)</th>
                  <th className="text-right">EBITDA Margin</th>
                </tr>
              </thead>
              <tbody>
                {revenueProjections.map((row, i) => (
                  <tr key={i}>
                    <td className="font-semibold">{row.year || row.period || `Year ${i + 1}`}</td>
                    <td className="text-right" title={row.revenue_formula || ''}>{fmtM(row.revenue)}</td>
                    <td className="text-right">{fmtPct(row.growth || row.revenue_growth)}</td>
                    <td className="text-right" title={row.ebitda_formula || ''}>{fmtM(row.ebitda)}</td>
                    <td className="text-right">{fmtPct(row.ebitda_margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted mt-2">No revenue projections available.</p>
        )}
      </Section>

      {/* 3. DCF Waterfall */}
      <Section title="DCF Waterfall">
        {Object.keys(dcfWaterfall).length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table mt-2">
              <thead>
                <tr>
                  <th>Line Item</th>
                  <th className="text-right">Value ($M)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Revenue', key: 'revenue' },
                  { label: 'EBITDA', key: 'ebitda' },
                  { label: 'D&A', key: 'depreciation' },
                  { label: 'EBIT', key: 'ebit' },
                  { label: 'Tax', key: 'tax' },
                  { label: 'NOPAT', key: 'nopat' },
                  { label: 'Capex', key: 'capex' },
                  { label: 'WC Change', key: 'wc_change' },
                  { label: 'FCF', key: 'fcf', bold: true },
                  { label: 'PV of FCF', key: 'pv_fcf', bold: true },
                ].map(item => (
                  <tr key={item.key}>
                    <td
                      className={item.bold ? 'font-bold' : ''}
                      style={item.bold ? { borderTop: '2px solid var(--border)' } : {}}
                    >
                      {item.label}
                    </td>
                    <td
                      className="text-right"
                      style={item.bold ? { borderTop: '2px solid var(--border)', fontWeight: 700 } : {}}
                      title={dcfWaterfall[`${item.key}_formula`] || ''}
                    >
                      {fmtM(dcfWaterfall[item.key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted mt-2">No DCF waterfall data available.</p>
        )}
      </Section>

      {/* 4. Terminal Value */}
      <Section title="Terminal Value">
        {Object.keys(terminalValue).length > 0 ? (
          <table className="data-table mt-2">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Terminal FCF', val: fmtM(terminalValue.terminal_fcf) },
                { label: 'Growth Rate', val: fmtPct(terminalValue.growth_rate) },
                { label: 'WACC', val: fmtPct(terminalValue.wacc) },
                { label: 'Terminal Value', val: fmtM(terminalValue.terminal_value), bold: true },
                { label: 'PV of Terminal Value', val: fmtM(terminalValue.pv_terminal_value), bold: true },
                { label: '% of Total EV', val: fmtPct(terminalValue.pct_of_ev) },
              ].map((r, i) => (
                <tr key={i}>
                  <td className={r.bold ? 'font-bold' : ''}>{r.label}</td>
                  <td className={`text-right ${r.bold ? 'font-bold' : ''}`}>{r.val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted mt-2">No terminal value data available.</p>
        )}
      </Section>

      {/* 5. Valuation Summary */}
      <Section title="Valuation Summary" defaultOpen={true}>
        {Object.keys(valuationSummary).length > 0 ? (
          <table className="data-table mt-2">
            <thead>
              <tr>
                <th>Methodology</th>
                <th className="text-right">Enterprise Value ($M)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'DCF', val: valuationSummary.dcf_ev },
                { label: 'Trading Comps', val: valuationSummary.trading_comps_ev },
                { label: 'Precedent Transactions', val: valuationSummary.precedent_trans_ev },
                { label: 'Blended EV', val: valuationSummary.blended_ev, bold: true },
                { label: 'Equity Value', val: valuationSummary.equity_value, bold: true },
              ].map((r, i) => (
                <tr
                  key={i}
                  style={r.bold ? { background: 'var(--primary-light)' } : {}}
                >
                  <td className={r.bold ? 'font-bold' : ''}>{r.label}</td>
                  <td className={`text-right ${r.bold ? 'font-bold' : ''}`}>{fmtM(r.val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted mt-2">No valuation summary available.</p>
        )}
      </Section>

      {/* 6. Sensitivity Grid */}
      <Section title="Sensitivity Analysis">
        <SensitivityGrid data={sensitivityData} />
      </Section>
    </div>
  );
}

// ============================================================
// Sensitivity Grid Sub-component (uses module-scoped fmtM below)
// ============================================================
function SensitivityGrid({ data }) {
  if (!data || !data.grid) {
    // Fallback: generate a sample grid if wacc_range and growth_range exist
    if (!data?.wacc_range || !data?.growth_range) {
      return <p className="text-sm text-muted mt-2">No sensitivity data available.</p>;
    }
  }

  const waccRange = data.wacc_range || [8, 9, 10, 11, 12];
  const growthRange = data.growth_range || [1, 1.5, 2, 2.5, 3];
  const grid = data.grid || [];

  // Find min/max for heatmap coloring
  let allValues = [];
  if (grid.length > 0) {
    grid.forEach(row => {
      if (Array.isArray(row)) {
        row.forEach(v => { if (v != null && !isNaN(v)) allValues.push(v); });
      }
    });
  }
  const min = allValues.length > 0 ? Math.min(...allValues) : 0;
  const max = allValues.length > 0 ? Math.max(...allValues) : 100;

  return (
    <div style={{ overflowX: 'auto' }} className="mt-2">
      <div className="text-xs text-muted mb-2 flex items-center gap-2">
        <TrendingUp size={14} />
        WACC (columns) vs Terminal Growth Rate (rows)
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ background: 'var(--text)', color: '#fff', fontSize: '0.7rem' }}>
              Growth \ WACC
            </th>
            {waccRange.map((w, i) => (
              <th key={i} className="text-right" style={{ fontSize: '0.75rem' }}>
                {typeof w === 'number' ? `${w.toFixed(1)}%` : w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {growthRange.map((g, ri) => (
            <tr key={ri}>
              <td
                className="font-semibold"
                style={{ background: 'var(--bg-secondary)', fontSize: '0.8rem' }}
              >
                {typeof g === 'number' ? `${g.toFixed(1)}%` : g}
              </td>
              {waccRange.map((_, ci) => {
                const val = grid[ri] && grid[ri][ci] != null ? grid[ri][ci] : null;
                return (
                  <td
                    key={ci}
                    className="text-right font-mono"
                    style={{
                      background: heatmapColor(val, min, max),
                      fontSize: '0.8rem',
                    }}
                    title={val != null ? `$${val.toFixed(1)}M (Growth: ${g}%, WACC: ${waccRange[ci]}%)` : ''}
                  >
                    {val != null ? fmtM(val) : '-'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-2" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
        <span>Low</span>
        <div style={{
          width: 80,
          height: 8,
          borderRadius: 4,
          background: 'linear-gradient(90deg, rgba(239,68,68,0.15), rgba(16,185,129,0.15))',
        }} />
        <span>High</span>
      </div>
    </div>
  );
}

function fmtM(val) {
  if (val == null || val === '' || isNaN(val)) return '-';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '-';
  return `$${num.toFixed(1)}M`;
}
