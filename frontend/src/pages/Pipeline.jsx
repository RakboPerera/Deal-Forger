import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDeals, updateDeal, createDeal, getOutputs, getRecommendation } from '../api';
import {
  Plus, DollarSign, TrendingUp, CheckCircle, BarChart3,
  Clock, User, X, Building2, Calculator
} from 'lucide-react';

const DECISION_COLORS = {
  proceed:     { bg: '#d1fae5', fg: '#065f46', label: 'Proceed' },
  conditional: { bg: '#fef3c7', fg: '#92400e', label: 'Conditional' },
  pass:        { bg: '#fee2e2', fg: '#991b1b', label: 'Pass' },
  hold:        { bg: '#e0e7ff', fg: '#3730a3', label: 'Hold' },
  draft:       { bg: '#f1f5f9', fg: '#475569', label: 'Draft' },
};

const STAGES = [
  { key: 'screening', label: 'Screening' },
  { key: 'due_diligence', label: 'Due Diligence' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'closed', label: 'Closed' },
  { key: 'passed', label: 'Passed' },
];

// Sectors must match the vocabulary seeded in comparable_companies
// and comparable_transactions so the model builder can match comps.
const SECTORS = [
  'Enterprise SaaS',
  'HealthTech',
  'FinTech',
  'Industrial IoT',
  'Cybersecurity',
];

function NewDealModal({ onClose, onCreated }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    deal_name: '',
    target_company: '',
    sector: 'Enterprise SaaS',
    deal_size_estimate: '',
    lead_analyst: '',
    expected_close: '',
    stage: 'screening',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.deal_name || !form.target_company) return;
    setSaving(true);
    setError('');
    try {
      const created = await createDeal({
        ...form,
        deal_size_estimate: parseFloat(form.deal_size_estimate) || 0,
        date_entered: new Date().toISOString().split('T')[0],
      });
      onCreated();
      onClose();
      // Route the user directly into the new deal — Documents tab is the natural
      // next step so they can upload CIMs / financials.
      if (created?.deal_id) navigate(`/deals/${created.deal_id}`);
    } catch (err) {
      console.error('Failed to create deal:', err);
      setError(err.response?.data?.details || err.message || 'Failed to create deal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Deal</h3>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: '0.85rem', marginBottom: 12 }}>
                {error}
              </div>
            )}
            <div className="form-group">
              <label>Deal Name *</label>
              <input
                value={form.deal_name}
                onChange={e => handleChange('deal_name', e.target.value)}
                placeholder="e.g. Project Alpha"
                required
              />
            </div>
            <div className="form-group">
              <label>Target Company *</label>
              <input
                value={form.target_company}
                onChange={e => handleChange('target_company', e.target.value)}
                placeholder="e.g. Acme Corp"
                required
              />
            </div>
            <div className="form-group">
              <label>Sector</label>
              <select value={form.sector} onChange={e => handleChange('sector', e.target.value)}>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Deal Size ($M)</label>
              <input
                type="number"
                step="0.1"
                value={form.deal_size_estimate}
                onChange={e => handleChange('deal_size_estimate', e.target.value)}
                placeholder="e.g. 250"
              />
            </div>
            <div className="form-group">
              <label>Lead Analyst</label>
              <input
                value={form.lead_analyst}
                onChange={e => handleChange('lead_analyst', e.target.value)}
                placeholder="e.g. John Smith"
              />
            </div>
            <div className="form-group">
              <label>Expected Close Date</label>
              <input
                type="date"
                value={form.expected_close}
                onChange={e => handleChange('expected_close', e.target.value)}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Create Deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DealCard({ deal, metrics, recommendation, onNavigate }) {
  const daysInStage = deal.date_entered
    ? Math.floor((Date.now() - new Date(deal.date_entered).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const decision = recommendation?.decision;
  const decisionCfg = decision ? DECISION_COLORS[decision] : null;

  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: deal.deal_id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const hasModel = metrics?.blendedEV != null;
  const irrColor = metrics?.irr != null
    ? (metrics.irr >= 15 ? '#065f46' : metrics.irr >= 0 ? '#1e293b' : '#991b1b')
    : '#94a3b8';

  return (
    <div
      className="kanban-card"
      draggable
      onDragStart={handleDragStart}
      onClick={() => onNavigate(`/deals/${deal.deal_id}`)}
      style={{ cursor: 'pointer' }}
    >
      <div className="flex items-center justify-between mb-1" style={{ gap: 6 }}>
        <h4 className="truncate" style={{ flex: 1, minWidth: 0 }}>{deal.deal_name}</h4>
        {decisionCfg && (
          <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
            borderRadius: 8, background: decisionCfg.bg, color: decisionCfg.fg, flexShrink: 0 }}>
            {decisionCfg.label}
          </span>
        )}
        {deal.is_dummy ? <span className="sample-badge">Sample</span> : null}
      </div>
      <p className="text-sm text-muted">{deal.target_company || 'No target'}</p>
      <div className="flex items-center gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
        {deal.sector && (
          <span className="badge stage-badge screening">{deal.sector}</span>
        )}
        {deal.deal_size_estimate > 0 && (
          <span className="text-xs font-semibold">
            <DollarSign size={12} /> {deal.deal_size_estimate}M
          </span>
        )}
      </div>
      {hasModel && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e2e8f0' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, background: '#eff6ff', color: '#2563eb', padding: '2px 7px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Calculator size={10} /> EV ${Math.round(metrics.blendedEV)}M
          </span>
          {metrics.irr != null && (
            <span style={{ fontSize: '0.68rem', fontWeight: 600, background: '#f8fafc', color: irrColor, padding: '2px 7px', borderRadius: 8 }}>
              IRR {Number(metrics.irr).toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div className="kanban-card-meta">
        {deal.lead_analyst && (
          <span className="flex items-center gap-1">
            <User size={12} /> {deal.lead_analyst}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock size={12} /> {daysInStage}d
        </span>
      </div>
    </div>
  );
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [recsByDeal, setRecsByDeal] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [dragOverStage, setDragOverStage] = useState(null);

  const fetchDeals = async () => {
    const results = await Promise.allSettled([getDeals(), getOutputs()]);
    let dealList = [];
    if (results[0].status === 'fulfilled' && results[0].value != null) {
      const d = results[0].value;
      dealList = Array.isArray(d) ? d : d.deals || [];
      setDeals(dealList);
    }
    if (results[1].status === 'fulfilled' && results[1].value != null) {
      const o = results[1].value;
      setOutputs(Array.isArray(o) ? o : []);
    }
    setLoading(false);

    // Fetch recommendation badges in parallel (non-blocking)
    if (dealList.length) {
      const recResults = await Promise.allSettled(
        dealList.map(d => getRecommendation(d.deal_id).catch(() => null))
      );
      const map = {};
      dealList.forEach((d, i) => {
        if (recResults[i].status === 'fulfilled' && recResults[i].value) {
          map[d.deal_id] = recResults[i].value;
        }
      });
      setRecsByDeal(map);
    }
  };

  // Build per-deal metric summary from base-case outputs
  const metricsByDeal = {};
  for (const o of outputs) {
    if (o.scenario !== 'base') continue;
    if (!metricsByDeal[o.deal_id]) metricsByDeal[o.deal_id] = {};
    if (o.metric_name === 'Blended Valuation')  metricsByDeal[o.deal_id].blendedEV = o.metric_value;
    if (o.metric_name === 'Implied IRR')        metricsByDeal[o.deal_id].irr = o.metric_value;
    if (o.metric_name === 'MOIC')               metricsByDeal[o.deal_id].moic = o.metric_value;
  }

  useEffect(() => { fetchDeals(); }, []);

  const dealsByStage = (stageKey) => {
    return deals.filter(d => (d.stage || 'screening') === stageKey);
  };

  const activeList = deals.filter(d => d.stage !== 'closed' && d.stage !== 'passed');
  const activeValue = activeList.reduce((sum, d) => sum + (parseFloat(d.deal_size_estimate) || 0), 0);
  const activeDeals = activeList.length;
  const closedDeals = deals.filter(d => d.stage === 'closed').length;
  const modeledDeals = Object.keys(metricsByDeal).length;

  const handleDragOver = (e, stage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stage);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = async (e, newStageKey) => {
    e.preventDefault();
    setDragOverStage(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      const dealId = data.id;
      const deal = deals.find(d => d.deal_id === dealId);
      if (!deal || deal.stage === newStageKey) return;

      setDeals(prev => prev.map(d =>
        d.deal_id === dealId
          ? { ...d, stage: newStageKey }
          : d
      ));

      await updateDeal(dealId, { stage: newStageKey });
    } catch (err) {
      console.error('Failed to update deal stage:', err);
      fetchDeals();
    }
  };

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2>Deal Pipeline</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> New Deal
        </button>
      </div>

      {/* Stats Bar */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Deals</div>
          <div className="stat-value">{deals.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Deals</div>
          <div className="stat-value">{activeDeals}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Pipeline Value</div>
          <div className="stat-value">${activeValue.toFixed(0)}M</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Modeled / Closed</div>
          <div className="stat-value">{modeledDeals} / {closedDeals}</div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="kanban-board">
        {STAGES.map(({ key, label }) => {
          const stageDeals = dealsByStage(key);
          return (
            <div
              key={key}
              className="kanban-column"
              onDragOver={(e) => handleDragOver(e, key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, key)}
              style={{
                outline: dragOverStage === key ? '2px dashed var(--primary)' : 'none',
              }}
            >
              <div className="kanban-column-header">
                <span>{label}</span>
                <span className="count">{stageDeals.length}</span>
              </div>
              <div className="kanban-column-body">
                {stageDeals.length === 0 ? (
                  <div className="text-center text-muted text-xs p-3">
                    Drop deals here
                  </div>
                ) : (
                  stageDeals.map(deal => (
                    <DealCard
                      key={deal.deal_id}
                      deal={deal}
                      metrics={metricsByDeal[deal.deal_id]}
                      recommendation={recsByDeal[deal.deal_id]}
                      onNavigate={navigate}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Deal Modal */}
      {showModal && (
        <NewDealModal
          onClose={() => setShowModal(false)}
          onCreated={fetchDeals}
        />
      )}
    </div>
  );
}
