import { useState, useEffect } from 'react';
import {
  getComparables, getComparableSectors, createComparable,
  updateComparable, deleteComparable, importComparables
} from '../api';
import { Plus, Upload, Trash2, BarChart3, Filter } from 'lucide-react';

const COLUMNS = [
  { key: 'company_name', label: 'Company', type: 'text' },
  { key: 'ticker', label: 'Ticker', type: 'text' },
  { key: 'sector', label: 'Sector', type: 'text' },
  { key: 'ev_ebitda', label: 'EV/EBITDA', type: 'number', format: 'x' },
  { key: 'ev_revenue', label: 'EV/Revenue', type: 'number', format: 'x' },
  { key: 'pe_ratio', label: 'P/E', type: 'number', format: 'x' },
  { key: 'revenue_growth_pct', label: 'Rev Growth', type: 'number', format: '%' },
  { key: 'ebitda_margin_pct', label: 'EBITDA Margin', type: 'number', format: '%' },
  { key: 'market_cap', label: 'Market Cap ($M)', type: 'number', format: '$' },
];

function formatCell(value, format) {
  if (value == null || value === '') return '-';
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (format === 'x') return num.toFixed(1) + 'x';
  if (format === '%') return num.toFixed(1) + '%';
  if (format === '$') return '$' + Number(num.toFixed(0)).toLocaleString();
  return value;
}

function calcStats(comps, key) {
  const vals = comps.map(c => parseFloat(c[key])).filter(v => !isNaN(v)).sort((a, b) => a - b);
  if (vals.length === 0) return { median: '-', mean: '-', p25: '-', p75: '-' };
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const median = vals.length % 2 === 0
    ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
    : vals[Math.floor(vals.length / 2)];
  const p25 = vals[Math.floor(vals.length * 0.25)] || vals[0];
  const p75 = vals[Math.floor(vals.length * 0.75)] || vals[vals.length - 1];
  return { median, mean, p25, p75 };
}

/* ── Styles ─────────────────────────────────────────────── */
const styles = {
  page: { padding: 0 },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: { margin: 0, fontSize: '1.5rem', fontWeight: 700 },
  headerActions: { display: 'flex', gap: 8 },
  btnPrimary: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8, border: 'none',
    background: 'var(--primary, #2563eb)', color: '#fff',
    fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
  },
  btnSecondary: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8,
    border: '1px solid var(--border, #e2e8f0)',
    background: 'var(--bg, #fff)', color: 'var(--text, #1e293b)',
    fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
  },
  sectorBar: {
    display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20,
  },
  sectorBtn: (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '5px 12px', borderRadius: 6, border: 'none',
    background: active ? 'var(--primary, #2563eb)' : 'var(--bg-secondary, #f1f5f9)',
    color: active ? '#fff' : 'var(--text, #1e293b)',
    fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
  }),
  statsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16, marginBottom: 20,
  },
  statCard: {
    background: 'var(--bg, #fff)',
    border: '1px solid var(--border, #e2e8f0)',
    borderRadius: 10, padding: 16,
  },
  statLabel: {
    fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: 'var(--text-muted, #64748b)',
    marginBottom: 4,
  },
  statValue: {
    fontSize: '1.5rem', fontWeight: 700, color: 'var(--text, #1e293b)',
  },
  statSub: {
    fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginTop: 4,
  },
  card: {
    background: 'var(--bg, #fff)',
    border: '1px solid var(--border, #e2e8f0)',
    borderRadius: 10, overflowX: 'auto',
  },
  table: {
    width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
  },
  th: {
    textAlign: 'left', padding: '10px 12px',
    borderBottom: '2px solid var(--border, #e2e8f0)',
    fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase',
    letterSpacing: '0.05em', color: 'var(--text-muted, #64748b)',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border, #e2e8f0)',
  },
  trHover: {
    cursor: 'default',
  },
  cellClickable: {
    cursor: 'pointer',
  },
  sampleBadge: {
    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
    background: '#fef3c7', color: '#92400e', fontSize: '0.65rem',
    fontWeight: 600, marginLeft: 6, verticalAlign: 'middle',
  },
  deleteBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted, #64748b)', padding: 4, borderRadius: 4,
    display: 'flex', alignItems: 'center',
  },
  editInput: {
    width: '100%', padding: '4px 6px', fontSize: '0.8rem',
    border: '1px solid var(--primary, #2563eb)', borderRadius: 4,
    outline: 'none',
  },
  emptyRow: {
    padding: 24, textAlign: 'center',
    color: 'var(--text-muted, #64748b)', fontSize: '0.85rem',
  },
  spinner: {
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    padding: 80,
  },
  hiddenInput: { display: 'none' },
};

/* ── EditableCell ────────────────────────────────────────── */
function EditableCell({ value, onSave, format, type }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = () => {
    setEditValue(value != null ? String(value) : '');
    setEditing(true);
  };

  const save = () => {
    setEditing(false);
    const newVal = type === 'number' ? (editValue === '' ? null : parseFloat(editValue)) : editValue;
    if (newVal !== value) onSave(newVal);
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
        style={styles.editInput}
      />
    );
  }

  return (
    <span style={styles.cellClickable} onClick={startEdit} title="Click to edit">
      {formatCell(value, format)}
    </span>
  );
}

/* ── Main Component ─────────────────────────────────────── */
export default function Comparables() {
  const [comps, setComps] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [activeSector, setActiveSector] = useState('All');
  const [loading, setLoading] = useState(true);

  const fetchComps = async (sector) => {
    try {
      const params = sector && sector !== 'All' ? { sector } : {};
      const data = await getComparables(params);
      setComps(Array.isArray(data) ? data : data.comparables || []);
    } catch (err) {
      console.error('Failed to fetch comparables:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSectors = async () => {
    try {
      const data = await getComparableSectors();
      // API returns [{sector: "SaaS", count: 5}, ...] — extract names
      let sectorList = [];
      if (Array.isArray(data)) {
        sectorList = data.map(item =>
          typeof item === 'string' ? item : (item && item.sector ? item.sector : null)
        ).filter(Boolean);
      } else if (data && Array.isArray(data.sectors)) {
        sectorList = data.sectors.map(item =>
          typeof item === 'string' ? item : (item && item.sector ? item.sector : null)
        ).filter(Boolean);
      }
      setSectors(sectorList);
    } catch (err) {
      console.error('Failed to fetch sectors:', err);
    }
  };

  useEffect(() => {
    fetchSectors();
    fetchComps(null);
  }, []);

  const handleSectorFilter = (sector) => {
    setActiveSector(sector);
    setLoading(true);
    fetchComps(sector === 'All' ? null : sector);
  };

  const handleCellSave = async (recordId, field, value) => {
    try {
      await updateComparable(recordId, { [field]: value });
      setComps(prev => prev.map(c =>
        c.record_id === recordId ? { ...c, [field]: value } : c
      ));
    } catch (err) {
      console.error('Failed to update comparable:', err);
    }
  };

  const handleAddRow = async () => {
    try {
      const newComp = await createComparable({
        company_name: 'New Company',
        ticker: '',
        sector: activeSector !== 'All' ? activeSector : '',
        ev_ebitda: null,
        ev_revenue: null,
        pe_ratio: null,
        revenue_growth_pct: null,
        ebitda_margin_pct: null,
        market_cap: null,
      });
      setComps(prev => [...prev, newComp]);
    } catch (err) {
      console.error('Failed to add comparable:', err);
    }
  };

  const handleDelete = async (recordId) => {
    try {
      await deleteComparable(recordId);
      setComps(prev => prev.filter(c => c.record_id !== recordId));
    } catch (err) {
      console.error('Failed to delete comparable:', err);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let data;
      if (file.name.endsWith('.json')) {
        data = JSON.parse(text);
      } else {
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        data = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim());
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i]; });
          return obj;
        });
      }
      await importComparables(Array.isArray(data) ? data : [data]);
      fetchComps(activeSector === 'All' ? null : activeSector);
    } catch (err) {
      console.error('Import failed:', err);
    }
    e.target.value = '';
  };

  const filteredComps = comps;

  // Stats for key multiple columns
  const statsKeys = ['ev_ebitda', 'ev_revenue', 'pe_ratio'];
  const stats = {};
  statsKeys.forEach(key => {
    stats[key] = calcStats(filteredComps, key);
  });

  if (loading) {
    return (
      <div style={styles.spinner}>
        <div style={{
          width: 32, height: 32, border: '3px solid var(--border, #e2e8f0)',
          borderTopColor: 'var(--primary, #2563eb)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.headerTitle}>Comparables Library</h2>
        <div style={styles.headerActions}>
          <label style={styles.btnSecondary}>
            <Upload size={16} /> Import
            <input
              type="file"
              accept=".csv,.json"
              onChange={handleImport}
              style={styles.hiddenInput}
            />
          </label>
          <button style={styles.btnPrimary} onClick={handleAddRow}>
            <Plus size={16} /> Add Comparable
          </button>
        </div>
      </div>

      {/* Sector Filters */}
      <div style={styles.sectorBar}>
        <button
          style={styles.sectorBtn(activeSector === 'All')}
          onClick={() => handleSectorFilter('All')}
        >
          <Filter size={14} /> All Sectors
        </button>
        {sectors.map(sector => (
          <button
            key={sector}
            style={styles.sectorBtn(activeSector === sector)}
            onClick={() => handleSectorFilter(sector)}
          >
            {sector}
          </button>
        ))}
      </div>

      {/* Stats Summary */}
      <div style={styles.statsGrid}>
        {statsKeys.map(key => {
          const col = COLUMNS.find(c => c.key === key);
          const s = stats[key];
          return (
            <div key={key} style={styles.statCard}>
              <div style={styles.statLabel}>Median {col.label}</div>
              <div style={styles.statValue}>
                {typeof s.median === 'number' ? formatCell(s.median, col.format) : '-'}
              </div>
              <div style={styles.statSub}>
                Mean: {typeof s.mean === 'number' ? formatCell(s.mean, col.format) : '-'}
                {' | '}
                25th: {typeof s.p25 === 'number' ? formatCell(s.p25, col.format) : '-'}
                {' | '}
                75th: {typeof s.p75 === 'number' ? formatCell(s.p75, col.format) : '-'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Data Table */}
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th key={col.key} style={styles.th}>{col.label}</th>
              ))}
              <th style={{ ...styles.th, width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredComps.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} style={styles.emptyRow}>
                  No comparables found. Add one or import a file.
                </td>
              </tr>
            ) : (
              filteredComps.map(comp => (
                <tr key={comp.record_id}>
                  {COLUMNS.map(col => (
                    <td key={col.key} style={styles.td}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <EditableCell
                          value={comp[col.key]}
                          format={col.format}
                          type={col.type}
                          onSave={(val) => handleCellSave(comp.record_id, col.key, val)}
                        />
                        {col.key === 'company_name' && comp.is_dummy && (
                          <span style={styles.sampleBadge}>Sample</span>
                        )}
                      </div>
                    </td>
                  ))}
                  <td style={styles.td}>
                    <button
                      style={styles.deleteBtn}
                      onClick={() => handleDelete(comp.record_id)}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
