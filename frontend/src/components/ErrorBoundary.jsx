import { Component } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message || 'Something went wrong rendering this page.';

    return (
      <div style={{
        minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        <div style={{
          maxWidth: 520, width: '100%',
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
          padding: 32, textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: '#fee2e2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <AlertTriangle size={28} style={{ color: '#ef4444' }} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
            Something broke
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '0.88rem', color: '#64748b', lineHeight: 1.5 }}>
            {message}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 18px', borderRadius: 8, border: 'none',
                background: '#2563eb', color: '#fff', fontWeight: 600,
                fontSize: '0.85rem', cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} /> Reload page
            </button>
            <a
              href="/"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 18px', borderRadius: 8,
                border: '1px solid #e2e8f0', background: '#fff',
                color: '#475569', fontWeight: 600,
                fontSize: '0.85rem', textDecoration: 'none',
              }}
            >
              <Home size={14} /> Back to home
            </a>
          </div>
          <details style={{ marginTop: 20, textAlign: 'left' }}>
            <summary style={{
              cursor: 'pointer', fontSize: '0.78rem',
              color: '#94a3b8', fontWeight: 500,
            }}>
              Technical details
            </summary>
            <pre style={{
              marginTop: 8, padding: 12, background: '#f8fafc',
              border: '1px solid #e2e8f0', borderRadius: 8,
              fontSize: '0.72rem', color: '#334155',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 200, overflowY: 'auto',
            }}>
              {this.state.error?.stack || String(this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
