import { useState, useEffect } from 'react';
import { getSettings, updateSettings, validateApiKey, getCounts, resetDemo } from '../api';
import {
  Settings as SettingsIcon, Key, Shield, CheckCircle, XCircle,
  Loader, Eye, EyeOff, Server, Database, AlertTriangle, RefreshCw
} from 'lucide-react';

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 7) + '...' + key.slice(-4);
}

function StatusBadge({ status }) {
  if (status === 'valid') return <span className="flex items-center gap-1" style={{ color: 'var(--success)', fontSize: 13 }}><CheckCircle size={14} /> Valid</span>;
  if (status === 'invalid') return <span className="flex items-center gap-1" style={{ color: 'var(--danger)', fontSize: 13 }}><XCircle size={14} /> Invalid</span>;
  if (status === 'validating') return <span className="flex items-center gap-1" style={{ color: 'var(--warning)', fontSize: 13 }}><Loader size={14} className="spin" /> Validating...</span>;
  return null;
}

function ApiKeyField({ label, required, value, onChange, helperText, onValidate, validationStatus, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <label className="text-sm" style={{ fontWeight: 600 }}>{label}</label>
        {required
          ? <span style={{ fontSize: 11, background: 'var(--primary-light)', color: 'var(--primary)', padding: '1px 8px', borderRadius: 10, fontWeight: 600 }}>Required</span>
          : <span style={{ fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--text-muted)', padding: '1px 8px', borderRadius: 10, fontWeight: 500 }}>Optional</span>
        }
      </div>
      <div className="flex gap-2">
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type={visible ? 'text' : 'password'}
            className="input"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder || 'Enter API key...'}
            style={{ width: '100%', paddingRight: 40 }}
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button className="btn btn-secondary" onClick={onValidate} disabled={!value || validationStatus === 'validating'} style={{ whiteSpace: 'nowrap' }}>
          {validationStatus === 'validating' ? <Loader size={14} className="spin" /> : <Shield size={14} />}
          <span style={{ marginLeft: 6 }}>Validate</span>
        </button>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-muted">{helperText}</span>
        <StatusBadge status={validationStatus} />
      </div>
    </div>
  );
}

export default function Settings() {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicStatus, setAnthropicStatus] = useState(null);
  const [openaiStatus, setOpenaiStatus] = useState(null);
  const [lightModel, setLightModel] = useState('claude-haiku-4-5');
  const [heavyModel, setHeavyModel] = useState('claude-sonnet-4-5');
  const [counts, setCounts] = useState(null);
  const [health, setHealth] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchSettings = async () => {
    try {
      const settings = await getSettings();
      // Backend returns camelCase: anthropicKey (masked), hasAnthropicKey, lightModel, heavyModel
      if (settings.anthropicKey) setAnthropicKey(settings.anthropicKey);
      if (settings.openaiKey) setOpenaiKey(settings.openaiKey);
      if (settings.lightModel) setLightModel(settings.lightModel);
      if (settings.heavyModel) setHeavyModel(settings.heavyModel);
      if (settings.hasAnthropicKey) setAnthropicStatus('valid');
      if (settings.hasOpenaiKey) setOpenaiStatus('valid');
    } catch { /* ignore */ }
  };

  const fetchStatus = async () => {
    try {
      const c = await getCounts();
      setCounts(c);
      setHealth('ok');
    } catch {
      setHealth('error');
    }
  };

  useEffect(() => {
    Promise.all([fetchSettings(), fetchStatus()]).finally(() => setLoading(false));
  }, []);

  const handleValidate = async (provider) => {
    const key = provider === 'anthropic' ? anthropicKey : openaiKey;
    const setStatus = provider === 'anthropic' ? setAnthropicStatus : setOpenaiStatus;
    setStatus('validating');
    try {
      const result = await validateApiKey(provider, key);
      setStatus(result.valid ? 'valid' : 'invalid');
    } catch {
      setStatus('invalid');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        anthropicKey,
        openaiKey,
        lightModel,
        heavyModel,
      });
      showToast('Settings saved successfully');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  };

  const handleReset = async () => {
    setShowResetConfirm(false);
    try {
      await resetDemo();
      showToast('Demo data reset to seeded state');
      await fetchStatus();
    } catch (err) {
      showToast('Reset failed: ' + (err.response?.data?.details || err.message), 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: '60vh' }}>
        <Loader size={32} className="spin text-primary" />
      </div>
    );
  }

  const tableRows = counts ? Object.entries(counts) : [];

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div className="flex items-center gap-3" style={{ marginBottom: 24 }}>
        <div style={{ width: 40, height: 40, borderRadius: 'var(--radius)', background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SettingsIcon size={20} className="text-primary" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Settings</h1>
          <p className="text-sm text-muted" style={{ margin: 0 }}>Manage API keys, model preferences, and system configuration</p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999, padding: '12px 20px', borderRadius: 'var(--radius)',
          background: toast.type === 'error' ? 'var(--danger)' : 'var(--success)', color: '#fff',
          fontSize: 14, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          {toast.message}
        </div>
      )}

      {/* Section 1: LLM API Keys */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          <Key size={18} className="text-primary" />
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>LLM API Keys</h2>
        </div>
        <p className="text-sm text-muted" style={{ margin: '0 0 20px' }}>
          Configure API keys for the AI models that power document extraction, model building, and chat.
        </p>

        <ApiKeyField
          label="Anthropic API Key"
          required
          value={anthropicKey}
          onChange={v => { setAnthropicKey(v); setAnthropicStatus(null); }}
          helperText="Required for Claude models. Get your key at console.anthropic.com"
          onValidate={() => handleValidate('anthropic')}
          validationStatus={anthropicStatus}
          placeholder="sk-ant-..."
        />

        <ApiKeyField
          label="OpenAI API Key"
          required={false}
          value={openaiKey}
          onChange={v => { setOpenaiKey(v); setOpenaiStatus(null); }}
          helperText="Optional fallback provider. Get your key at platform.openai.com"
          onValidate={() => handleValidate('openai')}
          validationStatus={openaiStatus}
          placeholder="sk-..."
        />

        <div className="flex justify-end" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader size={14} className="spin" /> : null}
            <span style={{ marginLeft: saving ? 6 : 0 }}>{saving ? 'Saving...' : 'Save API Keys'}</span>
          </button>
        </div>

        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 'var(--radius)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)',
          display: 'flex', alignItems: 'flex-start', gap: 8
        }}>
          <Shield size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>API keys are stored server-side in memory and will need to be re-entered when the server restarts. Keys are never written to disk.</span>
        </div>
      </div>

      {/* Section 2: Model Configuration */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          <Server size={18} className="text-primary" />
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Model Configuration</h2>
        </div>
        <p className="text-sm text-muted" style={{ margin: '0 0 20px' }}>
          Choose which models to use for different tasks.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="text-sm" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Light Model (Fast)</label>
            <select className="input" value={lightModel} onChange={e => setLightModel(e.target.value)} style={{ width: '100%' }}>
              <option value="claude-haiku-4-5">claude-haiku-4-5 (latest)</option>
              <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            </select>
            <span className="text-xs text-muted">Used for classification, quality checks</span>
          </div>
          <div>
            <label className="text-sm" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Heavy Model (Reasoning)</label>
            <select className="input" value={heavyModel} onChange={e => setHeavyModel(e.target.value)} style={{ width: '100%' }}>
              <option value="claude-sonnet-4-5">claude-sonnet-4-5 (latest)</option>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
              <option value="claude-opus-4-6">claude-opus-4-6</option>
              <option value="claude-haiku-4-5">claude-haiku-4-5 (fast)</option>
            </select>
            <span className="text-xs text-muted">Used for extraction, model building</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1" style={{ marginTop: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: anthropicKey ? 'var(--success)' : 'var(--warning)' }} />
          <span className="text-xs text-muted">
            Current provider: {anthropicKey ? 'Anthropic (Claude)' : openaiKey ? 'OpenAI' : 'No provider configured'}
          </span>
        </div>
      </div>

      {/* Section 3: System Status */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div className="flex items-center gap-2">
            <Database size={18} className="text-primary" />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>System Status</h2>
          </div>
          <button className="btn btn-secondary" onClick={handleRefreshStatus} disabled={refreshing} style={{ padding: '6px 12px' }}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            <span style={{ marginLeft: 6 }}>Refresh</span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {/* Database status */}
          <div style={{ padding: 14, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <Database size={14} />
              <span className="text-sm" style={{ fontWeight: 600 }}>Database</span>
            </div>
            {tableRows.length > 0 ? tableRows.map(([table, count]) => (
              <div key={table} className="flex items-center justify-between" style={{ fontSize: 12, padding: '3px 0', color: 'var(--text-muted)' }}>
                <span style={{ textTransform: 'capitalize' }}>{table}</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{count}</span>
              </div>
            )) : <span className="text-xs text-muted">No data</span>}
          </div>

          {/* Server status */}
          <div style={{ padding: 14, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <Server size={14} />
              <span className="text-sm" style={{ fontWeight: 600 }}>Server</span>
            </div>
            <div className="flex items-center gap-2" style={{ fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: health === 'ok' ? 'var(--success)' : 'var(--danger)' }} />
              <span>{health === 'ok' ? 'Healthy' : 'Unreachable'}</span>
            </div>
          </div>

          {/* LLM status */}
          <div style={{ padding: 14, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <Key size={14} />
              <span className="text-sm" style={{ fontWeight: 600 }}>LLM Keys</span>
            </div>
            <div style={{ fontSize: 12 }}>
              <div className="flex items-center gap-2" style={{ padding: '3px 0' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: anthropicKey ? 'var(--success)' : 'var(--danger)' }} />
                <span className="text-muted">Anthropic: {anthropicKey ? 'Configured' : 'Not set'}</span>
              </div>
              <div className="flex items-center gap-2" style={{ padding: '3px 0' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: openaiKey ? 'var(--success)' : 'var(--text-muted)' }} />
                <span className="text-muted">OpenAI: {openaiKey ? 'Configured' : 'Not set'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Data Management */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          <Database size={18} className="text-primary" />
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Data Management</h2>
        </div>
        <p className="text-sm text-muted" style={{ margin: '0 0 16px' }}>
          Manage application data. Use caution with destructive operations.
        </p>

        <div className="flex gap-3">
          <button className="btn btn-secondary" onClick={() => setShowResetConfirm(true)} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            <RefreshCw size={14} />
            <span style={{ marginLeft: 6 }}>Reset to Sample Data</span>
          </button>
          <button className="btn btn-secondary" disabled>
            <Database size={14} />
            <span style={{ marginLeft: 6 }}>Export All Data</span>
          </button>
        </div>

        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 'var(--radius)',
          background: '#fef3c7', border: '1px solid #fbbf24', fontSize: 13, color: '#92400e',
          display: 'flex', alignItems: 'flex-start', gap: 8
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Resetting data will permanently delete all current deals, documents, and models, replacing them with sample data. This cannot be undone.</span>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setShowResetConfirm(false)}>
          <div className="card" style={{ maxWidth: 420, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
              <AlertTriangle size={20} style={{ color: 'var(--danger)' }} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Confirm Reset</h3>
            </div>
            <p className="text-sm" style={{ margin: '0 0 20px', color: 'var(--text-muted)' }}>
              This will delete all existing data and replace it with sample data. This action cannot be undone. Are you sure?
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setShowResetConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={handleReset}>
                Yes, Reset Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
