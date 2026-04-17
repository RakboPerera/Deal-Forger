import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getPipelineSummary, getSectorDistribution, getValuationRanges,
  getRecentActivity, getCounts, getDeals, getOutputs,
  getValuationGap, getIrrRanking, getSectorMultiples, getGrowthMargin,
  getInsights
} from '../api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell,
  ResponsiveContainer, Legend, CartesianGrid, Scatter, ScatterChart, ZAxis,
  ReferenceLine
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Activity, PieChart as PieIcon,
  BarChart3, Clock, Briefcase, Database, RefreshCw, Target, Zap,
  ShieldCheck, AlertTriangle, ArrowUpRight, ArrowDownRight, Equal,
  FileText
} from 'lucide-react';

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const STAGE_COLORS = {
  screening: '#2563eb',
  due_diligence: '#f59e0b',
  negotiation: '#8b5cf6',
  closed: '#10b981',
  passed: '#94a3b8',
};
const STAGE_ORDER = ['screening', 'due_diligence', 'negotiation', 'closed', 'passed'];

const SIGNAL_COLORS = {
  upside: { bg: '#d1fae5', fg: '#065f46', icon: ArrowUpRight, label: 'Upside' },
  risk:   { bg: '#fee2e2', fg: '#991b1b', icon: ArrowDownRight, label: 'Overpriced' },
  fair:   { bg: '#f1f5f9', fg: '#475569', icon: Equal, label: 'Fair' },
};

function prettyStage(s) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function fmtMoney(v) {
  if (v == null || isNaN(v)) return '-';
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}B`;
  return `$${Number(v).toFixed(0)}M`;
}
function fmtPct(v, digits = 1) {
  if (v == null || isNaN(v)) return '-';
  return `${Number(v).toFixed(digits)}%`;
}

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, icon: Icon, color, trend }) {
  return (
    <div style={styles.statCard}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.statLabel}>{label}</div>
          <div style={styles.statValue}>{value}</div>
          {sub && <div style={styles.statSub}>{sub}</div>}
        </div>
        {Icon && (
          <div style={{
            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
            background: color || '#eff6ff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={20} style={{ color: color ? '#fff' : '#2563eb' }} />
          </div>
        )}
      </div>
      {trend && (
        <div style={{ marginTop: 8, fontSize: '0.72rem', color: trend.positive ? '#10b981' : '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>
          {trend.positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {trend.text}
        </div>
      )}
    </div>
  );
}

/* ── Activity ────────────────────────────────────────────────── */
function ActivityItem({ item }) {
  const typeColors = {
    'deal.created': '#2563eb',
    'deal.updated': '#10b981',
    'deal.closed':  '#10b981',
    'deal.passed':  '#94a3b8',
    'model.built':  '#8b5cf6',
    'document.uploaded': '#f59e0b',
    'extraction.completed': '#06b6d4',
    'hitl.approved': '#10b981',
    'hitl.changes_requested': '#f59e0b',
  };
  const dotColor = typeColors[item.event_type] || '#94a3b8';

  let details = {};
  try { details = typeof item.details_json === 'string' ? JSON.parse(item.details_json) : (item.details_json || {}); } catch {}
  const description = describe(item.event_type, item.entity_id, details);

  return (
    <div style={styles.activityItem}>
      <div style={{ ...styles.activityDot, background: dotColor }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', color: '#1e293b' }}>{description}</div>
        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          {item.actor && <span style={styles.actorBadge}>{item.actor}</span>}
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Clock size={10} />
            {item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Recently'}
          </span>
        </div>
      </div>
    </div>
  );
}
function describe(ev, id, details) {
  switch (ev) {
    case 'deal.created':   return `Deal ${id} created — ${details.deal_name || ''} (${details.sector || 'N/A'})`;
    case 'deal.closed':    return `Deal ${id} closed at ${details.multiple || '-'} — $${details.deal_value || '-'}M`;
    case 'deal.passed':    return `Deal ${id} passed — ${details.reason || 'no reason given'}`;
    case 'extraction.completed': return `Extraction complete for ${details.deal_id || id} — ${details.financials_loaded || '-'} periods loaded`;
    case 'model.built':    return `Model built for ${details.deal_id || id} — ${details.scenarios || 3} scenarios`;
    case 'hitl.approved':  return `Review approved for ${id} (${details.scenario || details.entity_type || ''})`;
    case 'hitl.changes_requested': return `Changes requested on ${id}`;
    case 'document.uploaded': return `${details.count || 1} document(s) uploaded to ${id}`;
    case 'system.seed':    return `System seeded sample data (v${details.version || '1'})`;
    default: return `${ev?.replace(/[._]/g, ' ')} — ${id || ''}`;
  }
}

/* ── Main Dashboard ──────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState([]);
  const [sectorDist, setSectorDist] = useState([]);
  const [valuations, setValuations] = useState([]);
  const [activity, setActivity] = useState([]);
  const [counts, setCounts] = useState({});
  const [deals, setDeals] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [gap, setGap] = useState([]);
  const [irrRank, setIrrRank] = useState([]);
  const [sectorMult, setSectorMult] = useState([]);
  const [growthMargin, setGrowthMargin] = useState([]);
  const [insights, setInsights] = useState({});
  const [loading, setLoading] = useState(true);

  // Resilient fetch — if a request fails (rate-limited, network blip,
  // backend restart mid-session), keep the last good value instead of
  // replacing it with an empty array. That way insights don't disappear
  // after a few click-throughs.
  const fetchAll = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    const results = await Promise.allSettled([
      getPipelineSummary(),
      getSectorDistribution(),
      getValuationRanges(),
      getRecentActivity(25),
      getCounts(),
      getDeals(),
      getOutputs(),
      getValuationGap(),
      getIrrRanking(),
      getSectorMultiples(),
      getGrowthMargin(),
      getInsights(),
    ]);

    const keep = (result, setter, fallbackIsArray = true) => {
      if (result.status === 'fulfilled' && result.value != null) {
        const val = result.value;
        setter(fallbackIsArray ? (Array.isArray(val) ? val : []) : (val || {}));
      }
      // On rejection: leave the state as-is (don't clobber with [])
    };

    keep(results[0],  setPipeline);
    keep(results[1],  setSectorDist);
    keep(results[2],  setValuations);
    keep(results[3],  setActivity);
    keep(results[4],  setCounts,       false);
    keep(results[5],  setDeals);
    keep(results[6],  setOutputs);
    keep(results[7],  setGap);
    keep(results[8],  setIrrRank);
    keep(results[9],  setSectorMult);
    keep(results[10], setGrowthMargin);
    keep(results[11], setInsights,     false);

    if (isInitial) setLoading(false);
  };

  // Initial load
  useEffect(() => { fetchAll(true); }, []);

  // Light-touch auto-refresh every 60s. We use Promise.allSettled so a single
  // failed endpoint doesn't blank the rest of the dashboard.
  useEffect(() => {
    const t = setInterval(() => fetchAll(false), 60000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div style={styles.loadingCenter}>
        <RefreshCw size={28} style={{ color: '#2563eb', animation: 'spin 1s linear infinite' }} />
        <p style={{ marginTop: 12, color: '#64748b', fontSize: '0.9rem' }}>Loading dashboard...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Pipeline chart data
  const pipelineChartData = STAGE_ORDER
    .map(sk => {
      const found = pipeline.find(x => x.stage === sk);
      return found ? {
        name: prettyStage(sk),
        stage: sk,
        count: found.count || 0,
        value: found.total_value || 0,
      } : null;
    })
    .filter(Boolean);

  // Sector pie data
  const sectorChartData = sectorDist.map((s, i) => ({
    name: s.sector || `Sector ${i + 1}`,
    value: s.count || 0,
    totalValue: s.total_value || 0,
  }));

  // Valuation ranges bar
  const valuationChartData = valuations
    .filter(v => v.valuations?.length > 0)
    .map(v => {
      const row = { name: v.deal_name || v.deal_id, estimate: v.deal_size_estimate };
      (v.valuations || []).forEach(val => {
        const s = (val.scenario || '').toLowerCase();
        if (s === 'base')     row.base = val.metric_value;
        if (s === 'upside')   row.upside = val.metric_value;
        if (s === 'downside') row.downside = val.metric_value;
      });
      return row;
    })
    .filter(r => r.base || r.upside || r.downside);

  // Growth-margin scatter data
  const scatterData = growthMargin.map(g => ({
    x: g.revenue_growth_pct ?? 0,
    y: g.ebitda_margin_pct ?? 0,
    z: g.revenue || 1,
    name: g.company_name,
    deal_id: g.deal_id,
  })).filter(p => p.x || p.y);

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.headerSection}>
        <div style={{ flex: 1 }}>
          <h2 style={styles.pageTitle}>Portfolio Dashboard</h2>
          <p style={styles.pageSubtitle}>Pipeline health, valuation signals, and deal-by-deal performance</p>
        </div>
        <button onClick={fetchAll} style={styles.refreshBtn}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Stat Cards — insights endpoint */}
      <div style={styles.statsGrid}>
        <StatCard
          label="Active Pipeline"
          value={fmtMoney(insights.totalPipeline)}
          sub={`${insights.active || 0} active of ${insights.totalDeals || 0} total deals`}
          icon={Briefcase}
          color="#2563eb"
        />
        <StatCard
          label="Probability-Weighted"
          value={fmtMoney(insights.weightedPipeline)}
          sub="Stage-weighted pipeline value"
          icon={Target}
          color="#8b5cf6"
        />
        <StatCard
          label="Average IRR"
          value={fmtPct(insights.avgIrr)}
          sub="Across modeled base cases"
          icon={TrendingUp}
          color="#10b981"
        />
        <StatCard
          label="Model Coverage"
          value={`${insights.modeledDeals || 0} / ${insights.totalDeals || 0}`}
          sub={`${fmtPct(insights.modelCoverage, 0)} of deals have models`}
          icon={BarChart3}
          color="#f59e0b"
        />
        <StatCard
          label="Docs Processed"
          value={`${insights.docsDone || 0} / ${insights.docsTotal || 0}`}
          sub={`${fmtPct(insights.extractionRate, 0)} extraction success`}
          icon={FileText}
          color="#06b6d4"
        />
        <StatCard
          label="HITL Queue"
          value={insights.pendingReviews || 0}
          sub={`${insights.approvedReviews || 0} approved`}
          icon={ShieldCheck}
          color="#ef4444"
        />
      </div>

      {/* Row 1: Pipeline funnel + Sector distribution */}
      <div style={styles.chartRow}>
        <div style={{ ...styles.card, flex: 1.2, minWidth: 420 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={18} style={{ color: '#2563eb' }} />
              <h3 style={styles.cardTitle}>Pipeline by Stage</h3>
            </div>
            <span style={styles.cardBadge}>{insights.totalDeals || 0} deals</span>
          </div>
          {pipelineChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={pipelineChartData} layout="vertical" margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: '#334155' }} />
                <Tooltip
                  formatter={(v, n, p) => [`${v} deals • ${fmtMoney(p.payload.value)}`, 'Deals']}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={28}>
                  {pipelineChartData.map((e, i) => (
                    <Cell key={i} fill={STAGE_COLORS[e.stage] || COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={styles.emptyState}><p>No pipeline data</p></div>}
          <div style={styles.stageLegend}>
            {pipelineChartData.map((s, i) => (
              <div key={i} style={styles.stageLegendItem}>
                <span style={{ ...styles.legendDot, background: STAGE_COLORS[s.stage] || COLORS[i] }} />
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{s.name}: {fmtMoney(s.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...styles.card, flex: 0.8, minWidth: 320 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PieIcon size={18} style={{ color: '#8b5cf6' }} />
              <h3 style={styles.cardTitle}>Sector Distribution</h3>
            </div>
          </div>
          {sectorChartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={sectorChartData}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={88}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={2}
                    stroke="#fff"
                  >
                    {sectorChartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n, p) => [`${v} deals • ${fmtMoney(p.payload.totalValue)}`, p.payload.name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ padding: '0 16px 14px' }}>
                {sectorChartData.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < sectorChartData.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length] }} />
                      <span style={{ fontSize: '0.78rem', color: '#334155' }}>{s.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{s.value}</span>
                      <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#1e293b' }}>{fmtMoney(s.totalValue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <div style={styles.emptyState}><p>No sector data</p></div>}
        </div>
      </div>

      {/* Row 2: Valuation vs Estimate (Gap Insight) */}
      <div style={styles.chartRow}>
        <div style={{ ...styles.card, flex: 1, minWidth: 500 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={18} style={{ color: '#f59e0b' }} />
              <h3 style={styles.cardTitle}>Valuation vs. Analyst Estimate</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Blended EV vs. deal_size_estimate</span>
          </div>
          {gap.length > 0 ? (
            <div style={{ padding: '12px 0' }}>
              {gap.map(g => {
                const sig = SIGNAL_COLORS[g.signal];
                const Icon = sig.icon;
                const width = Math.min(100, Math.max(5, Math.abs(g.gap_pct)));
                const rightOfCenter = g.gap_pct > 0;
                return (
                  <div
                    key={g.deal_id}
                    onClick={() => navigate(`/deals/${g.deal_id}`)}
                    style={{ padding: '8px 20px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                      <div>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>{g.deal_name}</span>
                        <span style={{ fontSize: '0.74rem', color: '#64748b', marginLeft: 8 }}>
                          {g.target_company} • {g.sector}
                        </span>
                      </div>
                      <span style={{ ...styles.signalBadge, background: sig.bg, color: sig.fg }}>
                        <Icon size={11} /> {sig.label}
                      </span>
                    </div>
                    {/* Diverging bar */}
                    <div style={{ position: 'relative', height: 18, background: '#f1f5f9', borderRadius: 3 }}>
                      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#94a3b8' }} />
                      <div style={{
                        position: 'absolute',
                        left: rightOfCenter ? '50%' : `${50 - width / 2}%`,
                        width: `${width / 2}%`,
                        height: '100%',
                        background: sig.bg,
                        borderRadius: 2,
                        transition: 'all 0.3s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748b', marginTop: 3 }}>
                      <span>Estimate: {fmtMoney(g.estimate)}</span>
                      <span style={{ fontWeight: 600, color: sig.fg }}>
                        {g.gap_pct > 0 ? '+' : ''}{g.gap_pct.toFixed(1)}% ({fmtMoney(g.gap)})
                      </span>
                      <span>Blended: {fmtMoney(g.blended)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={styles.emptyState}>
              <Zap size={28} style={{ color: '#d1d5db' }} />
              <p style={{ marginTop: 8 }}>No modeled deals yet</p>
            </div>
          )}
        </div>

        {/* IRR/MOIC Ranking */}
        <div style={{ ...styles.card, flex: 0.9, minWidth: 400 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={18} style={{ color: '#10b981' }} />
              <h3 style={styles.cardTitle}>IRR / MOIC Ranking</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Base case</span>
          </div>
          {irrRank.length > 0 ? (
            <table style={styles.metricsTable}>
              <thead>
                <tr>
                  <th style={styles.metricsTh}>Deal</th>
                  <th style={styles.metricsTh}>Sector</th>
                  <th style={{ ...styles.metricsTh, textAlign: 'right' }}>IRR</th>
                  <th style={{ ...styles.metricsTh, textAlign: 'right' }}>MOIC</th>
                </tr>
              </thead>
              <tbody>
                {irrRank.map((r, i) => (
                  <tr
                    key={r.deal_id}
                    onClick={() => navigate(`/deals/${r.deal_id}`)}
                    style={{
                      background: i % 2 === 0 ? '#fff' : '#fafbfc',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbfc'}
                  >
                    <td style={{ ...styles.metricsTd, fontWeight: 600 }}>{r.deal_name}</td>
                    <td style={styles.metricsTd}>
                      <span style={styles.sectorTag}>{r.sector || '-'}</span>
                    </td>
                    <td style={{ ...styles.metricsTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.irr >= 15 ? '#065f46' : r.irr >= 0 ? '#1e293b' : '#991b1b', fontWeight: 600 }}>
                      {r.irr != null ? `${Number(r.irr).toFixed(1)}%` : '-'}
                    </td>
                    <td style={{ ...styles.metricsTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.moic != null ? `${Number(r.moic).toFixed(2)}x` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={styles.emptyState}><p>No IRR data</p></div>}
        </div>
      </div>

      {/* Row 3: Valuation ranges chart */}
      <div style={styles.chartRow}>
        <div style={{ ...styles.card, flex: 1, minWidth: 500 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={18} style={{ color: '#2563eb' }} />
              <h3 style={styles.cardTitle}>Valuation Ranges — All Scenarios</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Blended EV: Base / Upside / Downside ($M)</span>
          </div>
          {valuationChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={290}>
              <BarChart data={valuationChartData} margin={{ left: 10, right: 10, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} angle={-15} textAnchor="end" height={55} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `$${v}M`} />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(0)}M`} />
                <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                <Bar dataKey="downside" name="Downside" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="base"     name="Base"     fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="upside"   name="Upside"   fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={styles.emptyState}>
              <TrendingUp size={28} style={{ color: '#d1d5db' }} />
              <p style={{ marginTop: 8 }}>No valuation data</p>
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Growth/Margin Scatter + Sector Multiples */}
      <div style={styles.chartRow}>
        <div style={{ ...styles.card, flex: 1, minWidth: 420 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={18} style={{ color: '#8b5cf6' }} />
              <h3 style={styles.cardTitle}>Target Profiles — Growth vs EBITDA Margin</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Bubble size = revenue</span>
          </div>
          {scatterData.length > 0 ? (
            <ResponsiveContainer width="100%" height={290}>
              <ScatterChart margin={{ left: 10, right: 30, top: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  type="number" dataKey="x" name="Growth"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={v => `${v}%`}
                  label={{ value: 'Revenue Growth (%)', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }}
                />
                <YAxis
                  type="number" dataKey="y" name="Margin"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={v => `${v}%`}
                  label={{ value: 'EBITDA Margin (%)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
                />
                <ZAxis type="number" dataKey="z" range={[60, 400]} />
                <ReferenceLine x={20} stroke="#cbd5e1" strokeDasharray="3 3" />
                <ReferenceLine y={20} stroke="#cbd5e1" strokeDasharray="3 3" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={styles.tooltipBox}>
                        <div style={{ fontWeight: 600 }}>{d.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 3 }}>
                          Growth: <strong>{d.x.toFixed(1)}%</strong><br />
                          Margin: <strong>{d.y.toFixed(1)}%</strong><br />
                          Revenue: <strong>${d.z.toFixed(0)}M</strong>
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#2563eb">
                  {scatterData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          ) : <div style={styles.emptyState}><p>No financials to plot</p></div>}
          <div style={{ padding: '0 20px 14px', fontSize: '0.72rem', color: '#94a3b8' }}>
            Top-right quadrant = high growth, high margin (most attractive). Dashed lines = 20% thresholds.
          </div>
        </div>

        {/* Sector multiples */}
        <div style={{ ...styles.card, flex: 0.8, minWidth: 350 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={18} style={{ color: '#06b6d4' }} />
              <h3 style={styles.cardTitle}>Sector Benchmarks</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Avg public comp multiples</span>
          </div>
          {sectorMult.length > 0 ? (
            <table style={styles.metricsTable}>
              <thead>
                <tr>
                  <th style={styles.metricsTh}>Sector</th>
                  <th style={{ ...styles.metricsTh, textAlign: 'right' }}>EV/EBITDA</th>
                  <th style={{ ...styles.metricsTh, textAlign: 'right' }}>Growth</th>
                  <th style={{ ...styles.metricsTh, textAlign: 'right' }}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {sectorMult.map((r, i) => (
                  <tr key={r.sector} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                    <td style={{ ...styles.metricsTd, fontWeight: 600 }}>{r.sector}</td>
                    <td style={{ ...styles.metricsTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.avg_ev_ebitda != null ? `${Number(r.avg_ev_ebitda).toFixed(1)}x` : '-'}
                    </td>
                    <td style={{ ...styles.metricsTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.avg_growth != null ? `${Number(r.avg_growth).toFixed(1)}%` : '-'}
                    </td>
                    <td style={{ ...styles.metricsTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.avg_margin != null ? `${Number(r.avg_margin).toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={styles.emptyState}><p>No sector data</p></div>}
        </div>
      </div>

      {/* Row 5: Recent activity — full width */}
      <div style={styles.chartRow}>
        <div style={{ ...styles.card, flex: 1 }}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={18} style={{ color: '#f59e0b' }} />
              <h3 style={styles.cardTitle}>Recent Activity</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{activity.length} events</span>
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {activity.length > 0 ? (
              activity.map((it, i) => <ActivityItem key={it.id || i} item={it} />)
            ) : (
              <div style={styles.emptyState}><p>No recent activity</p></div>
            )}
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div style={styles.summaryBar}>
        <span>{counts.deal_pipeline || 0} Deals</span>
        <span style={styles.summarySep}>|</span>
        <span>{counts.target_company_financials || 0} Financial Records</span>
        <span style={styles.summarySep}>|</span>
        <span>{counts.comparable_companies || 0} Comparables</span>
        <span style={styles.summarySep}>|</span>
        <span>{counts.comparable_transactions || 0} Precedent Txns</span>
        <span style={styles.summarySep}>|</span>
        <span>{counts.model_outputs || 0} Model Outputs</span>
        <span style={styles.summarySep}>|</span>
        <span>{counts.audit_log || 0} Audit Events</span>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const styles = {
  page: {
    padding: '20px 24px 40px',
    background: 'var(--bg-secondary)',
    minHeight: '100%',
    overflowY: 'auto',
  },
  loadingCenter: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    height: '100%', minHeight: 400,
  },
  headerSection: {
    display: 'flex', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: 20, gap: 16,
  },
  pageTitle: { margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' },
  pageSubtitle: { margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' },
  refreshBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', fontSize: '0.8rem', fontWeight: 500,
    color: '#fff', background: '#2563eb', border: 'none',
    borderRadius: 8, cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 14, marginBottom: 20,
  },
  statCard: {
    background: '#fff', borderRadius: 12,
    padding: '16px 18px', border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  statLabel: {
    fontSize: '0.72rem', fontWeight: 500, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
  },
  statValue: { fontSize: '1.5rem', fontWeight: 700, color: '#1e293b', lineHeight: 1.2 },
  statSub: { fontSize: '0.72rem', color: '#94a3b8', marginTop: 3 },
  card: {
    background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 20px', borderBottom: '1px solid #f1f5f9',
  },
  cardTitle: { margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' },
  cardBadge: {
    fontSize: '0.72rem', fontWeight: 600,
    background: '#eff6ff', color: '#2563eb',
    padding: '3px 10px', borderRadius: 12,
  },
  chartRow: {
    display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap',
  },
  emptyState: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: 48, color: '#94a3b8', fontSize: '0.85rem',
  },
  stageLegend: {
    display: 'flex', flexWrap: 'wrap', gap: 12,
    padding: '8px 20px 12px', borderTop: '1px solid #f1f5f9',
  },
  stageLegendItem: { display: 'flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: '50%' },
  tooltipBox: {
    background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: 8, padding: '10px 14px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '0.82rem',
  },
  activityItem: {
    display: 'flex', gap: 12, padding: '10px 20px',
    borderBottom: '1px solid #f1f5f9',
  },
  activityDot: {
    width: 8, height: 8, borderRadius: '50%',
    marginTop: 6, flexShrink: 0,
  },
  actorBadge: {
    fontSize: '0.68rem', fontWeight: 600,
    background: '#f1f5f9', color: '#475569',
    padding: '1px 7px', borderRadius: 8,
  },
  metricsTable: {
    width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem',
  },
  metricsTh: {
    padding: '10px 14px', textAlign: 'left', fontWeight: 600,
    fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.03em', borderBottom: '2px solid #e2e8f0',
    background: '#f8fafc', whiteSpace: 'nowrap',
  },
  metricsTd: {
    padding: '10px 14px', borderBottom: '1px solid #f1f5f9',
    color: '#475569', whiteSpace: 'nowrap',
  },
  sectorTag: {
    fontSize: '0.72rem', fontWeight: 500,
    background: '#f0fdf4', color: '#15803d',
    padding: '2px 8px', borderRadius: 8,
  },
  signalBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: '0.68rem', fontWeight: 600,
    padding: '2px 8px', borderRadius: 10,
  },
  summaryBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexWrap: 'wrap', gap: 8, padding: '12px 20px',
    background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
    fontSize: '0.8rem', color: '#64748b', fontWeight: 500,
  },
  summarySep: { color: '#d1d5db' },
};
