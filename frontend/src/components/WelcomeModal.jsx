import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Layers, FileText, Calculator, MessageSquare,
  ShieldCheck, ChevronRight, X, CheckCircle2
} from 'lucide-react';

const STORAGE_KEY = 'dealforge_welcome_seen_v1';

const STEPS = [
  {
    icon: Sparkles,
    color: '#8b5cf6',
    title: 'Welcome to DealForge',
    body: 'An AI-powered deal analysis platform for M&A professionals. This tour takes 30 seconds — skip if you know the drill.',
  },
  {
    icon: Layers,
    color: '#2563eb',
    title: '1. Browse the Pipeline',
    body: 'Your deals, grouped by stage (Screening → DD → Negotiation → Closed). Drag cards across stages. Six sample deals are seeded for demo — each card shows blended EV and IRR once modeled.',
  },
  {
    icon: FileText,
    color: '#06b6d4',
    title: '2. Upload Documents',
    body: 'Open any deal and drop CIMs, PDFs, or XLSX files. A 7-stage intake pipeline (Parse → Classify → Extract → Reconcile → Sector → Quality → Load) processes them automatically. Watch progress live.',
  },
  {
    icon: Calculator,
    color: '#10b981',
    title: '3. Build the Model',
    body: 'Once data is loaded, click "Build Model" to run DCF, Trading Comps, Precedent Transactions, and Football Field valuations across Base/Upside/Downside scenarios. All math is deterministic JS — no AI arithmetic.',
  },
  {
    icon: ShieldCheck,
    color: '#f59e0b',
    title: '4. Human-in-the-Loop Review',
    body: 'Paused extractions and pending model approvals land in the Reviews tab. Approve, reject, or request changes with audit-logged notes.',
  },
  {
    icon: MessageSquare,
    color: '#ec4899',
    title: '5. Ask the AI Anything',
    body: 'Chat uses Claude with 6 tools (query_deal, query_model_outputs, compare_scenarios, etc). Configure your API key in Settings, or rely on the built-in SQL fallback for demo queries.',
  },
];

export default function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Small delay so the first render settles first
        setTimeout(() => setOpen(true), 400);
      }
    } catch {}
  }, []);

  const close = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    setOpen(false);
  };

  if (!open) return null;

  const s = STEPS[step];
  const Icon = s.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.7)',
        zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, maxWidth: 520, width: '100%',
          padding: '28px 28px 22px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          position: 'relative',
        }}
      >
        <button
          onClick={close}
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#94a3b8', padding: 4,
          }}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 24 : 8, height: 4, borderRadius: 2,
              background: i <= step ? '#2563eb' : '#e2e8f0',
              transition: 'all 0.25s ease',
            }} />
          ))}
        </div>

        <div style={{
          width: 60, height: 60, borderRadius: 14,
          background: `${s.color}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 14,
        }}>
          <Icon size={28} style={{ color: s.color }} />
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: '1.35rem', fontWeight: 700, color: '#1e293b' }}>
          {s.title}
        </h2>
        <p style={{ margin: '0 0 22px', fontSize: '0.92rem', lineHeight: 1.55, color: '#475569' }}>
          {s.body}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button
            onClick={close}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#64748b', fontSize: '0.85rem', fontWeight: 500,
              padding: '6px 10px',
            }}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                style={{
                  padding: '9px 18px', background: '#f1f5f9', color: '#475569',
                  border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            {isLast ? (
              <Link
                to="/pipeline"
                onClick={close}
                style={{
                  padding: '9px 18px', background: '#2563eb', color: '#fff',
                  border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  textDecoration: 'none',
                }}
              >
                <CheckCircle2 size={14} /> Get started
              </Link>
            ) : (
              <button
                onClick={() => setStep(s => s + 1)}
                style={{
                  padding: '9px 18px', background: '#2563eb', color: '#fff',
                  border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                Next <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
