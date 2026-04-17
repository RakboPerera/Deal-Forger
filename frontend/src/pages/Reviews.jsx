import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getReviews, updateReview, getExtractionJob, resumeExtraction, getModelRun
} from '../api';
import {
  ShieldCheck, AlertCircle, CheckCircle2, XCircle, RefreshCw,
  FileText, Calculator, Loader, ChevronRight, Clock
} from 'lucide-react';

const styles = {
  page: { padding: '20px 24px 40px', maxWidth: 1100, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  title: { margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#1e293b' },
  subtitle: { margin: 0, fontSize: '0.85rem', color: '#64748b' },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #e2e8f0' },
  tab: (active) => ({
    padding: '10px 16px', fontSize: '0.82rem', fontWeight: active ? 600 : 500,
    color: active ? '#2563eb' : '#64748b', background: 'none', border: 'none',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    cursor: 'pointer', marginBottom: -2,
  }),
  card: {
    background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
    marginBottom: 12, overflow: 'hidden',
  },
  cardHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid #f1f5f9',
  },
  cardBody: { padding: '14px 18px', fontSize: '0.86rem', color: '#475569' },
  badge: (bg, color) => ({
    fontSize: '0.7rem', fontWeight: 600, background: bg, color,
    padding: '3px 10px', borderRadius: 10,
  }),
  btn: (variant = 'primary') => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
    fontSize: '0.78rem', fontWeight: 600, border: 'none', borderRadius: 6,
    cursor: 'pointer',
    color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#fff' : '#475569',
    background: variant === 'primary' ? '#2563eb' : variant === 'danger' ? '#ef4444' : '#f1f5f9',
  }),
  empty: {
    textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: '0.9rem',
  },
  metaRow: {
    display: 'flex', gap: 14, alignItems: 'center',
    fontSize: '0.76rem', color: '#64748b',
  },
};

function decisionBadge(decision) {
  if (decision === 'approved') return styles.badge('#d1fae5', '#065f46');
  if (decision === 'rejected') return styles.badge('#fee2e2', '#991b1b');
  if (decision === 'changes_requested') return styles.badge('#fef3c7', '#92400e');
  return styles.badge('#f1f5f9', '#64748b');
}

function entityIcon(type) {
  if (type === 'extraction_job') return <FileText size={14} />;
  if (type === 'model_run') return <Calculator size={14} />;
  return <ShieldCheck size={14} />;
}

export default function Reviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [processing, setProcessing] = useState({});

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const data = await getReviews();
      setReviews(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReviews(); }, []);

  const [decisionPrompt, setDecisionPrompt] = useState(null); // { reviewId, decision, entityType, entityId }
  const [decisionNote, setDecisionNote] = useState('');

  const confirmDecision = async () => {
    const p = decisionPrompt;
    if (!p) return;
    setProcessing(pp => ({ ...pp, [p.reviewId]: true }));
    try {
      await updateReview(p.reviewId, {
        decision: p.decision,
        reviewer: 'analyst',
        notes: decisionNote,
      });
      if (p.decision === 'approved' && p.entityType === 'extraction_job') {
        try { await resumeExtraction(p.entityId); } catch (e) {
          console.error('Resume failed:', e);
        }
      }
      await fetchReviews();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(pp => ({ ...pp, [p.reviewId]: false }));
      setDecisionPrompt(null);
      setDecisionNote('');
    }
  };

  const handleDecision = (id, decision, entityType, entityId) => {
    setDecisionPrompt({ reviewId: id, decision, entityType, entityId });
    setDecisionNote('');
  };

  const filtered = reviews.filter(r => {
    if (filter === 'pending') return !r.decision;
    if (filter === 'approved') return r.decision === 'approved';
    if (filter === 'rejected') return r.decision === 'rejected';
    return true;
  });

  const counts = {
    pending: reviews.filter(r => !r.decision).length,
    approved: reviews.filter(r => r.decision === 'approved').length,
    rejected: reviews.filter(r => r.decision === 'rejected').length,
    all: reviews.length,
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ShieldCheck size={20} style={{ color: '#2563eb' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={styles.title}>Human-in-the-Loop Reviews</h1>
          <p style={styles.subtitle}>Approve extraction jobs paused by quality checks, or approve model runs before sending to IC.</p>
        </div>
        <button style={styles.btn('secondary')} onClick={fetchReviews}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div style={styles.tabs}>
        {[
          ['pending', `Pending (${counts.pending})`],
          ['approved', `Approved (${counts.approved})`],
          ['rejected', `Rejected (${counts.rejected})`],
          ['all', `All (${counts.all})`],
        ].map(([key, label]) => (
          <button key={key} style={styles.tab(filter === key)} onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={styles.empty}>
          <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>
          <ShieldCheck size={48} style={{ color: '#cbd5e1', marginBottom: 12 }} />
          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            No {filter === 'all' ? '' : filter} reviews
          </div>
          <div>Paused extraction jobs and model-run approvals will appear here.</div>
        </div>
      ) : (
        filtered.map(r => (
          <ReviewCard
            key={r.id}
            review={r}
            processing={processing[r.id]}
            onDecision={(decision) => handleDecision(r.id, decision, r.entity_type, r.entity_id)}
          />
        ))
      )}

      {/* Decision modal — captures reviewer notes */}
      {decisionPrompt && (
        <div
          onClick={() => setDecisionPrompt(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, maxWidth: 440, width: '100%',
              padding: 22, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700, color: '#1e293b' }}>
              {decisionPrompt.decision === 'approved' ? 'Approve' : 'Reject'} review?
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: '#64748b' }}>
              {decisionPrompt.entityType === 'extraction_job' && decisionPrompt.decision === 'approved'
                ? 'Approving will resume the paused extraction pipeline.'
                : 'Add a note for the audit trail (optional).'}
            </p>
            <textarea
              value={decisionNote}
              onChange={e => setDecisionNote(e.target.value)}
              placeholder="Notes (optional) — e.g., 'Financials verified against annual report'"
              rows={4}
              style={{
                width: '100%', padding: 10, borderRadius: 8,
                border: '1px solid #e2e8f0', fontSize: '0.85rem',
                fontFamily: 'inherit', resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setDecisionPrompt(null)}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: '#f1f5f9', color: '#475569', fontWeight: 600,
                  fontSize: '0.82rem', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDecision}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: decisionPrompt.decision === 'approved' ? '#2563eb' : '#ef4444',
                  color: '#fff', fontWeight: 600,
                  fontSize: '0.82rem', cursor: 'pointer',
                }}
              >
                Confirm {decisionPrompt.decision === 'approved' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review, processing, onDecision }) {
  const [details, setDetails] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const loadDetails = async () => {
    if (details) { setShowDetails(!showDetails); return; }
    try {
      if (review.entity_type === 'extraction_job') {
        const job = await getExtractionJob(review.entity_id);
        setDetails(job);
      } else if (review.entity_type === 'model_run') {
        const run = await getModelRun(review.entity_id);
        setDetails(run);
      }
      setShowDetails(true);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {entityIcon(review.entity_type)}
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>
              {review.entity_type?.replace(/_/g, ' ')} #{review.entity_id}
            </div>
            <div style={styles.metaRow}>
              <span>Tier {review.tier || 2}</span>
              <span>•</span>
              <span>
                <Clock size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                {review.created_at ? new Date(review.created_at).toLocaleString() : '-'}
              </span>
              {review.reviewer && <><span>•</span><span>by {review.reviewer}</span></>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {review.decision ? (
            <span style={decisionBadge(review.decision)}>{review.decision}</span>
          ) : (
            <span style={decisionBadge(null)}>pending</span>
          )}
          {!review.decision && (
            <>
              <button
                style={styles.btn('primary')}
                disabled={processing}
                onClick={() => onDecision('approved')}
              >
                <CheckCircle2 size={12} /> Approve
              </button>
              <button
                style={styles.btn('danger')}
                disabled={processing}
                onClick={() => onDecision('rejected')}
              >
                <XCircle size={12} /> Reject
              </button>
            </>
          )}
          <button style={styles.btn('secondary')} onClick={loadDetails}>
            {showDetails ? 'Hide' : 'Details'} <ChevronRight size={12} />
          </button>
        </div>
      </div>

      <div style={styles.cardBody}>
        {review.notes && (
          <div style={{ marginBottom: 8 }}>
            <strong>Reason:</strong> {review.notes}
          </div>
        )}

        {showDetails && details && (
          <div style={{ marginTop: 10, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto' }}>
            {renderDetails(review.entity_type, details)}
          </div>
        )}

        {review.entity_type === 'extraction_job' && (
          <Link
            to={`/deals/${details?.deal_id || ''}`}
            style={{ fontSize: '0.78rem', color: '#2563eb', textDecoration: 'none' }}
          >
            {details?.deal_id && <>View deal →</>}
          </Link>
        )}
      </div>
    </div>
  );
}

function renderDetails(type, d) {
  if (type === 'extraction_job') {
    let state = null;
    try { state = d.pipeline_state ? JSON.parse(d.pipeline_state) : null; } catch {}
    const issues = state?.qualityReport?.issues || [];
    const score = state?.qualityReport?.score;
    const lines = [
      `Deal: ${d.deal_id}`,
      `Status: ${d.status}`,
      `Stage: ${d.stage}`,
      `Progress: ${d.progress_pct ?? d.progress}%`,
      score != null ? `Quality score: ${score}/100` : null,
      d.error_message ? `Error: ${d.error_message}` : null,
    ].filter(Boolean);

    return [
      ...lines,
      issues.length ? '' : null,
      issues.length ? 'Quality issues:' : null,
      ...issues.slice(0, 10).map(i => `• [${i.severity}] ${i.field || 'general'}: ${i.message}`),
    ].filter(l => l !== null).join('\n');
  }

  if (type === 'model_run') {
    const out = (() => { try { return JSON.parse(d.outputs_json); } catch { return {}; } })();
    const val = out?.footballField?.blendedValue?.weighted;
    return [
      `Deal: ${d.deal_id}`,
      `Scenario: ${d.scenario}`,
      `Template: ${d.template_name} ${d.template_version || ''}`,
      `Blended EV: $${val?.toFixed(0) || '-'}M`,
      `DCF EV: $${out?.dcf?.enterpriseValue?.toFixed(0) || '-'}M`,
      `IRR: ${out?.irr ? (out.irr * 100).toFixed(1) + '%' : '-'}`,
      d.created_at ? `Created: ${new Date(d.created_at).toLocaleString()}` : null,
    ].filter(Boolean).join('\n');
  }

  return JSON.stringify(d, null, 2);
}
