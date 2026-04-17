import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getDealFull, updateDeal, uploadDocuments, deleteDocument,
  updateFinancial, buildModel, getModelRuns, getOutputs, createReview,
  startExtraction, getExtractionJob, getExtractionJobsForDeal, getModelJob, getDealTimeline,
  getRecommendation, saveRecommendation, draftRecommendationAI
} from '../api';
import {
  ArrowLeft, FileText, Upload, Trash2, RefreshCw,
  TrendingUp, DollarSign, BarChart3, Play, CheckCircle, XCircle,
  AlertCircle, Clock, User, Calculator, BookOpen, ChevronUp, ChevronDown,
  Zap, Shield, Loader, Activity, Sparkles
} from 'lucide-react';
import Tooltip from '../components/Tooltip';
import { useToast } from '../components/ToastContext';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';

// ── Formatting helpers ──────────────────────────────────────────
const fmt = {
  money: (v) => v == null || isNaN(v) ? '-' : `$${Number(v).toFixed(1)}M`,
  moneyInt: (v) => v == null || isNaN(v) ? '-' : `$${Math.round(Number(v))}M`,
  pct: (v) => v == null || isNaN(v) ? '-' : `${Number(v).toFixed(1)}%`,
  pctFromDecimal: (v) => v == null || isNaN(v) ? '-' : `${(Number(v) * 100).toFixed(1)}%`,
  multiple: (v) => v == null || isNaN(v) ? '-' : `${Number(v).toFixed(1)}x`,
  num: (v, d = 2) => v == null || isNaN(v) ? '-' : Number(v).toFixed(d),
};

function parseSafe(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return null; }
}

function prettyStage(s) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Inline Styles (Dashboard pattern) ───────────────────────────
const s = {
  page: { padding: '20px 24px 40px', minHeight: '100%' },
  backBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px',
    background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#475569',
  },
  header: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 },
  dealName: { margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' },
  meta: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, fontSize: '0.82rem', color: '#64748b' },
  stageBadge: (stage) => {
    const colors = { screening: '#2563eb', due_diligence: '#f59e0b', negotiation: '#8b5cf6', closed: '#10b981', passed: '#94a3b8' };
    const bg = colors[(stage || '').toLowerCase()] || '#94a3b8';
    return { fontSize: '0.7rem', fontWeight: 600, color: '#fff', background: bg, padding: '3px 10px', borderRadius: 10 };
  },
  sampleBadge: { fontSize: '0.68rem', fontWeight: 600, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 8 },
  tabBar: { display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 20 },
  tab: (active) => ({
    padding: '10px 18px', fontSize: '0.82rem', fontWeight: active ? 600 : 500,
    color: active ? '#2563eb' : '#64748b', background: 'none', border: 'none',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    cursor: 'pointer', marginBottom: -2, transition: 'all 0.15s',
  }),
  card: {
    background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden', marginBottom: 16,
  },
  cardHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid #f1f5f9',
  },
  cardTitle: { margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' },
  cardBody: { padding: '16px 20px' },
  row: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  kv: { display: 'flex', justifyContent: 'space-between', padding: '8px 20px', borderBottom: '1px solid #f8fafc' },
  kvLabel: { fontSize: '0.8rem', color: '#64748b', fontWeight: 500 },
  kvValue: { fontSize: '0.8rem', color: '#1e293b', fontWeight: 600 },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, padding: '16px 20px' },
  statBox: { background: '#f8fafc', borderRadius: 10, padding: '14px 16px', textAlign: 'center' },
  statLabel: { fontSize: '0.7rem', fontWeight: 500, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  statVal: { fontSize: '1.35rem', fontWeight: 700, color: '#1e293b' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th: {
    padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: '0.72rem',
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em',
    borderBottom: '2px solid #e2e8f0', background: '#f8fafc', whiteSpace: 'nowrap',
  },
  td: { padding: '10px 14px', borderBottom: '1px solid #f1f5f9', color: '#334155', whiteSpace: 'nowrap' },
  tdRight: { padding: '10px 14px', borderBottom: '1px solid #f1f5f9', color: '#334155', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  badge: (bg, color) => ({ fontSize: '0.7rem', fontWeight: 600, background: bg, color, padding: '3px 10px', borderRadius: 10, display: 'inline-block' }),
  btn: (variant = 'primary') => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: '0.8rem',
    fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer',
    color: variant === 'primary' ? '#fff' : '#475569',
    background: variant === 'primary' ? '#2563eb' : '#f1f5f9',
  }),
  btnSm: (variant = 'primary') => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: '0.75rem',
    fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer',
    color: variant === 'primary' ? '#fff' : '#475569',
    background: variant === 'primary' ? '#2563eb' : '#f1f5f9',
  }),
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center' },
  scenarioTab: (active) => ({
    padding: '6px 16px', fontSize: '0.78rem', fontWeight: active ? 600 : 500,
    color: active ? '#fff' : '#475569', background: active ? '#2563eb' : '#f1f5f9',
    border: 'none', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
  }),
  loadingCenter: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 },
  spinner: { width: 28, height: 28, border: '3px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  textarea: { width: '100%', padding: '10px 14px', fontSize: '0.82rem', border: '1px solid #e2e8f0', borderRadius: 8, resize: 'vertical', fontFamily: 'inherit', minHeight: 80 },
  fieldLabel: { fontSize: '0.78rem', fontWeight: 600, color: '#334155', marginBottom: 6 },
  heatCell: (v, min, max) => {
    const ratio = max === min ? 0.5 : (v - min) / (max - min);
    const r = Math.round(220 - ratio * 180);
    const g = Math.round(60 + ratio * 160);
    return { padding: '6px 10px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#1e293b', background: `rgba(${r}, ${g}, 80, 0.18)`, borderRadius: 4 };
  },
  barContainer: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  barLabel: { width: 100, fontSize: '0.78rem', fontWeight: 500, color: '#334155', textAlign: 'right', flexShrink: 0 },
  barTrack: { flex: 1, height: 22, background: '#f1f5f9', borderRadius: 6, position: 'relative', overflow: 'hidden' },
  editInput: { width: '100%', padding: '4px 6px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: 4 },
};

// ── Editable Cell ───────────────────────────────────────────────
function EditableCell({ value, onSave, type = 'text' }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const startEdit = () => { setEditValue(value != null ? String(value) : ''); setEditing(true); };
  const save = () => {
    setEditing(false);
    const nv = type === 'number' ? (editValue === '' ? null : parseFloat(editValue)) : editValue;
    if (nv !== value) onSave(nv);
  };
  if (editing) {
    return <input type={type === 'number' ? 'number' : 'text'} step="any" value={editValue}
      onChange={e => setEditValue(e.target.value)} onBlur={save} onKeyDown={e => e.key === 'Enter' && save()}
      autoFocus style={s.editInput} />;
  }
  return <span onClick={startEdit} style={{ cursor: 'pointer' }} title="Click to edit">{value != null && value !== '' ? value : '-'}</span>;
}

// ── Trend Arrow ─────────────────────────────────────────────────
function TrendArrow({ current, previous }) {
  if (current == null || previous == null || previous === 0) return null;
  const up = current > previous;
  return up
    ? <ChevronUp size={14} style={{ color: '#10b981', marginLeft: 4 }} />
    : <ChevronDown size={14} style={{ color: '#ef4444', marginLeft: 4 }} />;
}

// ── Football Field Bar ──────────────────────────────────────────
function FootballBar({ label, low, mid, high, maxVal, color }) {
  const scale = (v) => Math.max(0, Math.min(100, (v / maxVal) * 100));
  return (
    <div style={s.barContainer}>
      <div style={s.barLabel}>{label}</div>
      <div style={s.barTrack}>
        <div style={{ position: 'absolute', left: `${scale(low)}%`, width: `${scale(high) - scale(low)}%`, height: '100%', background: color || '#2563eb', opacity: 0.25, borderRadius: 6 }} />
        <div style={{ position: 'absolute', left: `${scale(low)}%`, width: `${scale(high) - scale(low)}%`, height: '100%', background: color || '#2563eb', opacity: 0.15, borderRadius: 6 }} />
        <div style={{ position: 'absolute', left: `${scale(mid) - 1}%`, width: 3, height: '100%', background: color || '#2563eb', borderRadius: 2 }} />
      </div>
      <div style={{ width: 140, fontSize: '0.72rem', color: '#64748b', flexShrink: 0, textAlign: 'left' }}>
        {fmt.moneyInt(low)} - <span style={{ fontWeight: 700, color: '#1e293b' }}>{fmt.moneyInt(mid)}</span> - {fmt.moneyInt(high)}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 1: OVERVIEW
// ════════════════════════════════════════════════════════════════
function OverviewTab({ deal, modelOutputs, onTabChange }) {
  const ff = modelOutputs?.footballField;
  const baseOutputs = (deal.outputs || []).filter(o => o.scenario === 'base');
  const ev = baseOutputs.find(o => o.metric_name === 'DCF Enterprise Value');
  const blended = baseOutputs.find(o => o.metric_name === 'Blended Valuation');
  const irr = baseOutputs.find(o => o.metric_name === 'Implied IRR');
  const moic = modelOutputs?.moic;
  const docs = deal.documents || [];
  const runs = deal.model_runs || [];
  const financials = deal.financials || [];
  const assumptions = deal.assumptions || [];
  const latestRun = runs[0];
  const hasModel = runs.length > 0;
  const hasFinancials = financials.length > 0;
  const hasAssumptions = assumptions.length > 0;

  // Surface recommendation, if any
  const [recommendation, setRecommendation] = useState(null);
  useEffect(() => {
    getRecommendation(deal.deal_id).then(setRecommendation).catch(() => {});
  }, [deal.deal_id]);

  // First-time-user guidance — show a stepped CTA when key artifacts are missing
  const nextStep = !hasFinancials ? {
    title: 'Upload documents',
    body: 'Drop CIMs, audited financials, or XLSX data packs. Our 7-stage extraction pipeline will parse and load them into the database.',
    cta: 'Go to Documents',
    target: 'Documents',
  } : !hasModel ? {
    title: 'Build the valuation model',
    body: `Financials are loaded (${financials.length} periods). Run DCF + trading comps + precedent transactions across base / upside / downside scenarios.`,
    cta: 'Go to Model',
    target: 'Model',
  } : null;

  const maxVal = ff ? Math.max(...ff.methods.map(m => m.high), ff.blendedValue?.high || 0) * 1.1 : 1000;
  const barColors = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981'];

  return (
    <div>
      {nextStep && (
        <div style={{
          background: 'linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)',
          color: '#fff', borderRadius: 12, padding: '18px 20px',
          marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {nextStep.target === 'Documents' ? <FileText size={22} /> : <Calculator size={22} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 3 }}>Next step: {nextStep.title}</div>
            <div style={{ fontSize: '0.82rem', opacity: 0.92 }}>{nextStep.body}</div>
          </div>
          <button
            onClick={() => onTabChange(nextStep.target)}
            style={{
              padding: '10px 18px', background: '#fff', color: '#2563eb',
              border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              whiteSpace: 'nowrap',
            }}
          >
            {nextStep.cta} →
          </button>
        </div>
      )}

      {/* Recommendation card — surfaces latest memo decision on Overview */}
      {recommendation && (
        <div style={{ ...s.card, marginBottom: 16, borderLeft: `4px solid ${DECISION_STYLES[recommendation.decision]?.border || '#94a3b8'}` }}>
          <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <BookOpen size={20} style={{ color: DECISION_STYLES[recommendation.decision]?.fg || '#64748b', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <DecisionBadge decision={recommendation.decision} />
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  v{recommendation.version} • {recommendation.drafted_by_ai ? 'AI-drafted' : 'manual'}
                  {recommendation.updated_at && ` • ${new Date(recommendation.updated_at).toLocaleString()}`}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(recommendation.recommended_action || recommendation.thesis || '').slice(0, 140) || 'No narrative yet.'}
              </div>
            </div>
            <button style={s.btnSm('secondary')} onClick={() => onTabChange('Recommendation')}>
              View →
            </button>
          </div>
        </div>
      )}

      {/* Agent Trace — shows what each of the 7 pipeline stages produced */}
      <AgentTracePanel dealId={deal.deal_id} deal={deal} />

    <div style={s.row}>
      <div style={{ flex: 1, minWidth: 380 }}>
        {/* Deal Summary */}
        <div style={s.card}>
          <div style={s.cardHead}>
            <h3 style={s.cardTitle}>Deal Summary</h3>
            <span style={s.stageBadge(deal.stage)}>{prettyStage(deal.stage)}</span>
          </div>
          {[
            ['Target Company', deal.target_company],
            ['Sector', deal.sector],
            ['Deal Size', deal.deal_size_estimate ? `$${deal.deal_size_estimate}M` : '-'],
            ['Lead Analyst', deal.lead_analyst],
            ['Date Entered', deal.date_entered],
            ['Expected Close', deal.expected_close],
          ].map(([k, v]) => (
            <div key={k} style={s.kv}><span style={s.kvLabel}>{k}</span><span style={s.kvValue}>{v || '-'}</span></div>
          ))}
          {deal.status_notes && (
            <div style={{ padding: '12px 20px', fontSize: '0.8rem', color: '#475569', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ fontWeight: 600, color: '#334155' }}>Notes: </span>{deal.status_notes}
            </div>
          )}
          <div style={{ padding: '12px 20px', display: 'flex', gap: 8, borderTop: '1px solid #f1f5f9' }}>
            <button style={s.btnSm('secondary')} onClick={() => onTabChange('Documents')}><FileText size={13} /> Add Documents</button>
            <button style={s.btnSm('primary')} onClick={() => onTabChange('Model')}><Calculator size={13} /> View Model</button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 340 }}>
        {/* Valuation Range */}
        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Valuation Range</h3></div>
          {ff && ff.methods ? (
            <div style={{ padding: '16px 20px' }}>
              {ff.methods.map((m, i) => (
                <FootballBar key={m.name} label={m.name} low={m.low} mid={m.mid} high={m.high} maxVal={maxVal} color={barColors[i % barColors.length]} />
              ))}
              {ff.blendedValue && (
                <>
                  <div style={{ borderTop: '1px dashed #e2e8f0', margin: '8px 0' }} />
                  <FootballBar label="Blended" low={ff.blendedValue.low} mid={ff.blendedValue.weighted || ff.blendedValue.mid} high={ff.blendedValue.high} maxVal={maxVal} color="#1e293b" />
                </>
              )}
            </div>
          ) : (
            <div style={s.empty}><BarChart3 size={32} /><p>Build a model to see valuation</p></div>
          )}
        </div>

        {/* Quick Stats */}
        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Quick Stats</h3></div>
          <div style={s.statGrid}>
            <div style={s.statBox}><div style={s.statLabel}>Base EV</div><div style={s.statVal}>{ev ? fmt.moneyInt(ev.metric_value) : '-'}</div></div>
            <div style={s.statBox}><div style={s.statLabel}>Blended EV</div><div style={s.statVal}>{blended ? fmt.moneyInt(blended.metric_value) : '-'}</div></div>
            <div style={s.statBox}><div style={s.statLabel}>IRR</div><div style={s.statVal}>{irr ? fmt.pct(irr.metric_value) : '-'}</div></div>
            <div style={s.statBox}><div style={s.statLabel}>MOIC</div><div style={s.statVal}>{moic != null ? `${Number(moic).toFixed(2)}x` : '-'}</div></div>
          </div>
        </div>

        {/* Status */}
        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Status</h3></div>
          <div style={s.kv}><span style={s.kvLabel}>Documents</span><span style={s.kvValue}>{docs.length} uploaded</span></div>
          <div style={s.kv}>
            <span style={s.kvLabel}>Model</span>
            <span style={s.kvValue}>
              {latestRun
                ? <span style={s.badge(latestRun.approval_state === 'approved' ? '#d1fae5' : '#fef3c7', latestRun.approval_state === 'approved' ? '#065f46' : '#92400e')}>
                    {latestRun.approval_state || 'pending'}
                  </span>
                : 'Not built'}
            </span>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 2: DOCUMENTS
// ════════════════════════════════════════════════════════════════
function DocumentsTab({ deal, refreshDeal }) {
  const docs = deal.documents || [];
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(null);
  const [extractionError, setExtractionError] = useState('');
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleUpload = async (files, autoExtract = true) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setExtractionError('');
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      await uploadDocuments(deal.deal_id, fd);
      await refreshDeal();
      setUploading(false);
      // Chain into extraction automatically so first-time users aren't stuck
      // with an "uploaded but not processed" limbo state.
      if (autoExtract) {
        setTimeout(() => handleExtract(), 300);
      }
    } catch (err) {
      console.error('Upload failed:', err);
      setExtractionError(err.response?.data?.details || err.message || 'Upload failed');
      setUploading(false);
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    setExtractionError('');
    setExtractionProgress({ progress: 0, message: 'Starting pipeline...' });
    try {
      const result = await startExtraction(deal.deal_id);
      const jobId = result.jobId ?? result.job_id;
      if (!jobId) throw new Error('No job id returned');

      let polls = 0;
      pollRef.current = setInterval(async () => {
        polls++;
        try {
          const j = await getExtractionJob(jobId);
          const status = (j.status || 'running').toLowerCase();
          const progress = Number(j.progress ?? j.progress_pct ?? 0);
          setExtractionProgress({
            progress: isFinite(progress) ? progress : 0,
            message: j.message || j.stage || 'Processing',
          });
          if (status === 'completed' || status === 'paused' || status === 'failed' || status === 'error') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            if (status === 'failed' || status === 'error') {
              setExtractionError(j.error || j.error_message || 'Extraction failed');
              toast.push('Extraction failed: ' + (j.error || j.error_message || 'Unknown error'), 'error');
            } else if (status === 'paused') {
              toast.push('Extraction paused for human review — see Reviews tab', 'info', 6000);
            } else {
              toast.push('Extraction complete — financial data loaded', 'success');
            }
            setExtracting(false);
            await refreshDeal();
          }
        } catch (e) {
          if (polls > 200) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setExtracting(false);
            setExtractionError('Polling timed out');
          }
        }
      }, 3000);
    } catch (err) {
      console.error('Extraction start failed:', err);
      setExtractionError(err.response?.data?.details || err.message || 'Could not start extraction');
      setExtracting(false);
    }
  };

  const handleDelete = async (docId) => {
    if (!confirm('Delete this document?')) return;
    try {
      await deleteDocument(docId);
      await refreshDeal();
    } catch (err) { console.error(err); }
  };

  const pendingCount = docs.filter(d => ['pending', 'failed', null, undefined].includes(d.extraction_status)).length;

  const statusColors = {
    completed:     ['#d1fae5', '#065f46'],
    pending:       ['#fef3c7', '#92400e'],
    processing:    ['#dbeafe', '#1e40af'],
    classified:    ['#ede9fe', '#5b21b6'],
    needs_review:  ['#fed7aa', '#9a3412'],
    skipped:       ['#f1f5f9', '#64748b'],
    failed:        ['#fee2e2', '#991b1b'],
  };

  return (
    <div>
      {/* Action bar */}
      {docs.length > 0 && (
        <div style={{ ...s.card, padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: '0.85rem', color: '#475569' }}>
            {pendingCount > 0
              ? `${pendingCount} document(s) ready for extraction.`
              : 'All documents have been processed.'}
          </div>
          <button
            style={s.btnSm('primary')}
            onClick={handleExtract}
            disabled={extracting || pendingCount === 0}
          >
            {extracting ? <Loader className="spin" size={13} /> : <Zap size={13} />}
            {extracting ? 'Extracting…' : 'Run Extraction'}
          </button>
        </div>
      )}

      {/* Progress bar when extracting */}
      {extracting && extractionProgress && (
        <div style={{ ...s.card, padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.82rem' }}>
            <span>{extractionProgress.message}</span>
            <span style={{ fontWeight: 600 }}>{Math.round(extractionProgress.progress)}%</span>
          </div>
          <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${extractionProgress.progress}%`, background: '#2563eb', transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}

      {/* Error */}
      {extractionError && (
        <div style={{ ...s.card, padding: '10px 14px', marginBottom: 12, background: '#fee2e2', color: '#991b1b', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={15} />
          <span style={{ flex: 1 }}>{extractionError}</span>
        </div>
      )}

      {/* Drop zone */}
      <div style={{ ...s.card, border: dragActive ? '2px dashed #2563eb' : '2px dashed #cbd5e1', background: dragActive ? '#eff6ff' : '#f8fafc', padding: 32, textAlign: 'center', cursor: 'pointer', marginBottom: 16 }}
        onDragOver={e => { e.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); handleUpload(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}>
        <Upload size={28} style={{ color: '#94a3b8', marginBottom: 8 }} />
        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.88rem' }}>{uploading ? 'Uploading...' : 'Drag & drop files or click to browse'}</div>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>PDF, XLSX, DOCX, CSV</div>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} accept=".pdf,.xlsx,.docx,.csv" onChange={e => handleUpload(e.target.files)} />
      </div>

      {docs.length === 0 ? (
        <div style={s.empty}><FileText size={40} /><h3 style={{ margin: '12px 0 4px' }}>No Documents</h3><p>Upload documents to begin extraction.</p></div>
      ) : (
        <div style={s.card}>
          <table style={s.table}>
            <thead><tr>
              <th style={s.th}>Filename</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Confidence</th>
              <th style={s.th}>Pages</th>
              <th style={s.th}>Uploaded</th>
              <th style={s.th}></th>
            </tr></thead>
            <tbody>
              {docs.map(d => {
                const sc = statusColors[(d.extraction_status || 'pending').toLowerCase()] || statusColors.pending;
                const conf = d.classification_confidence;
                return (
                  <tr key={d.id}>
                    <td style={{ ...s.td, fontWeight: 600 }}><FileText size={13} style={{ marginRight: 6, color: '#94a3b8', verticalAlign: 'middle' }} />{d.filename}</td>
                    <td style={s.td}><span style={s.badge('#eff6ff', '#2563eb')}>{(d.document_type || 'pending').replace(/_/g, ' ')}</span></td>
                    <td style={s.td}><span style={s.badge(sc[0], sc[1])}>{d.extraction_status || 'pending'}</span></td>
                    <td style={s.td}>{conf != null ? `${Math.round(conf * 100)}%` : '-'}</td>
                    <td style={s.td}>{d.page_count || '-'}</td>
                    <td style={s.td}>{d.upload_date ? new Date(d.upload_date).toLocaleDateString() : '-'}</td>
                    <td style={s.td}>
                      <button style={{ ...s.btnSm('secondary'), padding: '4px 8px' }} onClick={() => handleDelete(d.id)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 3: TARGET FINANCIALS
// ════════════════════════════════════════════════════════════════
function FinancialsTab({ deal }) {
  const [financials, setFinancials] = useState(deal.financials || []);
  const fields = [
    { key: 'period', label: 'Period', type: 'text' },
    { key: 'revenue', label: 'Revenue ($M)', type: 'number', fmt: fmt.money },
    { key: 'revenue_growth_pct', label: 'Rev Growth (%)', type: 'number', fmt: fmt.pct },
    { key: 'ebitda', label: 'EBITDA ($M)', type: 'number', fmt: fmt.money },
    { key: 'ebitda_margin_pct', label: 'EBITDA Margin (%)', type: 'number', fmt: fmt.pct },
    { key: 'net_income', label: 'Net Income ($M)', type: 'number', fmt: fmt.money },
    { key: 'fcf', label: 'FCF ($M)', type: 'number', fmt: fmt.money },
    { key: 'employees', label: 'Employees', type: 'number', fmt: (v) => v != null ? Math.round(v).toLocaleString() : '-' },
  ];

  const anyAgentSource = financials.some(f => f.data_source === 'extraction_pipeline');

  const handleSave = async (recId, field, value) => {
    try {
      await updateFinancial(recId, { [field]: value });
      setFinancials(prev => prev.map(f => f.record_id === recId ? { ...f, [field]: value } : f));
    } catch (err) { console.error('Update failed:', err); }
  };

  if (financials.length === 0) {
    return <div style={s.empty}><DollarSign size={40} /><h3 style={{ margin: '12px 0 4px' }}>No Financial Data</h3><p>Upload documents for extraction or add data in Data Workspace.</p></div>;
  }

  // Compute simple summary KPIs
  const sorted = [...financials].sort((a, b) => (a.period > b.period ? 1 : -1));
  const first = sorted[0];
  const last  = sorted[sorted.length - 1];
  const years = sorted.length - 1;
  const cagr = (first.revenue && last.revenue && years > 0)
    ? (Math.pow(last.revenue / first.revenue, 1 / years) - 1) * 100
    : null;
  const latestMargin = last.ebitda_margin_pct;
  const marginChange = first.ebitda_margin_pct != null && last.ebitda_margin_pct != null
    ? last.ebitda_margin_pct - first.ebitda_margin_pct
    : null;

  const chartData = sorted.map(f => ({
    period: f.period,
    revenue: f.revenue,
    ebitda: f.ebitda,
    margin: f.ebitda_margin_pct,
  }));

  return (
    <>
    {/* Summary KPIs */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
      <div style={s.statBox}>
        <div style={s.statLabel}>Revenue CAGR</div>
        <div style={{ ...s.statVal, color: cagr != null && cagr >= 15 ? '#065f46' : '#1e293b' }}>
          {cagr != null ? `${cagr.toFixed(1)}%` : '-'}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
          {first.period} → {last.period}
        </div>
      </div>
      <div style={s.statBox}>
        <div style={s.statLabel}>Latest Revenue</div>
        <div style={s.statVal}>{last.revenue != null ? `$${Number(last.revenue).toFixed(0)}M` : '-'}</div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>{last.period}</div>
      </div>
      <div style={s.statBox}>
        <div style={s.statLabel}>Latest EBITDA Margin</div>
        <div style={s.statVal}>{latestMargin != null ? `${latestMargin.toFixed(1)}%` : '-'}</div>
        <div style={{ fontSize: '0.7rem', color: marginChange >= 0 ? '#10b981' : '#ef4444', marginTop: 2 }}>
          {marginChange != null ? `${marginChange >= 0 ? '+' : ''}${marginChange.toFixed(1)}pts vs ${first.period}` : ''}
        </div>
      </div>
      <div style={s.statBox}>
        <div style={s.statLabel}>Headcount</div>
        <div style={s.statVal}>{last.employees != null ? Number(last.employees).toLocaleString() : '-'}</div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>FTEs</div>
      </div>
    </div>

    {/* Chart */}
    <div style={{ ...s.card, marginBottom: 16 }}>
      <div style={s.cardHead}>
        <h3 style={s.cardTitle}>Revenue & EBITDA Trend</h3>
        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Revenue & EBITDA ($M) • Margin line (%)</span>
      </div>
      <div style={{ padding: '12px 12px 6px' }}>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis yAxisId="left"  tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `$${v}M`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `${v}%`} domain={[0, 'auto']} />
            <ReTooltip
              formatter={(value, name) =>
                name === 'margin'
                  ? [`${Number(value).toFixed(1)}%`, 'EBITDA Margin']
                  : [`$${Number(value).toFixed(1)}M`, name === 'revenue' ? 'Revenue' : 'EBITDA']
              }
              contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.8rem' }}
            />
            <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
            <Bar yAxisId="left" dataKey="revenue" fill="#2563eb" name="Revenue" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="left" dataKey="ebitda"  fill="#10b981" name="EBITDA"  radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="margin" stroke="#f59e0b" strokeWidth={2.5} name="margin" dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>

    <div style={s.card}>
      <div style={s.cardHead}>
        <h3 style={s.cardTitle}>Historical Financials</h3>
        {anyAgentSource && (
          <span style={s.badge('#eff6ff', '#2563eb')}>
            <Shield size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Agent-extracted
          </span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={s.table}>
          <thead><tr>
            {fields.map(f => <th key={f.key} style={s.th}>{f.label}</th>)}
            <th style={s.th}>Confidence</th>
          </tr></thead>
          <tbody>
            {financials.map((fin, idx) => (
              <tr key={fin.record_id || idx}>
                {fields.map(f => {
                  const val = fin[f.key];
                  const prev = idx > 0 ? financials[idx - 1][f.key] : null;
                  return (
                    <td key={f.key} style={f.type === 'number' ? s.tdRight : s.td}>
                      <EditableCell value={val} type={f.type} onSave={(v) => handleSave(fin.record_id, f.key, v)} />
                      {f.type === 'number' && f.key !== 'employees' && <TrendArrow current={val} previous={prev} />}
                    </td>
                  );
                })}
                <td style={s.tdRight}>
                  {fin.confidence != null ? (
                    <span style={s.badge(
                      fin.confidence >= 0.8 ? '#d1fae5' : fin.confidence >= 0.5 ? '#fef3c7' : '#fee2e2',
                      fin.confidence >= 0.8 ? '#065f46' : fin.confidence >= 0.5 ? '#92400e' : '#991b1b',
                    )}>
                      {Math.round(fin.confidence * 100)}%
                    </span>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 4: COMPARABLES
// ════════════════════════════════════════════════════════════════
function ComparablesTab({ deal, modelOutputs }) {
  const tc = modelOutputs?.tradingComps;
  const prec = modelOutputs?.precedentTransactions || modelOutputs?.precedent;
  const comps = deal.comps || [];
  const transactions = deal.transactions || [];

  const StatsRow = ({ stats, metrics }) => (
    <div style={{ display: 'flex', gap: 12, padding: '12px 20px', flexWrap: 'wrap' }}>
      {metrics.map(m => {
        const data = stats?.[m.key];
        if (!data) return null;
        return (
          <div key={m.key} style={{ ...s.statBox, flex: 1, minWidth: 140, textAlign: 'left' }}>
            <div style={s.statLabel}>{m.label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>Med: {fmt.multiple(data.median)}</div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>
              Mean: {fmt.multiple(data.mean)} | P25: {fmt.multiple(data.p25)} | P75: {fmt.multiple(data.p75)}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      {deal.sector && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: '0.82rem', color: '#1e40af' }}>
          Showing comparables from <strong>{deal.sector}</strong>: {comps.length} public peers, {transactions.length} precedent transactions.
        </div>
      )}

      {/* Public Comps */}
      <div style={s.card}>
        <div style={s.cardHead}><h3 style={s.cardTitle}>Public Trading Comparables</h3></div>
        {tc?.stats ? (
          <StatsRow stats={tc.stats} metrics={[
            { key: 'evEbitda', label: 'EV / EBITDA' },
            { key: 'evRevenue', label: 'EV / Revenue' },
            { key: 'peRatio', label: 'P / E' },
          ]} />
        ) : (
          <div style={{ ...s.empty, padding: 32 }}><p>Run a model to generate trading comps analysis.</p></div>
        )}
        {tc?.impliedValues && (
          <div style={{ padding: '0 20px 16px', fontSize: '0.8rem', color: '#64748b' }}>
            Implied EV from comps: <span style={{ fontWeight: 700, color: '#1e293b' }}>{fmt.moneyInt(tc.impliedValues.evEbitda || tc.impliedValues.blended)}</span>
          </div>
        )}
      </div>

      {/* Precedent Transactions */}
      <div style={s.card}>
        <div style={s.cardHead}><h3 style={s.cardTitle}>Precedent Transactions</h3></div>
        {prec?.stats ? (
          <StatsRow stats={prec.stats} metrics={[
            { key: 'evEbitda', label: 'EV / EBITDA' },
            { key: 'evRevenue', label: 'EV / Revenue' },
          ]} />
        ) : (
          <div style={{ ...s.empty, padding: 32 }}><p>Run a model to generate precedent transaction analysis.</p></div>
        )}
        {prec?.impliedValues && (
          <div style={{ padding: '0 20px 16px', fontSize: '0.8rem', color: '#64748b' }}>
            Implied EV from precedents: <span style={{ fontWeight: 700, color: '#1e293b' }}>{fmt.moneyInt(prec.impliedValues.evEbitda || prec.impliedValues.blended)}</span>
          </div>
        )}
      </div>

      {/* Actual comps used — table */}
      {comps.length > 0 && (
        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Peer Set ({comps.length})</h3></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Company</th>
                <th style={s.th}>Ticker</th>
                <th style={s.th}>EV/EBITDA</th>
                <th style={s.th}>EV/Revenue</th>
                <th style={s.th}>Growth</th>
                <th style={s.th}>Margin</th>
                <th style={s.th}>Market Cap</th>
              </tr></thead>
              <tbody>
                {comps.map(c => (
                  <tr key={c.record_id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>{c.company_name}</td>
                    <td style={s.td}>{c.ticker || '-'}</td>
                    <td style={s.tdRight}>{c.ev_ebitda != null ? `${c.ev_ebitda}x` : '-'}</td>
                    <td style={s.tdRight}>{c.ev_revenue != null ? `${c.ev_revenue}x` : '-'}</td>
                    <td style={s.tdRight}>{c.revenue_growth_pct != null ? `${c.revenue_growth_pct}%` : '-'}</td>
                    <td style={s.tdRight}>{c.ebitda_margin_pct != null ? `${c.ebitda_margin_pct}%` : '-'}</td>
                    <td style={s.tdRight}>{c.market_cap != null ? `$${Number(c.market_cap).toLocaleString()}M` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actual precedent transactions — table */}
      {transactions.length > 0 && (
        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Precedent Transactions ({transactions.length})</h3></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Transaction</th>
                <th style={s.th}>Announce</th>
                <th style={s.th}>Deal Value</th>
                <th style={s.th}>EV/EBITDA</th>
                <th style={s.th}>EV/Revenue</th>
                <th style={s.th}>Premium</th>
              </tr></thead>
              <tbody>
                {transactions.map(t => (
                  <tr key={t.record_id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>{t.transaction_name}</td>
                    <td style={s.td}>{t.announcement_date || '-'}</td>
                    <td style={s.tdRight}>{t.deal_value != null ? `$${Number(t.deal_value).toLocaleString()}M` : '-'}</td>
                    <td style={s.tdRight}>{t.ev_ebitda != null ? `${t.ev_ebitda}x` : '-'}</td>
                    <td style={s.tdRight}>{t.ev_revenue != null ? `${t.ev_revenue}x` : '-'}</td>
                    <td style={s.tdRight}>{t.premium_pct != null ? `${t.premium_pct}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 5: MODEL (most important)
// ════════════════════════════════════════════════════════════════
function ModelTab({ deal, refreshDeal }) {
  const toast = useToast();
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(null);
  const [buildError, setBuildError] = useState('');
  const [scenario, setScenario] = useState('base');
  const runs = deal.model_runs || [];
  const assumptions = deal.assumptions || [];
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleBuild = async () => {
    setBuilding(true);
    setBuildError('');
    setBuildProgress({ progress: 0, message: 'Starting model build...' });
    try {
      const result = await buildModel(deal.deal_id);
      const jobId = result.jobId;
      if (!jobId) {
        // Synchronous fallback
        await refreshDeal();
        setBuilding(false);
        setBuildProgress(null);
        return;
      }

      let polls = 0;
      pollRef.current = setInterval(async () => {
        polls++;
        try {
          const j = await getModelJob(jobId);
          setBuildProgress({ progress: j.progress || 0, message: j.stage || 'Building...' });
          if (j.status === 'completed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBuilding(false);
            setBuildProgress(null);
            toast.push('Model built — 3 scenarios ready', 'success');
            await refreshDeal();
          } else if (j.status === 'failed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBuilding(false);
            setBuildError(j.error || 'Model build failed');
            toast.push('Model build failed: ' + (j.error || 'Unknown'), 'error');
          }
        } catch (e) {
          if (polls > 120) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBuilding(false);
            setBuildError('Polling timed out');
          }
        }
      }, 2000);
    } catch (err) {
      console.error('Build failed:', err);
      setBuildError(err.response?.data?.details || err.message || 'Build failed');
      setBuilding(false);
    }
  };

  const handleApproval = async (state) => {
    const run = runs.find(r => r.scenario === scenario) || runs[0];
    if (!run) return;
    try {
      await createReview({
        entity_type: 'model_run',
        entity_id: String(run.id),
        decision: state,
        notes: '',
      });
      await refreshDeal();
    } catch (err) { console.error('Review failed:', err); }
  };

  if (runs.length === 0) {
    return (
      <div style={s.empty}>
        <Calculator size={48} style={{ color: '#94a3b8', marginBottom: 12 }} />
        <h3 style={{ margin: '0 0 8px', color: '#334155' }}>No Model Built</h3>
        <p style={{ marginBottom: 16, maxWidth: 400 }}>Build a draft valuation model using your financial data, comparables, and assumptions. The model will generate DCF, comps-based, and blended valuations.</p>

        {buildError && (
          <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12, fontSize: '0.82rem', maxWidth: 480 }}>
            {buildError}
          </div>
        )}

        {building && buildProgress && (
          <div style={{ width: 360, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8rem' }}>
              <span>{buildProgress.message}</span>
              <span style={{ fontWeight: 600 }}>{Math.round(buildProgress.progress)}%</span>
            </div>
            <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${buildProgress.progress}%`, background: '#2563eb', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}

        <button style={s.btn('primary')} onClick={handleBuild} disabled={building}>
          <Play size={15} /> {building ? 'Building...' : 'Build Draft Model'}
        </button>
      </div>
    );
  }

  const currentRun = runs.find(r => r.scenario === scenario) || runs[0];
  const outputs = parseSafe(currentRun?.outputs_json);
  const dcf = outputs?.dcf;
  const ff = outputs?.footballField;
  const sensitivity = dcf?.sensitivityGrid || outputs?.sensitivity;

  const maxVal = ff ? Math.max(...ff.methods.map(m => m.high), ff.blendedValue?.high || 0) * 1.1 : 1000;
  const barColors = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981'];

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['base', 'upside', 'downside'].map(sc => (
            <button key={sc} style={s.scenarioTab(scenario === sc)} onClick={() => setScenario(sc)}>
              {sc.charAt(0).toUpperCase() + sc.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {currentRun && (
            <span style={s.badge(
              currentRun.approval_state === 'approved' ? '#d1fae5' : currentRun.approval_state === 'rejected' ? '#fee2e2' : '#fef3c7',
              currentRun.approval_state === 'approved' ? '#065f46' : currentRun.approval_state === 'rejected' ? '#991b1b' : '#92400e',
            )}>{currentRun.approval_state || 'pending'}</span>
          )}
          <button style={s.btnSm('primary')} onClick={() => handleApproval('approved')}><CheckCircle size={13} /> Approve</button>
          <button style={s.btnSm('secondary')} onClick={() => handleApproval('rejected')}><XCircle size={13} /> Reject</button>
          <button style={s.btnSm('secondary')} onClick={handleBuild} disabled={building}><RefreshCw size={13} /> {building ? 'Rebuilding...' : 'Rebuild'}</button>
        </div>
      </div>

      {/* Section 1: Key Assumptions */}
      {assumptions.length > 0 && (
        <div style={s.card}>
          <div style={s.cardHead}>
            <h3 style={s.cardTitle}>
              <Tooltip term="DCF">Key Assumptions</Tooltip>
            </h3>
          </div>
          <table style={s.table}>
            <thead><tr>
              <th style={s.th}>Assumption</th>
              <th style={s.th}>Base Case</th>
              <th style={s.th}>Upside</th>
              <th style={s.th}>Downside</th>
              <th style={s.th}>Unit</th>
              <th style={s.th}>Source</th>
            </tr></thead>
            <tbody>
              {assumptions.map(a => {
                const srcBadge = {
                  'auto-generated': { bg: '#ede9fe', fg: '#5b21b6', label: 'auto' },
                  'sample':         { bg: '#fef3c7', fg: '#92400e', label: 'sample' },
                  'user':           { bg: '#e0e7ff', fg: '#3730a3', label: 'manual' },
                  'extraction':     { bg: '#d1fae5', fg: '#065f46', label: 'extracted' },
                }[a.data_source] || { bg: '#f1f5f9', fg: '#475569', label: a.data_source || 'manual' };
                return (
                  <tr key={a.assumption_id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      <Tooltip term={a.assumption_name}>{a.assumption_name}</Tooltip>
                      {a.source_rationale && (
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400, marginTop: 2 }} title={a.source_rationale}>
                          {a.source_rationale.slice(0, 70)}{a.source_rationale.length > 70 ? '…' : ''}
                        </div>
                      )}
                    </td>
                    <td style={s.tdRight}>{fmt.num(a.base_case, 1)}</td>
                    <td style={s.tdRight}>{fmt.num(a.upside_case, 1)}</td>
                    <td style={s.tdRight}>{fmt.num(a.downside_case, 1)}</td>
                    <td style={s.td}>{a.unit || '-'}</td>
                    <td style={s.td}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: srcBadge.bg, color: srcBadge.fg }}>
                        {srcBadge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Section 2: Revenue Projections */}
      {dcf?.projections && (
        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Revenue Projections (5-Year DCF)</h3></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Year</th><th style={s.th}>Revenue ($M)</th><th style={s.th}>Growth</th><th style={s.th}>EBITDA ($M)</th><th style={s.th}>Margin</th><th style={s.th}>FCF ($M)</th><th style={s.th}>PV of FCF</th></tr></thead>
              <tbody>
                {dcf.projections.map(p => {
                  const margin = p.ebitda && p.revenue ? ((p.ebitda / p.revenue) * 100) : null;
                  const growth = p.growth != null ? p.growth : null;
                  return (
                    <tr key={p.year}>
                      <td style={{ ...s.td, fontWeight: 600 }}>Year {p.year}</td>
                      <td style={s.tdRight}>{fmt.money(p.revenue)}</td>
                      <td style={s.tdRight}>{growth != null ? fmt.pct(growth) : '-'}</td>
                      <td style={s.tdRight}>{fmt.money(p.ebitda)}</td>
                      <td style={s.tdRight}>{margin != null ? fmt.pct(margin) : '-'}</td>
                      <td style={s.tdRight}>{fmt.money(p.fcf)}</td>
                      <td style={s.tdRight}>{fmt.money(p.pvFcf)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 3: DCF Waterfall */}
      {dcf && (
        <div style={s.card}>
          <div style={s.cardHead}>
            <h3 style={s.cardTitle}>
              <Tooltip term="DCF">DCF Valuation Bridge</Tooltip>
            </h3>
          </div>
          <div style={s.statGrid}>
            {[
              ['PV of FCFs', fmt.money(dcf.projections?.reduce((sum, p) => sum + (p.pvFcf || 0), 0))],
              ['Terminal Value', fmt.money(dcf.terminalValue)],
              ['PV of Terminal', fmt.money(dcf.pvTerminal)],
              ['Enterprise Value', fmt.money(dcf.enterpriseValue)],
              ['Equity Value', fmt.money(dcf.equityValue)],
            ].map(([label, val]) => (
              <div key={label} style={s.statBox}>
                <div style={s.statLabel}>{label}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b' }}>{val}</div>
              </div>
            ))}
          </div>
          {dcf.impliedMultiples && (
            <div style={{ padding: '0 20px 16px', display: 'flex', gap: 16, fontSize: '0.8rem', color: '#64748b' }}>
              Implied EV/EBITDA: <span style={{ fontWeight: 700, color: '#1e293b' }}>{fmt.multiple(dcf.impliedMultiples.evEbitda)}</span>
              <span style={{ color: '#d1d5db' }}>|</span>
              Implied EV/Revenue: <span style={{ fontWeight: 700, color: '#1e293b' }}>{fmt.multiple(dcf.impliedMultiples.evRevenue)}</span>
            </div>
          )}
        </div>
      )}

      {/* Section 4: Valuation Summary */}
      <div style={s.card}>
        <div style={s.cardHead}><h3 style={s.cardTitle}>Valuation Summary</h3></div>
        <div style={s.statGrid}>
          {[
            ['DCF EV', dcf?.enterpriseValue, fmt.moneyInt, 'DCF'],
            ['Trading Comps EV', outputs?.tradingComps?.impliedValues?.evEbitda || outputs?.tradingComps?.impliedValues?.blended, fmt.moneyInt, 'ev/ebitda'],
            ['Precedent Trans EV', outputs?.precedent?.impliedValues?.evEbitda || outputs?.precedent?.impliedValues?.blended, fmt.moneyInt, 'control premium'],
            ['Blended EV', ff?.blendedValue?.weighted, fmt.moneyInt, 'blended valuation'],
            ['IRR', outputs?.irr, fmt.pctFromDecimal, 'IRR'],
            ['MOIC', outputs?.moic, (v) => v != null ? `${Number(v).toFixed(2)}x` : '-', 'MOIC'],
          ].map(([label, val, fmtFn, term]) => (
            <div key={label} style={s.statBox}>
              <div style={s.statLabel}>
                <Tooltip term={term}>{label}</Tooltip>
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: label === 'Blended EV' ? '#2563eb' : '#1e293b' }}>{fmtFn(val)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 5: Football Field */}
      {ff && ff.methods && (
        <div style={s.card}>
          <div style={s.cardHead}>
            <h3 style={s.cardTitle}>
              <Tooltip term="football field">Football Field</Tooltip>
            </h3>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {ff.methods.map((m, i) => (
              <FootballBar key={m.name} label={m.name} low={m.low} mid={m.mid} high={m.high} maxVal={maxVal} color={barColors[i % barColors.length]} />
            ))}
            {ff.blendedValue && (
              <>
                <div style={{ borderTop: '1px dashed #e2e8f0', margin: '8px 0' }} />
                <FootballBar label="Blended" low={ff.blendedValue.low} mid={ff.blendedValue.weighted || ff.blendedValue.mid} high={ff.blendedValue.high} maxVal={maxVal} color="#1e293b" />
              </>
            )}
          </div>
        </div>
      )}

      {/* Section 6: Sensitivity Grid */}
      {sensitivity && sensitivity.rows && (
        <div style={s.card}>
          <div style={s.cardHead}>
            <h3 style={s.cardTitle}>
              <Tooltip term="sensitivity">Sensitivity Analysis</Tooltip>
            </h3>
            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
              {sensitivity.param1Name || 'WACC'} vs {sensitivity.param2Name || 'Terminal Growth'}
            </span>
          </div>
          <div style={{ padding: '16px 20px', overflowX: 'auto' }}>
            {(() => {
              const allVals = sensitivity.rows.flatMap(r => (r.values || r.cells || []).map(Number).filter(v => !isNaN(v)));
              const minV = Math.min(...allVals);
              const maxV = Math.max(...allVals);
              return (
                <table style={{ ...s.table, borderCollapse: 'separate', borderSpacing: 3 }}>
                  <thead><tr>
                    <th style={{ ...s.th, background: 'none', border: 'none' }}></th>
                    {(sensitivity.columns || sensitivity.headers || []).map((c, i) => (
                      <th key={i} style={{ ...s.th, textAlign: 'center', fontSize: '0.7rem' }}>{typeof c === 'number' ? fmt.pct(c * 100) : c}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {sensitivity.rows.map((row, ri) => (
                      <tr key={ri}>
                        <td style={{ ...s.td, fontWeight: 600, fontSize: '0.72rem', background: '#f8fafc' }}>
                          {typeof row.label === 'number' ? fmt.pct(row.label * 100) : row.label}
                        </td>
                        {(row.values || row.cells || []).map((v, ci) => (
                          <td key={ci} style={s.heatCell(Number(v), minV, maxV)}>{fmt.moneyInt(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 6: RECOMMENDATION
// ════════════════════════════════════════════════════════════════
// Decision config — decides Pipeline card + Overview + Recommendation tab badge colours
export const DECISION_STYLES = {
  proceed:     { label: 'Proceed',     bg: '#d1fae5', fg: '#065f46', border: '#10b981' },
  conditional: { label: 'Conditional', bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' },
  pass:        { label: 'Pass',        bg: '#fee2e2', fg: '#991b1b', border: '#ef4444' },
  hold:        { label: 'Hold',        bg: '#e0e7ff', fg: '#3730a3', border: '#6366f1' },
  draft:       { label: 'Draft',       bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' },
};

function DecisionBadge({ decision, size = 'md' }) {
  const cfg = DECISION_STYLES[decision] || DECISION_STYLES.draft;
  const pad = size === 'sm' ? '2px 8px' : '4px 12px';
  const font = size === 'sm' ? '0.7rem' : '0.8rem';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: pad, borderRadius: 10, background: cfg.bg, color: cfg.fg,
      fontWeight: 700, fontSize: font,
      border: `1px solid ${cfg.border}40`,
    }}>
      {cfg.label}
    </span>
  );
}

function RecommendationTab({ deal, modelOutputs, refreshDeal }) {
  const toast = useToast();
  const baseOutputs = (deal.outputs || []).filter(o => o.scenario === 'base');
  const blended = baseOutputs.find(o => o.metric_name === 'Blended Valuation');
  const irrOut  = baseOutputs.find(o => o.metric_name === 'Implied IRR');
  const moicOut = baseOutputs.find(o => o.metric_name === 'MOIC');
  const dcfEv   = baseOutputs.find(o => o.metric_name === 'DCF Enterprise Value');

  const [record, setRecord] = useState(undefined); // undefined = loading, null = none
  const [form, setForm] = useState({
    decision: 'draft',
    thesis: '',
    risks: '',
    valuation_summary: '',
    recommended_action: '',
  });
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draftedByAI, setDraftedByAI] = useState(false);
  const [linkedModelRunId, setLinkedModelRunId] = useState(null);
  const autoSaveTimer = useRef(null);

  // Load latest recommendation
  useEffect(() => {
    (async () => {
      try {
        const r = await getRecommendation(deal.deal_id);
        setRecord(r);
        if (r) {
          setForm({
            decision: r.decision || 'draft',
            thesis: r.thesis || '',
            risks: r.risks || '',
            valuation_summary: r.valuation_summary || '',
            recommended_action: r.recommended_action || '',
          });
          setDraftedByAI(!!r.drafted_by_ai);
          setLinkedModelRunId(r.linked_model_run_id || null);
        }
      } catch (err) {
        console.error('Load recommendation failed:', err);
        setRecord(null);
      }
    })();
  }, [deal.deal_id]);

  // Debounced auto-save
  useEffect(() => {
    if (!dirty) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doSave(false), 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line
  }, [form, dirty]);

  const doSave = async (showToast = true) => {
    setSaving(true);
    try {
      const saved = await saveRecommendation(deal.deal_id, {
        ...form,
        linked_model_run_id: linkedModelRunId,
        drafted_by_ai: draftedByAI ? 1 : 0,
        author: deal.lead_analyst || 'analyst',
      });
      setRecord(saved);
      setDirty(false);
      if (showToast) toast.push('Recommendation saved', 'success');
    } catch (err) {
      console.error('Save failed:', err);
      if (showToast) toast.push('Save failed: ' + (err.message || 'unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    // Editing an AI draft means it's no longer "purely AI" — but we keep the flag
    // so the user can see which baseline they started from.
  };

  const handleAIDraft = async () => {
    if (dirty) {
      const ok = confirm('You have unsaved edits. Drafting with AI will overwrite them. Continue?');
      if (!ok) return;
    }
    setDrafting(true);
    try {
      const draft = await draftRecommendationAI(deal.deal_id);
      setForm({
        decision: draft.decision || 'draft',
        thesis: draft.thesis || '',
        risks: draft.risks || '',
        valuation_summary: draft.valuation_summary || '',
        recommended_action: draft.recommended_action || '',
      });
      setDraftedByAI(true);
      setLinkedModelRunId(draft.linked_model_run_id || null);
      setDirty(true);
      toast.push(`Draft generated (${draft.tokensUsed || '?'} tokens, ${Math.round((draft.latencyMs || 0) / 1000)}s)`, 'success', 6000);
    } catch (err) {
      const msg = err.response?.data?.details || err.message || 'Draft failed';
      toast.push('AI draft failed: ' + msg, 'error', 6000);
    } finally {
      setDrafting(false);
    }
  };

  const handleExportMarkdown = () => {
    const md = buildMarkdownMemo(deal, form, { dcfEv, blended, irrOut, moicOut });
    navigator.clipboard.writeText(md).then(
      () => toast.push('IC memo copied to clipboard (Markdown)', 'success'),
      () => toast.push('Clipboard access denied', 'error')
    );
  };

  const handleExportPDF = () => {
    // Use window.print on a printable view — lightweight, no deps
    const win = window.open('', '_blank');
    if (!win) { toast.push('Pop-up blocked — allow pop-ups to export PDF', 'error'); return; }
    win.document.write(buildPrintHTML(deal, form, { dcfEv, blended, irrOut, moicOut }));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  // Is the linked model run still the latest base run?
  const latestBaseRun = (deal.model_runs || []).find(r => r.scenario === 'base');
  const modelStale = linkedModelRunId && latestBaseRun && latestBaseRun.id !== linkedModelRunId;

  // Valuation gap signal
  const blendedVal = blended?.metric_value;
  const gapPct = blendedVal && deal.deal_size_estimate
    ? ((blendedVal - deal.deal_size_estimate) / deal.deal_size_estimate) * 100
    : null;
  const signal = gapPct == null ? null
               : gapPct >= 10  ? { label: 'Upside', color: '#065f46', bg: '#d1fae5' }
               : gapPct <= -10 ? { label: 'Overpriced', color: '#991b1b', bg: '#fee2e2' }
               : { label: 'Fair', color: '#475569', bg: '#f1f5f9' };

  // --- Loading state ---
  if (record === undefined) {
    return <div style={s.loadingCenter}><div style={s.spinner} /></div>;
  }

  // --- Empty state (no recommendation yet) ---
  if (!record && !dirty) {
    const canDraft = deal.financials?.length > 0 && (deal.model_runs || []).length > 0;
    return (
      <div style={{ ...s.card, padding: 40, textAlign: 'center' }}>
        <BookOpen size={48} style={{ color: '#94a3b8', marginBottom: 12 }} />
        <h3 style={{ margin: '0 0 6px', color: '#334155' }}>No Recommendation Yet</h3>
        <p style={{ fontSize: '0.88rem', color: '#64748b', maxWidth: 480, margin: '0 auto 18px' }}>
          Draft an investment-committee memo grounded in this deal's financials, sector comps, and
          valuation model. An AI analyst can produce a full 4-section first draft in about 10 seconds —
          then you edit freely.
        </p>

        {!canDraft && (
          <div style={{ padding: '10px 14px', background: '#fef3c7', border: '1px solid #fbbf24',
            borderRadius: 8, fontSize: '0.82rem', color: '#92400e', display: 'inline-block', marginBottom: 14 }}>
            AI draft needs financials and a built model first.{' '}
            {!deal.financials?.length ? 'Upload documents →' : 'Build the model →'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            style={{ ...s.btn('primary'), padding: '12px 22px' }}
            onClick={handleAIDraft}
            disabled={!canDraft || drafting}
          >
            {drafting ? <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={15} />}
            <span>{drafting ? 'Drafting…' : 'Draft with AI'}</span>
          </button>
          <button
            style={s.btn('secondary')}
            onClick={() => { setRecord({ id: 'pending' }); setDirty(true); }}
          >
            Start blank
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.row}>
      <div style={{ flex: 1, minWidth: 420 }}>
        {/* Header — decision + actions */}
        <div style={{ ...s.card, padding: '14px 18px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Decision</div>
              <select
                value={form.decision}
                onChange={(e) => handleField('decision', e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8,
                  border: `2px solid ${DECISION_STYLES[form.decision]?.border || '#e2e8f0'}`,
                  background: DECISION_STYLES[form.decision]?.bg || '#fff',
                  color: DECISION_STYLES[form.decision]?.fg || '#1e293b',
                  fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                }}
              >
                <option value="draft">Draft — not decided</option>
                <option value="proceed">Proceed</option>
                <option value="conditional">Conditional Proceed</option>
                <option value="pass">Pass</option>
                <option value="hold">Hold — need more data</option>
              </select>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: '0.75rem', color: '#64748b' }}>
              {record?.version && <span>v{record.version}</span>}
              {record?.updated_at && <span>• Updated {new Date(record.updated_at).toLocaleString()}</span>}
              {draftedByAI && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                  <Sparkles size={11} /> AI-drafted
                </span>
              )}
              {saving && <span style={{ color: '#2563eb', fontWeight: 600 }}>Saving…</span>}
              {!saving && !dirty && record?.version && <span style={{ color: '#10b981', fontWeight: 600 }}>✓ Saved</span>}
              {dirty && !saving && <span style={{ color: '#f59e0b', fontWeight: 600 }}>Unsaved</span>}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button style={s.btnSm('secondary')} onClick={handleAIDraft} disabled={drafting}>
                {drafting ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                {drafting ? 'Drafting…' : 'Draft with AI'}
              </button>
              <button style={s.btnSm('secondary')} onClick={handleExportMarkdown}><FileText size={13} /> Copy MD</button>
              <button style={s.btnSm('secondary')} onClick={handleExportPDF}><FileText size={13} /> Print PDF</button>
              <button style={s.btnSm('primary')} onClick={() => doSave(true)} disabled={saving || !dirty}>
                <BookOpen size={13} /> Save
              </button>
            </div>
          </div>
        </div>

        {/* Stale-model warning */}
        {modelStale && (
          <div style={{ padding: '10px 14px', background: '#fef3c7', border: '1px solid #fbbf24',
            borderRadius: 8, fontSize: '0.82rem', color: '#92400e', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={15} />
            <span style={{ flex: 1 }}>
              The model has been rebuilt since this recommendation was drafted.
              The numbers may be out of date.
            </span>
            <button style={{ ...s.btnSm('primary'), padding: '4px 10px' }} onClick={handleAIDraft}>
              Regenerate
            </button>
          </div>
        )}

        {/* 4 text sections */}
        {[
          ['Investment Thesis', 'thesis', 'Describe the investment thesis, strategic rationale, and key value drivers…', 5],
          ['Key Risks', 'risks', 'Identify key risks, mitigants, and deal-breakers…', 4],
          ['Valuation Summary', 'valuation_summary', 'Summarize the valuation methodology, implied range, and key assumptions…', 4],
          ['Recommended Action', 'recommended_action', 'Specific action — bid range, conditions precedent, or pass rationale…', 3],
        ].map(([label, key, placeholder, rows]) => (
          <div key={key} style={{ ...s.card, padding: '14px 18px', marginBottom: 10 }}>
            <div style={s.fieldLabel}>{label}</div>
            <textarea
              style={{ ...s.textarea, minHeight: rows * 26 }}
              value={form[key]}
              onChange={e => handleField(key, e.target.value)}
              placeholder={placeholder}
            />
          </div>
        ))}
      </div>

      {/* Sidebar */}
      <div style={{ width: 300, flexShrink: 0 }}>
        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Valuation Signal</h3></div>
          <div style={{ padding: '14px 18px' }}>
            {signal ? (
              <>
                <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 10, background: signal.bg, color: signal.color, fontWeight: 700, fontSize: '0.8rem', marginBottom: 10 }}>
                  {signal.label} {gapPct >= 0 ? '+' : ''}{gapPct.toFixed(1)}%
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                  {signal.label === 'Upside'
                    ? 'Blended model value exceeds the current ask. Headroom to negotiate up or capture equity.'
                    : signal.label === 'Overpriced'
                    ? 'Current ask exceeds the blended model value. Consider negotiating price down or passing.'
                    : 'Current ask is within ±10% of the blended model value.'}
                </div>
              </>
            ) : <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>No model built yet.</div>}
          </div>
        </div>

        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Key Metrics</h3></div>
          {[
            ['Ask',         deal.deal_size_estimate ? `$${deal.deal_size_estimate}M` : '-'],
            ['DCF EV',      dcfEv ? fmt.moneyInt(dcfEv.metric_value) : '-'],
            ['Blended EV',  blended ? fmt.moneyInt(blended.metric_value) : '-'],
            ['IRR',         irrOut ? fmt.pct(irrOut.metric_value) : '-'],
            ['MOIC',        moicOut != null ? `${Number(moicOut.metric_value).toFixed(2)}x` : '-'],
          ].map(([k, v]) => (
            <div key={k} style={s.kv}><span style={s.kvLabel}>{k}</span><span style={s.kvValue}>{v}</span></div>
          ))}
        </div>

        <div style={s.card}>
          <div style={s.cardHead}><h3 style={s.cardTitle}>Deal Info</h3></div>
          {[
            ['Stage', prettyStage(deal.stage)],
            ['Sector', deal.sector],
            ['Target', deal.target_company],
            ['Lead', deal.lead_analyst],
          ].map(([k, v]) => (
            <div key={k} style={s.kv}><span style={s.kvLabel}>{k}</span><span style={s.kvValue}>{v || '-'}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Markdown IC memo builder
function buildMarkdownMemo(deal, form, metrics) {
  const { dcfEv, blended, irrOut, moicOut } = metrics;
  return `# Investment Committee Memo — ${deal.deal_name}

**Target:** ${deal.target_company}  **Sector:** ${deal.sector}  **Stage:** ${deal.stage}
**Ask:** $${deal.deal_size_estimate}M  **Lead Analyst:** ${deal.lead_analyst || '—'}

**Decision:** ${(DECISION_STYLES[form.decision]?.label || 'Draft').toUpperCase()}

---

## Key Metrics

| Metric | Value |
|---|---|
| DCF Enterprise Value | ${dcfEv ? '$' + Math.round(dcfEv.metric_value) + 'M' : '—'} |
| Blended Enterprise Value | ${blended ? '$' + Math.round(blended.metric_value) + 'M' : '—'} |
| Implied IRR | ${irrOut ? irrOut.metric_value.toFixed(1) + '%' : '—'} |
| MOIC | ${moicOut ? moicOut.metric_value.toFixed(2) + 'x' : '—'} |

## Investment Thesis

${form.thesis || '*(not provided)*'}

## Key Risks

${form.risks || '*(not provided)*'}

## Valuation Summary

${form.valuation_summary || '*(not provided)*'}

## Recommended Action

${form.recommended_action || '*(not provided)*'}

---

*Generated by DealForge — ${new Date().toLocaleString()}*
`;
}

// Print-ready HTML for PDF export
function buildPrintHTML(deal, form, metrics) {
  const md = buildMarkdownMemo(deal, form, metrics);
  // Simple markdown → HTML (handles headings, tables, paragraphs, horizontal rules)
  const html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\|(.+?)\|/g, (m, row) => {
      const cells = row.split('|').map(c => c.trim()).filter(c => c.length);
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.+?<\/tr>\n?)+/gs, (tbl) => `<table>${tbl}</table>`)
    .split('\n\n').map(p => p.trim() ? (p.startsWith('<') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`) : '').join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>IC Memo — ${deal.deal_name}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:780px;margin:40px auto;padding:0 32px;color:#1e293b;line-height:1.55}
h1{font-size:1.6rem;margin:0 0 6px;color:#0f172a}
h2{font-size:1.1rem;margin:22px 0 8px;color:#2563eb;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin:12px 0}
td{padding:6px 10px;border:1px solid #e2e8f0;font-size:0.9rem}
td:first-child{background:#f8fafc;font-weight:600;width:40%}
p{margin:8px 0}
hr{border:none;border-top:1px solid #cbd5e1;margin:18px 0}
@media print{body{margin:0;padding:24px}}
</style></head><body>${html}</body></html>`;
}

// ════════════════════════════════════════════════════════════════
// TAB 7: TIMELINE (audit log)
// ════════════════════════════════════════════════════════════════
function TimelineTab({ deal }) {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    getDealTimeline(deal.deal_id)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [deal.deal_id]);

  const typeColor = (ev) => {
    if (!ev) return '#94a3b8';
    if (ev.includes('closed') || ev.includes('approved')) return '#10b981';
    if (ev.includes('passed') || ev.includes('rejected') || ev.includes('failed')) return '#ef4444';
    if (ev.includes('model')) return '#8b5cf6';
    if (ev.includes('extract')) return '#06b6d4';
    if (ev.includes('document')) return '#f59e0b';
    if (ev.includes('review')) return '#ec4899';
    return '#2563eb';
  };

  const describe = (ev, details) => {
    switch (ev) {
      case 'deal.created':   return `Deal created by ${details.sector ? `lead for ${details.sector}` : 'analyst'}`;
      case 'deal.updated':   return `Deal updated`;
      case 'deal.closed':    return `Deal closed at ${details.multiple || details.close_multiple || '-'} — $${details.deal_value || '-'}M`;
      case 'deal.passed':    return `Deal passed — ${details.reason || 'no reason given'}`;
      case 'deal.stage_changed': return `Stage: ${details.from} → ${details.to}`;
      case 'document.uploaded': return `${details.count || 1} document(s) uploaded${details.filenames ? `: ${details.filenames.slice(0, 2).join(', ')}${details.filenames.length > 2 ? '…' : ''}` : ''}`;
      case 'document.deleted': return `Document deleted: ${details.filename || ''}`;
      case 'extraction.started': return `Extraction pipeline started — ${details.documents || '?'} documents`;
      case 'extraction.completed': return `Extraction completed — ${details.financials_loaded || 0} period(s) loaded in ${details.duration_sec || '?'}s`;
      case 'extraction.failed': return `Extraction failed`;
      case 'extraction_loaded': return `Agent loaded ${details.periods?.length || 0} period(s)`;
      case 'model.built': return `Model built — ${details.scenarios || 3} scenarios`;
      case 'hitl.approved': return `Review approved (${details.scenario || details.entity_type || ''})`;
      case 'hitl.created': return `Review created`;
      case 'hitl.updated': return `Review updated`;
      case 'hitl.changes_requested': return `Changes requested: ${details.note || ''}`;
      case 'settings.updated': return `Settings updated`;
      default: return ev?.replace(/[._]/g, ' ') || 'Event';
    }
  };

  if (events === null) {
    return <div style={s.empty}><Loader size={24} style={{ animation: 'spin 1s linear infinite' }} /></div>;
  }
  if (events.length === 0) {
    return <div style={s.empty}><Activity size={40} /><h3 style={{ margin: '12px 0 4px' }}>No Timeline Events</h3><p>Events will appear here as the deal progresses through the pipeline.</p></div>;
  }

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <h3 style={s.cardTitle}>Activity Timeline</h3>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{events.length} events</span>
      </div>
      <div style={{ padding: '8px 0' }}>
        {events.map((e, i) => {
          let details = {};
          try { details = typeof e.details_json === 'string' ? JSON.parse(e.details_json) : e.details_json || {}; } catch {}
          const color = typeColor(e.event_type);
          return (
            <div key={e.id || i} style={{
              display: 'flex', gap: 14, padding: '12px 20px',
              borderBottom: '1px solid #f1f5f9', position: 'relative',
            }}>
              <div style={{ position: 'relative', width: 12, flexShrink: 0 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: color, marginTop: 4,
                  boxShadow: `0 0 0 3px ${color}22`,
                }} />
                {i < events.length - 1 && (
                  <div style={{
                    position: 'absolute', top: 16, left: 4, width: 2, bottom: -12,
                    background: '#e2e8f0',
                  }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.86rem', color: '#1e293b', fontWeight: 500 }}>
                  {describe(e.event_type, details)}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: '0.72rem', color: '#94a3b8' }}>
                  <span>{e.actor || 'system'}</span>
                  <span>•</span>
                  <span>{e.timestamp ? new Date(e.timestamp).toLocaleString() : '-'}</span>
                  {e.entity_type && e.entity_id && (
                    <>
                      <span>•</span>
                      <span>{e.entity_type} #{e.entity_id}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// AGENT TRACE PANEL — shows what each 7-stage pipeline agent produced
// ════════════════════════════════════════════════════════════════
const STAGES = [
  { key: 'parsing',       label: 'Parse documents',       icon: FileText,    model: '—' },
  { key: 'classifying',   label: 'Classify document type', icon: BookOpen,    model: 'Claude Haiku' },
  { key: 'extracting',    label: 'Extract financials',     icon: DollarSign,  model: 'Claude Sonnet' },
  { key: 'reconciling',   label: 'Reconcile cross-docs',   icon: RefreshCw,   model: '—' },
  { key: 'sector',        label: 'Sector & comps',          icon: TrendingUp, model: 'Claude Sonnet' },
  { key: 'quality',       label: 'Quality checks',          icon: Shield,      model: '—' },
  { key: 'loading',       label: 'Load to database',        icon: Upload,      model: '—' },
];

function AgentTracePanel({ dealId, deal }) {
  const [expanded, setExpanded] = useState(false);
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    getExtractionJobsForDeal(dealId).then(setJobs).catch(() => setJobs([]));
  }, [dealId]);

  if (jobs === null) return null;
  const latestJob = jobs?.find(j => j.status === 'completed' || j.status === 'paused') || jobs?.[0];

  const docs = deal.documents || [];
  const financials = deal.financials || [];

  // Estimate per-stage status from job.stage + job.status
  const stageStatus = {};
  if (latestJob) {
    const progress = latestJob.progress_pct || 0;
    // Stages marked done based on progress thresholds (matches pipeline.js weights)
    const done = progress >= 100;
    stageStatus.parsing     = progress > 10  ? 'done' : 'pending';
    stageStatus.classifying = progress > 20  ? 'done' : 'pending';
    stageStatus.extracting  = progress > 55  ? 'done' : 'pending';
    stageStatus.reconciling = progress > 65  ? 'done' : 'pending';
    stageStatus.sector      = progress > 80  ? 'done' : 'pending';
    stageStatus.quality     = progress > 90  ? 'done' : 'pending';
    stageStatus.loading     = done ? 'done' : 'pending';
    if (latestJob.status === 'failed') {
      stageStatus[latestJob.stage] = 'failed';
    } else if (latestJob.status === 'paused') {
      stageStatus.quality = 'review';
    }
  }

  // Pipeline state for details
  let state = null;
  try { state = latestJob?.pipeline_state ? JSON.parse(latestJob.pipeline_state) : null; } catch {}

  const renderDetail = (stage) => {
    switch (stage) {
      case 'parsing':
        return `${docs.length} document(s) in deal (${docs.map(d => d.filename).slice(0, 2).join(', ')}${docs.length > 2 ? '…' : ''})`;
      case 'classifying': {
        if (!docs.length) return '—';
        const items = docs.slice(0, 3).map(d => `${d.filename} → ${d.document_type || 'unknown'} (${d.classification_confidence != null ? Math.round(d.classification_confidence * 100) + '%' : '?'})`);
        return items.join(' · ');
      }
      case 'extracting':
        return financials.length
          ? `${financials.length} period(s) extracted, avg confidence ${Math.round((financials.reduce((s, f) => s + (f.confidence || 0), 0) / financials.length) * 100)}%`
          : 'No periods extracted';
      case 'reconciling':
        return state?.reconciled?.conflicts?.length
          ? `${state.reconciled.conflicts.length} conflict(s) resolved`
          : '1 source — no conflicts to reconcile';
      case 'sector': {
        const suggested = state?.sectorResult?.classification?.primary_sector;
        if (suggested && suggested !== deal.sector) {
          return `Agent suggested ${suggested}; kept user's ${deal.sector}`;
        }
        return `Classified as ${deal.sector || '—'}; ${state?.sectorResult?.selected_comps?.length || 0} comps selected`;
      }
      case 'quality': {
        const report = state?.qualityReport;
        if (report) {
          return `Score ${report.score}/100 — ${report.issues?.filter(i => i.severity === 'error').length || 0} errors, ${report.issues?.filter(i => i.severity === 'warning').length || 0} warnings`;
        }
        return latestJob ? 'Checks ran' : '—';
      }
      case 'loading':
        return `${financials.length} financial rows, ${deal.assumptions?.length || 0} assumptions inserted`;
      default: return '—';
    }
  };

  return (
    <div style={{ ...s.card, marginBottom: 16 }}>
      <div
        style={{ ...s.cardHead, cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <h3 style={{ ...s.cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={15} style={{ color: '#8b5cf6' }} />
          Agent Pipeline Trace
          <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#94a3b8' }}>
            {latestJob
              ? `${latestJob.status} · ${Math.round(latestJob.progress_pct || 0)}%`
              : 'never run'}
          </span>
        </h3>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>
      {expanded && (
        <div style={{ padding: '8px 0 14px' }}>
          {!latestJob ? (
            <div style={{ padding: '20px 22px', fontSize: '0.85rem', color: '#64748b' }}>
              No extraction pipeline has run for this deal yet. Upload documents to trigger the 7-stage agent pipeline.
            </div>
          ) : (
            STAGES.map((stg, i) => {
              const status = stageStatus[stg.key] || 'pending';
              const Icon = stg.icon;
              const dotColor = status === 'done' ? '#10b981'
                             : status === 'failed' ? '#ef4444'
                             : status === 'review' ? '#f59e0b'
                             : '#cbd5e1';
              return (
                <div key={stg.key} style={{ display: 'flex', gap: 12, padding: '8px 22px', alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', marginTop: 2 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: dotColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {status === 'done' && <CheckCircle size={12} style={{ color: dotColor }} />}
                      {status === 'failed' && <XCircle size={12} style={{ color: dotColor }} />}
                      {status === 'review' && <AlertCircle size={12} style={{ color: dotColor }} />}
                      {status === 'pending' && <Icon size={11} style={{ color: '#94a3b8' }} />}
                    </div>
                    {i < STAGES.length - 1 && (
                      <div style={{ position: 'absolute', top: 22, left: 10, width: 2, height: 22, background: '#e2e8f0' }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', fontWeight: 600, color: status === 'pending' ? '#94a3b8' : '#1e293b' }}>
                      {stg.label}
                      {stg.model !== '—' && (
                        <span style={{ fontSize: '0.66rem', fontWeight: 500, color: '#8b5cf6', background: '#f5f3ff', padding: '1px 6px', borderRadius: 6 }}>
                          {stg.model}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: 2 }}>
                      {renderDetail(stg.key)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div style={{ padding: '10px 22px 0', fontSize: '0.72rem', color: '#94a3b8', borderTop: '1px solid #f1f5f9', marginTop: 4 }}>
            All math (DCF, comps, IRR, sensitivity) is computed by deterministic JavaScript. AI agents supply the inputs — they never perform arithmetic.
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN: DealDetail
// ════════════════════════════════════════════════════════════════
const TABS = ['Overview', 'Documents', 'Target Financials', 'Comparables', 'Model', 'Recommendation', 'Timeline'];

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Overview');

  const fetchDeal = async () => {
    try {
      const data = await getDealFull(id);
      if (data) setDeal(data);
      // On transient failure: keep the existing deal state. Otherwise navigating
      // away and back quickly would clear all the financials/model tabs.
    } catch (err) {
      console.error('Failed to fetch deal:', err);
    }
  };

  useEffect(() => {
    (async () => {
      await fetchDeal();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const refreshDeal = fetchDeal;

  if (loading) {
    return <div style={s.loadingCenter}><div style={s.spinner} /></div>;
  }
  if (!deal) {
    return (
      <div style={s.empty}>
        <AlertCircle size={48} style={{ marginBottom: 12 }} />
        <h3 style={{ margin: '0 0 8px' }}>Deal Not Found</h3>
        <p>The requested deal could not be loaded.</p>
        <button style={{ ...s.btn('primary'), marginTop: 12 }} onClick={() => navigate('/pipeline')}><ArrowLeft size={15} /> Back to Pipeline</button>
      </div>
    );
  }

  // Parse the first model run outputs for cross-tab access
  const runs = deal.model_runs || [];
  const baseRun = runs.find(r => r.scenario === 'base') || runs[0];
  const modelOutputs = parseSafe(baseRun?.outputs_json);

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate('/pipeline')}><ArrowLeft size={16} /></button>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={s.dealName}>{deal.deal_name || 'Untitled Deal'}</h2>
            {deal.is_dummy === 1 && <span style={s.sampleBadge}>Sample</span>}
          </div>
          <div style={s.meta}>
            <span><User size={13} style={{ verticalAlign: 'middle', marginRight: 3 }} />{deal.target_company || '-'}</span>
            <span style={s.stageBadge(deal.stage)}>{prettyStage(deal.stage)}</span>
            {deal.deal_size_estimate > 0 && <span><DollarSign size={13} style={{ verticalAlign: 'middle' }} />{deal.deal_size_estimate}M</span>}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={s.tabBar}>
        {TABS.map(tab => (
          <button key={tab} style={s.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>{tab}</button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'Overview' && <OverviewTab deal={deal} modelOutputs={modelOutputs} onTabChange={setActiveTab} />}
      {activeTab === 'Documents' && <DocumentsTab deal={deal} refreshDeal={refreshDeal} />}
      {activeTab === 'Target Financials' && <FinancialsTab deal={deal} />}
      {activeTab === 'Comparables' && <ComparablesTab deal={deal} modelOutputs={modelOutputs} />}
      {activeTab === 'Model' && <ModelTab deal={deal} refreshDeal={refreshDeal} />}
      {activeTab === 'Recommendation' && <RecommendationTab deal={deal} modelOutputs={modelOutputs} refreshDeal={refreshDeal} />}
      {activeTab === 'Timeline' && <TimelineTab deal={deal} />}
    </div>
  );
}
