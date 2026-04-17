import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getCounts } from '../api';
import {
  FileText, Brain, BarChart3, Target, CheckCircle, Zap, Shield, Code,
  ArrowRight, Layers, Database, MessageSquare, PieChart, Settings,
  Upload, GitBranch, Clock, Eye, Cpu, TrendingUp, AlertTriangle,
  Users, ChevronRight
} from 'lucide-react';

/* ── Fade-in on scroll hook ──────────────────────────────────── */
function useFadeIn() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.12 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return {
    ref,
    style: {
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(28px)',
      transition: 'opacity 0.6s ease, transform 0.6s ease',
    },
  };
}

function FadeSection({ children, style: extraStyle }) {
  const fade = useFadeIn();
  return (
    <div ref={fade.ref} style={{ ...fade.style, ...extraStyle }}>
      {children}
    </div>
  );
}

/* ── Pill badge ──────────────────────────────────────────────── */
function AgentBadge({ icon: Icon, label }) {
  return (
    <span style={styles.agentBadge}>
      {Icon && <Icon size={12} />}
      <span>{label}</span>
    </span>
  );
}

/* ── Main Component ──────────────────────────────────────────── */
export default function Overview() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    getCounts().then(setCounts).catch(() => setCounts({}));
  }, []);

  return (
    <div style={styles.page}>

      {/* ════════════ HERO ════════════ */}
      <FadeSection>
        <section style={styles.hero}>
          <div style={styles.heroGlow} />
          <div style={styles.heroContent}>
            <div style={styles.heroBadge}>AI-Powered Investment Analysis</div>
            <h1 style={styles.heroTitle}>
              <span style={styles.heroTitleAccent}>DealForge</span>
            </h1>
            <p style={styles.heroTagline}>AI-Powered Deal Analysis & Financial Modelling</p>
            <p style={styles.heroDesc}>
              End-to-end investment analysis platform. From document intake to valuation models
              to deal recommendations -- powered by AI agents, controlled by you.
            </p>
            <div style={styles.heroCtas}>
              <Link to="/pipeline" style={styles.ctaPrimary}>
                Explore Pipeline <ArrowRight size={16} />
              </Link>
              <Link to="/data" style={styles.ctaSecondary}>
                View Data <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </FadeSection>

      {/* ════════════ WHAT IT SOLVES ════════════ */}
      <FadeSection>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>The Problem</span>
            <h2 style={styles.sectionTitle}>What DealForge Solves</h2>
          </div>
          <div style={styles.problemGrid}>
            {[
              {
                icon: Clock,
                title: 'Manual Data Entry',
                desc: 'Investment analysts spend days manually extracting financials from CIMs, PDFs, and data rooms.',
                color: '#ef4444',
              },
              {
                icon: AlertTriangle,
                title: 'Inconsistent Modelling',
                desc: 'Every analyst builds models differently, making comparison and QA difficult.',
                color: '#f59e0b',
              },
              {
                icon: Zap,
                title: 'Slow Turnaround',
                desc: 'Deal evaluation takes 3+ days when it should take hours.',
                color: '#8b5cf6',
              },
            ].map((p, i) => (
              <div key={i} style={styles.problemCard}>
                <div style={{ ...styles.problemIcon, background: `${p.color}15` }}>
                  <p.icon size={24} style={{ color: p.color }} />
                </div>
                <h3 style={styles.problemTitle}>{p.title}</h3>
                <p style={styles.problemDesc}>{p.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </FadeSection>

      {/* ════════════ THREE PILLARS ════════════ */}
      <FadeSection>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>Platform Architecture</span>
            <h2 style={styles.sectionTitle}>The Three Pillars</h2>
          </div>
          <div style={styles.pillarGrid}>
            {/* Pillar 1 */}
            <div style={styles.pillarCard}>
              <div style={{ ...styles.pillarIconWrap, background: '#eff6ff' }}>
                <Brain size={28} style={{ color: '#2563eb' }} />
              </div>
              <h3 style={styles.pillarTitle}>Deal Intake Brain</h3>
              <p style={styles.pillarDesc}>
                Upload documents. Our 7-agent pipeline parses, classifies, extracts financials,
                reconciles across sources, selects comparables, and loads clean data. 2-4 minutes, not 2-4 days.
              </p>
              <div style={styles.badgeWrap}>
                <AgentBadge icon={FileText} label="Document Parser" />
                <AgentBadge icon={Layers} label="Classifier" />
                <AgentBadge icon={Database} label="Financial Extractor" />
                <AgentBadge icon={CheckCircle} label="Reconciler" />
                <AgentBadge icon={Target} label="Sector Engine" />
                <AgentBadge icon={Shield} label="Quality Check" />
                <AgentBadge icon={Upload} label="Loader" />
              </div>
            </div>

            {/* Pillar 2 */}
            <div style={styles.pillarCard}>
              <div style={{ ...styles.pillarIconWrap, background: '#f0fdf4' }}>
                <TrendingUp size={28} style={{ color: '#10b981' }} />
              </div>
              <h3 style={styles.pillarTitle}>Model Building Brain</h3>
              <p style={styles.pillarDesc}>
                Click "Build Model" and get a complete DCF, trading comps, precedent transactions,
                and football field valuation. Every assumption flagged. Every calculation traceable.
                All math in deterministic JS -- AI decides inputs, code does arithmetic.
              </p>
              <div style={styles.badgeWrap}>
                <AgentBadge icon={BarChart3} label="DCF" />
                <AgentBadge icon={Users} label="Trading Comps" />
                <AgentBadge icon={GitBranch} label="Precedent Trans" />
                <AgentBadge icon={Target} label="Football Field" />
                <AgentBadge icon={TrendingUp} label="Sensitivity" />
              </div>
            </div>

            {/* Pillar 3 */}
            <div style={styles.pillarCard}>
              <div style={{ ...styles.pillarIconWrap, background: '#fef3c7' }}>
                <Cpu size={28} style={{ color: '#f59e0b' }} />
              </div>
              <h3 style={styles.pillarTitle}>Deal Workspace</h3>
              <p style={styles.pillarDesc}>
                Pipeline kanban, deal detail with 6 tabs, interactive model viewer with live
                recalculation, comparables library, AI chat, and portfolio dashboard.
              </p>
              <div style={styles.badgeWrap}>
                <AgentBadge icon={Layers} label="Pipeline" />
                <AgentBadge icon={FileText} label="Documents" />
                <AgentBadge icon={Database} label="Financials" />
                <AgentBadge icon={BarChart3} label="Model" />
                <AgentBadge icon={CheckCircle} label="Recommendation" />
                <AgentBadge icon={MessageSquare} label="Chat" />
              </div>
            </div>
          </div>
        </section>
      </FadeSection>

      {/* ════════════ HOW IT WORKS ════════════ */}
      <FadeSection>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>Workflow</span>
            <h2 style={styles.sectionTitle}>How It Works</h2>
          </div>
          <div style={styles.stepsContainer}>
            {[
              { step: 1, text: 'Create a deal and upload documents (CIMs, financial statements, data room files)', icon: Upload },
              { step: 2, text: 'AI agents extract, classify, and reconcile financial data', icon: Brain },
              { step: 3, text: 'Review extracted data, confirm sector classification and comparable selection', icon: Eye },
              { step: 4, text: 'Build a draft valuation model -- DCF, comps, precedent transactions', icon: BarChart3 },
              { step: 5, text: 'Edit assumptions, run scenarios, see live recalculations', icon: TrendingUp },
              { step: 6, text: 'Approve the model, write your recommendation, present to IC', icon: CheckCircle },
            ].map((s, i) => (
              <div key={i} style={styles.stepRow}>
                <div style={styles.stepLeft}>
                  <div style={styles.stepNumber}>{s.step}</div>
                  {i < 5 && <div style={styles.stepLine} />}
                </div>
                <div style={styles.stepContent}>
                  <div style={styles.stepIconCircle}>
                    <s.icon size={18} style={{ color: '#2563eb' }} />
                  </div>
                  <p style={styles.stepText}>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </FadeSection>

      {/* ════════════ PLATFORM STATS ════════════ */}
      <FadeSection>
        <section style={styles.statsSection}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>Live Platform Data</span>
            <h2 style={styles.sectionTitle}>Platform Statistics</h2>
          </div>
          <div style={styles.liveStatsGrid}>
            {[
              { label: 'Deals', value: counts?.deal_pipeline, icon: Layers },
              { label: 'Financial Records', value: counts?.target_company_financials, icon: Database },
              { label: 'Comparables', value: counts?.comparable_companies, icon: Users },
              { label: 'Precedent Transactions', value: counts?.comparable_transactions, icon: GitBranch },
              { label: 'Model Outputs', value: counts?.model_outputs, icon: BarChart3 },
            ].map((s, i) => (
              <div key={i} style={styles.liveStatCard}>
                <s.icon size={22} style={{ color: '#2563eb', marginBottom: 8 }} />
                <div style={styles.liveStatValue}>{s.value ?? '...'}</div>
                <div style={styles.liveStatLabel}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      </FadeSection>

      {/* ════════════ ARCHITECTURE OVERVIEW ════════════ */}
      <FadeSection>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>System Design</span>
            <h2 style={styles.sectionTitle}>Architecture Overview</h2>
          </div>
          <div style={styles.archCard}>
            <div style={styles.archFlow}>
              {[
                { label: 'Documents', sub: 'CIMs, PDFs, Data Rooms', icon: FileText, color: '#2563eb' },
                { label: '7 AI Agents', sub: 'Parse, Classify, Extract', icon: Brain, color: '#8b5cf6' },
                { label: 'Clean Data', sub: 'Structured Financials', icon: Database, color: '#10b981' },
                { label: 'Model Builder', sub: 'DCF, Comps, Precedents', icon: BarChart3, color: '#f59e0b' },
                { label: 'Valuation', sub: 'Base / Upside / Downside', icon: TrendingUp, color: '#06b6d4' },
                { label: 'HITL Review', sub: 'Analyst Approval', icon: Eye, color: '#ec4899' },
                { label: 'Recommendation', sub: 'IC-Ready Output', icon: CheckCircle, color: '#10b981' },
              ].map((node, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={styles.archNode}>
                    <div style={{ ...styles.archNodeIcon, background: `${node.color}15` }}>
                      <node.icon size={20} style={{ color: node.color }} />
                    </div>
                    <div style={styles.archNodeLabel}>{node.label}</div>
                    <div style={styles.archNodeSub}>{node.sub}</div>
                  </div>
                  {i < 6 && (
                    <ChevronRight size={20} style={{ color: '#cbd5e1', flexShrink: 0, margin: '0 4px' }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </FadeSection>

      {/* ════════════ KEY PRINCIPLES ════════════ */}
      <FadeSection>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>Design Philosophy</span>
            <h2 style={styles.sectionTitle}>Key Principles</h2>
          </div>
          <div style={styles.principlesGrid}>
            {[
              { icon: Layers, title: 'Templates, Not Generation', desc: 'Models from pre-defined templates, not AI invention' },
              { icon: Eye, title: 'Human in the Loop', desc: 'Every model output reviewed and approved by analyst' },
              { icon: Code, title: 'All Math in JS', desc: 'Deterministic calculations, never AI arithmetic' },
              { icon: AlertTriangle, title: 'Every Assumption Flagged', desc: 'Full traceability from input to output' },
              { icon: Shield, title: 'No Black Box', desc: 'Click any cell to see its derivation' },
              { icon: Zap, title: 'Pure JS, No Dependencies', desc: 'Runs anywhere, no native bindings' },
            ].map((p, i) => (
              <div key={i} style={styles.principleCard}>
                <div style={styles.principleIcon}>
                  <p.icon size={20} style={{ color: '#2563eb' }} />
                </div>
                <h4 style={styles.principleTitle}>{p.title}</h4>
                <p style={styles.principleDesc}>{p.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </FadeSection>

      {/* ════════════ QUICK NAV ════════════ */}
      <FadeSection>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>Navigate</span>
            <h2 style={styles.sectionTitle}>Quick Access</h2>
          </div>
          <div style={styles.navGrid}>
            {[
              { label: 'Pipeline', desc: 'Deal pipeline kanban board', icon: Layers, to: '/pipeline', color: '#2563eb' },
              { label: 'Data Workspace', desc: 'Browse and manage all data tables', icon: Database, to: '/data', color: '#10b981' },
              { label: 'Comparables', desc: 'Public company trading comps', icon: Users, to: '/comparables', color: '#8b5cf6' },
              { label: 'Chat', desc: 'AI-powered deal analysis assistant', icon: MessageSquare, to: '/chat', color: '#f59e0b' },
              { label: 'Dashboard', desc: 'Portfolio analytics and metrics', icon: PieChart, to: '/dashboard', color: '#06b6d4' },
              { label: 'Settings', desc: 'API keys, preferences, configuration', icon: Settings, to: '/settings', color: '#64748b' },
            ].map((nav, i) => (
              <Link key={i} to={nav.to} style={styles.navCard}>
                <div style={{ ...styles.navCardIcon, background: `${nav.color}12` }}>
                  <nav.icon size={24} style={{ color: nav.color }} />
                </div>
                <div style={{ flex: 1 }}>
                  <h4 style={styles.navCardTitle}>{nav.label}</h4>
                  <p style={styles.navCardDesc}>{nav.desc}</p>
                </div>
                <ArrowRight size={18} style={{ color: '#cbd5e1', flexShrink: 0 }} />
              </Link>
            ))}
          </div>
        </section>
      </FadeSection>

      {/* footer */}
      <div style={styles.footer}>
        <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>DealForge v2 -- AI-Powered Investment Analysis Platform</span>
      </div>
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────── */
const styles = {
  page: {
    minHeight: '100%',
    overflowY: 'auto',
    background: '#fafbfc',
  },

  /* Hero */
  hero: {
    position: 'relative',
    padding: '80px 40px 70px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #1a1a2e 100%)',
    overflow: 'hidden',
    textAlign: 'center',
  },
  heroGlow: {
    position: 'absolute',
    top: '-50%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 800,
    height: 800,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(37,99,235,0.15) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  heroContent: {
    position: 'relative',
    maxWidth: 720,
    margin: '0 auto',
    zIndex: 1,
  },
  heroBadge: {
    display: 'inline-block',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: '#93c5fd',
    background: 'rgba(37,99,235,0.15)',
    border: '1px solid rgba(37,99,235,0.3)',
    borderRadius: 20,
    padding: '5px 16px',
    marginBottom: 20,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: '3.2rem',
    fontWeight: 800,
    margin: '0 0 8px',
    lineHeight: 1.1,
  },
  heroTitleAccent: {
    background: 'linear-gradient(135deg, #60a5fa, #a78bfa, #60a5fa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  heroTagline: {
    fontSize: '1.15rem',
    color: '#94a3b8',
    margin: '0 0 16px',
    fontWeight: 500,
  },
  heroDesc: {
    fontSize: '0.95rem',
    color: '#64748b',
    margin: '0 auto 32px',
    maxWidth: 560,
    lineHeight: 1.6,
  },
  heroCtas: {
    display: 'flex',
    gap: 14,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  ctaPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 28px',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#fff',
    background: '#2563eb',
    borderRadius: 10,
    textDecoration: 'none',
    transition: 'background 0.2s',
  },
  ctaSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 28px',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#cbd5e1',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    textDecoration: 'none',
    transition: 'background 0.2s',
  },

  /* Sections */
  section: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '56px 32px',
  },
  sectionHeader: {
    textAlign: 'center',
    marginBottom: 36,
  },
  sectionLabel: {
    display: 'inline-block',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: '1.8rem',
    fontWeight: 700,
    color: '#1a1a2e',
    margin: 0,
  },

  /* Problem cards */
  problemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 20,
  },
  problemCard: {
    background: '#fff',
    borderRadius: 14,
    padding: '28px 24px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    textAlign: 'center',
  },
  problemIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
  },
  problemTitle: {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: '#1e293b',
    margin: '0 0 8px',
  },
  problemDesc: {
    fontSize: '0.88rem',
    color: '#64748b',
    margin: 0,
    lineHeight: 1.55,
  },

  /* Pillar cards */
  pillarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 20,
  },
  pillarCard: {
    background: '#fff',
    borderRadius: 14,
    padding: '28px 24px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  pillarIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  pillarTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#1e293b',
    margin: '0 0 10px',
  },
  pillarDesc: {
    fontSize: '0.86rem',
    color: '#64748b',
    lineHeight: 1.6,
    margin: '0 0 16px',
  },
  badgeWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  agentBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: '0.68rem',
    fontWeight: 600,
    color: '#475569',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '3px 10px',
  },

  /* Steps */
  stepsContainer: {
    maxWidth: 620,
    margin: '0 auto',
  },
  stepRow: {
    display: 'flex',
    gap: 20,
    minHeight: 80,
  },
  stepLeft: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: 40,
    flexShrink: 0,
  },
  stepNumber: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#2563eb',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.85rem',
    flexShrink: 0,
  },
  stepLine: {
    width: 2,
    flex: 1,
    background: '#e2e8f0',
    margin: '6px 0',
  },
  stepContent: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    paddingBottom: 20,
    flex: 1,
  },
  stepIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: '#eff6ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  stepText: {
    fontSize: '0.9rem',
    color: '#334155',
    lineHeight: 1.55,
    margin: '6px 0 0',
  },

  /* Live stats — matches page palette, no jarring dark block */
  statsSection: {
    background: 'linear-gradient(135deg, #eff6ff 0%, #ede9fe 100%)',
    padding: '56px 32px',
    borderTop: '1px solid #e2e8f0',
    borderBottom: '1px solid #e2e8f0',
  },
  liveStatsGrid: {
    display: 'flex',
    justifyContent: 'center',
    gap: 24,
    flexWrap: 'wrap',
    maxWidth: 900,
    margin: '0 auto',
  },
  liveStatCard: {
    textAlign: 'center',
    minWidth: 130,
    padding: '20px 24px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  liveStatValue: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#1e293b',
    lineHeight: 1.2,
  },
  liveStatLabel: {
    fontSize: '0.78rem',
    color: '#64748b',
    marginTop: 4,
    fontWeight: 500,
  },

  /* Architecture */
  archCard: {
    background: '#fff',
    borderRadius: 14,
    border: '1px solid #e2e8f0',
    padding: '32px 24px',
    overflowX: 'auto',
  },
  archFlow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flexWrap: 'wrap',
    minWidth: 700,
  },
  archNode: {
    textAlign: 'center',
    minWidth: 100,
    maxWidth: 120,
  },
  archNodeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 8px',
  },
  archNodeLabel: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 2,
  },
  archNodeSub: {
    fontSize: '0.68rem',
    color: '#94a3b8',
  },

  /* Principles */
  principlesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 16,
  },
  principleCard: {
    background: '#fff',
    borderRadius: 12,
    padding: '22px 20px',
    border: '1px solid #e2e8f0',
  },
  principleIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: '#eff6ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  principleTitle: {
    fontSize: '0.92rem',
    fontWeight: 700,
    color: '#1e293b',
    margin: '0 0 6px',
  },
  principleDesc: {
    fontSize: '0.82rem',
    color: '#64748b',
    margin: 0,
    lineHeight: 1.5,
  },

  /* Quick nav */
  navGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 14,
  },
  navCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '18px 20px',
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    textDecoration: 'none',
    transition: 'box-shadow 0.2s, border-color 0.2s',
    cursor: 'pointer',
  },
  navCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  navCardTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#1e293b',
    margin: '0 0 3px',
  },
  navCardDesc: {
    fontSize: '0.78rem',
    color: '#64748b',
    margin: 0,
  },

  /* Footer */
  footer: {
    textAlign: 'center',
    padding: '32px 20px',
    borderTop: '1px solid #e2e8f0',
  },
};
