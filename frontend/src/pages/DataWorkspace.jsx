import { useState, useEffect, useRef } from 'react';
import {
  getDeals, getFinancials, getComparables, getTransactions,
  getAssumptions, getOutputs, getCounts, getSchemas,
  clearSampleData, downloadTemplate, importData,
  deleteDeal, deleteFinancial, deleteComparable, deleteTransaction,
  updateDeal, updateFinancial, updateComparable, updateTransaction,
  updateAssumption
} from '../api';
import {
  Database, Upload, Download, Trash2, Plus, RefreshCw,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle,
  FileSpreadsheet, X, Eye, EyeOff
} from 'lucide-react';

/* ── table registry ─────────────────────────────────────────── */
const TABLE_CONFIGS = {
  deal_pipeline: {
    label: 'Deals',
    description: 'All deals in the pipeline with stage, sector, and key details',
    fetchFn: () => getDeals(),
    idField: 'deal_id',
    deleteFn: id => deleteDeal(id),
    updateFn: (id, d) => updateDeal(id, d),
    displayCols: ['deal_id','deal_name','stage','sector','target_company','deal_size_estimate','lead_analyst','date_entered','status_notes'],
    formatters: { deal_size_estimate: v => v ? `$${v}M` : '-' },
  },
  target_company_financials: {
    label: 'Target Financials',
    description: 'Historical financial data for target companies',
    fetchFn: () => getFinancials(),
    idField: 'record_id',
    deleteFn: id => deleteFinancial(id),
    updateFn: (id, d) => updateFinancial(id, d),
    displayCols: ['company_name','period','revenue','revenue_growth_pct','gross_profit','ebitda','ebitda_margin_pct','net_income','free_cash_flow','employees'],
    formatters: {
      revenue: v => v ? `$${v}M` : '-',
      ebitda: v => v ? `$${v}M` : '-',
      gross_profit: v => v ? `$${v}M` : '-',
      net_income: v => v ? `$${v}M` : '-',
      free_cash_flow: v => v ? `$${v}M` : '-',
      revenue_growth_pct: v => v !== null && v !== undefined ? `${v}%` : '-',
      ebitda_margin_pct: v => v !== null && v !== undefined ? `${v}%` : '-',
    },
  },
  comparable_companies: {
    label: 'Comparable Companies',
    description: 'Public company trading comparables with current multiples',
    fetchFn: () => getComparables(),
    idField: 'record_id',
    deleteFn: id => deleteComparable(id),
    updateFn: (id, d) => updateComparable(id, d),
    displayCols: ['company_name','ticker','sector','ev_ebitda','ev_revenue','pe_ratio','revenue_growth_pct','ebitda_margin_pct','market_cap'],
    formatters: {
      ev_ebitda: v => v ? `${v}x` : '-',
      ev_revenue: v => v ? `${v}x` : '-',
      pe_ratio: v => v ? `${v}x` : '-',
      revenue_growth_pct: v => v !== null && v !== undefined ? `${v}%` : '-',
      ebitda_margin_pct: v => v !== null && v !== undefined ? `${v}%` : '-',
      market_cap: v => v ? `$${Number(v).toLocaleString()}M` : '-',
    },
  },
  comparable_transactions: {
    label: 'Precedent Transactions',
    description: 'Historical M&A transactions with deal multiples and premiums',
    fetchFn: () => getTransactions(),
    idField: 'record_id',
    deleteFn: id => deleteTransaction(id),
    updateFn: (id, d) => updateTransaction(id, d),
    displayCols: ['transaction_name','announcement_date','acquirer','target','sector','deal_value','ev_ebitda','ev_revenue','premium_pct'],
    formatters: {
      deal_value: v => v ? `$${Number(v).toLocaleString()}M` : '-',
      ev_ebitda: v => v ? `${v}x` : '-',
      ev_revenue: v => v ? `${v}x` : '-',
      premium_pct: v => v !== null && v !== undefined ? `${v}%` : '-',
    },
  },
  valuation_assumptions: {
    label: 'Valuation Assumptions',
    description: 'Model assumptions across base, upside, and downside scenarios',
    fetchFn: () => getAssumptions(),
    idField: 'assumption_id',
    deleteFn: null,
    updateFn: (id, d) => updateAssumption(id, d),
    displayCols: ['deal_id','assumption_name','base_case','upside_case','downside_case','unit','source_rationale'],
    formatters: {},
  },
  model_outputs: {
    label: 'Model Outputs',
    description: 'Calculated valuation outputs by deal and scenario',
    fetchFn: () => getOutputs(),
    idField: 'output_id',
    deleteFn: null,
    updateFn: null,
    displayCols: ['deal_id','scenario','metric_name','metric_value','unit','calculation_method','confidence_score'],
    formatters: { confidence_score: v => v !== null && v !== undefined ? `${(v * 100).toFixed(0)}%` : '-' },
  },
};

const TABLE_KEYS = Object.keys(TABLE_CONFIGS);

function prettyColName(col) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/Pct/g, '%').replace(/Id/g, 'ID');
}

/* ── inline editable cell ───────────────────────────────────── */
function EditableCell({ value, col, formatter, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const begin = () => {
    setDraft(value != null ? String(value) : '');
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const parsed = draft === '' ? null : (isNaN(Number(draft)) ? draft : Number(draft));
    if (parsed !== value) onSave(parsed);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{ width: '100%', padding: '3px 6px', fontSize: '0.8rem', border: '1px solid var(--primary)', borderRadius: 4, outline: 'none' }}
      />
    );
  }

  const display = formatter ? formatter(value) : (value != null ? String(value) : '-');
  return (
    <span onClick={onSave ? begin : undefined} style={{ cursor: onSave ? 'pointer' : 'default' }} title={onSave ? 'Click to edit' : ''}>
      {display}
    </span>
  );
}

/* ── upload modal ───────────────────────────────────────────── */
function UploadModal({ table, tableLabel, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    });
  };

  const handleFile = (f) => {
    setFile(f);
    setResult(null);
    if (f.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          const rows = Array.isArray(data) ? data : data.rows || data.data || [];
          setPreview(rows.slice(0, 5));
        } catch { setPreview(null); }
      };
      reader.readAsText(f);
    } else if (f.name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = e => {
        const rows = parseCSV(e.target.result);
        setPreview(rows.slice(0, 5));
      };
      reader.readAsText(f);
    } else {
      setPreview(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const doImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await importData(table, fd);
      setResult({ success: true, ...res });
      onImported();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Import failed';
      setResult({ success: false, error: msg });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={{ margin: 0 }}>Upload Data to {tableLabel}</h3>
          <button onClick={onClose} style={styles.iconBtn}><X size={18} /></button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{ ...styles.dropZone, borderColor: dragOver ? 'var(--primary)' : '#d1d5db', background: dragOver ? 'var(--primary-light)' : '#fafafa' }}
        >
          <Upload size={32} style={{ color: 'var(--text-secondary)', marginBottom: 8 }} />
          <p style={{ margin: 0, fontWeight: 500 }}>{file ? file.name : 'Drop CSV, JSON, or XLSX here'}</p>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>or click to browse</p>
          <input ref={inputRef} type="file" accept=".csv,.json,.xlsx" onChange={e => e.target.files[0] && handleFile(e.target.files[0])} style={{ display: 'none' }} />
        </div>

        {preview && preview.length > 0 && (
          <div style={{ marginTop: 16, overflowX: 'auto' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Preview (first {preview.length} rows)</p>
            <table style={styles.previewTable}>
              <thead>
                <tr>{Object.keys(preview[0]).map(k => <th key={k} style={styles.previewTh}>{k}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>{Object.values(row).map((v, j) => <td key={j} style={styles.previewTd}>{String(v ?? '')}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result && (
          <div style={{ ...styles.resultBox, borderColor: result.success ? 'var(--success)' : 'var(--danger)', background: result.success ? '#ecfdf5' : '#fef2f2' }}>
            {result.success
              ? <><CheckCircle size={16} style={{ color: 'var(--success)' }} /> <span>{result.imported ?? 0} rows imported{result.skipped ? `, ${result.skipped} skipped` : ''}{result.errors ? `, ${result.errors} errors` : ''}</span></>
              : <><AlertCircle size={16} style={{ color: 'var(--danger)' }} /> <span>{result.error}</span></>
            }
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={styles.btnSecondary}>Cancel</button>
          <button onClick={doImport} disabled={!file || importing} style={{ ...styles.btnPrimary, opacity: (!file || importing) ? 0.5 : 1 }}>
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── schema panel ───────────────────────────────────────────── */
function SchemaPanel({ schema, expanded, onToggle }) {
  if (!schema || schema.length === 0) return null;
  return (
    <div style={styles.schemaPanel}>
      <button onClick={onToggle} style={styles.schemaTrigger}>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <FileSpreadsheet size={16} />
        <span style={{ fontWeight: 600 }}>Column Schema</span>
      </button>
      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Column', 'Type', 'Required', 'Description'].map(h => (
                  <th key={h} style={{ ...styles.schemaCellHead }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schema.map((col, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={styles.schemaCell}><code style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '1px 5px', borderRadius: 3 }}>{col.name}</code></td>
                  <td style={styles.schemaCell}>{col.type || '-'}</td>
                  <td style={styles.schemaCell}>{col.required ? 'Yes' : '-'}</td>
                  <td style={{ ...styles.schemaCell, color: 'var(--text-secondary)' }}>{col.description || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── main component ─────────────────────────────────────────── */
export default function DataWorkspace() {
  const [activeTable, setActiveTable] = useState(TABLE_KEYS[0]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({});
  const [schemas, setSchemas] = useState({});
  const [showSample, setShowSample] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [schemaExpanded, setSchemaExpanded] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [visibleCount, setVisibleCount] = useState(50);
  const [error, setError] = useState(null);

  /* ── data loading ── */
  const fetchMeta = async () => {
    try {
      const [c, s] = await Promise.all([getCounts(), getSchemas()]);
      setCounts(c);
      setSchemas(s);
    } catch { /* ignore */ }
  };

  const fetchRows = async (table) => {
    setLoading(true);
    setError(null);
    try {
      const cfg = TABLE_CONFIGS[table];
      const data = await cfg.fetchFn();
      setRows(Array.isArray(data) ? data : data.data || data.rows || []);
    } catch (err) {
      setError(err.message || 'Failed to load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMeta(); }, []);
  useEffect(() => {
    fetchRows(activeTable);
    setVisibleCount(50);
    setSortCol(null);
    setSortDir('asc');
  }, [activeTable]);

  const refresh = () => { fetchRows(activeTable); fetchMeta(); };

  /* ── sorting ── */
  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sortedRows = (() => {
    let filtered = showSample ? rows : rows.filter(r => !r.is_dummy);
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  })();

  const displayedRows = sortedRows.slice(0, visibleCount);
  const cfg = TABLE_CONFIGS[activeTable];
  const sampleCount = rows.filter(r => r.is_dummy).length;
  const userCount = rows.length - sampleCount;
  const currentSchema = schemas[activeTable]?.columns || schemas[activeTable] || [];

  /* ── inline update ── */
  const handleCellSave = async (row, col, newVal) => {
    const id = row[cfg.idField];
    if (!id || !cfg.updateFn) return;
    try {
      await cfg.updateFn(id, { [col]: newVal });
      setRows(prev => prev.map(r => r[cfg.idField] === id ? { ...r, [col]: newVal } : r));
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  /* ── delete row ── */
  const handleDelete = async (row) => {
    const id = row[cfg.idField];
    if (!id || !cfg.deleteFn) return;
    if (!window.confirm('Delete this row?')) return;
    try {
      await cfg.deleteFn(id);
      setRows(prev => prev.filter(r => r[cfg.idField] !== id));
      fetchMeta();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  /* ── clear sample data ── */
  const handleClearSample = async () => {
    if (!window.confirm(`This will remove ${sampleCount} sample rows from ${cfg.label}. Continue?`)) return;
    try {
      await clearSampleData(activeTable);
      refresh();
    } catch (err) {
      console.error('Clear sample failed:', err);
    }
  };

  /* ── render ── */
  return (
    <div style={styles.page}>
      {/* sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <Database size={18} />
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Data Tables</span>
        </div>
        <nav style={styles.sidebarNav}>
          {TABLE_KEYS.map(key => {
            const tc = TABLE_CONFIGS[key];
            const cnt = counts[key] ?? '...';
            const active = key === activeTable;
            return (
              <button
                key={key}
                onClick={() => setActiveTable(key)}
                style={{ ...styles.sidebarItem, ...(active ? styles.sidebarItemActive : {}) }}
              >
                <span style={{ flex: 1, textAlign: 'left' }}>{tc.label}</span>
                <span style={styles.countBadge}>{cnt}</span>
              </button>
            );
          })}
        </nav>
        <div style={styles.sidebarFooter}>
          <button onClick={refresh} style={styles.sidebarRefresh}>
            <RefreshCw size={14} /> Refresh All
          </button>
        </div>
      </aside>

      {/* main */}
      <main style={styles.main}>
        {/* header */}
        <div style={styles.header}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0 }}>{cfg.label}</h2>
              <span style={styles.rowBadge}>{rows.length} rows</span>
              {sampleCount > 0 && (
                <span style={styles.sampleBadge}>{sampleCount} sample</span>
              )}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{cfg.description}</p>
          </div>
          <div style={styles.headerActions}>
            {sampleCount > 0 && (
              <button onClick={() => setShowSample(s => !s)} style={styles.btnGhost} title={showSample ? 'Hide sample data' : 'Show sample data'}>
                {showSample ? <EyeOff size={15} /> : <Eye size={15} />}
                {showSample ? 'Hide Sample' : 'Show Sample'}
              </button>
            )}
            <button onClick={() => setShowUpload(true)} style={styles.btnPrimary}>
              <Upload size={15} /> Upload Data
            </button>
            <a href={downloadTemplate(activeTable)} download style={{ ...styles.btnSecondary, display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}>
              <Download size={15} /> Template
            </a>
            {sampleCount > 0 && (
              <button onClick={handleClearSample} style={styles.btnDanger}>
                <Trash2 size={15} /> Clear Sample
              </button>
            )}
            <button onClick={refresh} style={styles.btnGhost} title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {/* error */}
        {error && (
          <div style={styles.errorBar}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* table */}
        <div style={styles.tableWrap}>
          {loading ? (
            <div style={styles.emptyState}>
              <RefreshCw size={24} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
              <p>Loading...</p>
            </div>
          ) : displayedRows.length === 0 ? (
            <div style={styles.emptyState}>
              <Database size={36} style={{ color: '#d1d5db' }} />
              <p style={{ fontWeight: 500, marginTop: 8 }}>No data yet</p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Upload a file or add rows manually</p>
              <button onClick={() => setShowUpload(true)} style={{ ...styles.btnPrimary, marginTop: 12 }}>
                <Upload size={15} /> Upload Data
              </button>
            </div>
          ) : (
            <>
              <div style={styles.scrollContainer}>
                <table style={styles.dataTable}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, width: 40 }}>#</th>
                      {cfg.displayCols.map(col => (
                        <th
                          key={col}
                          onClick={() => handleSort(col)}
                          style={{ ...styles.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                          title={currentSchema.find(s => s.name === col)?.description || col}
                        >
                          {prettyColName(col)}
                          {sortCol === col && (
                            <span style={{ marginLeft: 4, fontSize: '0.7rem' }}>{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                          )}
                        </th>
                      ))}
                      {cfg.deleteFn && <th style={{ ...styles.th, width: 50 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map((row, idx) => {
                      const isSample = !!row.is_dummy;
                      return (
                        <tr key={row[cfg.idField] || idx} style={{ background: isSample ? '#fffbeb' : (idx % 2 === 0 ? '#fff' : '#fafafa') }}>
                          <td style={styles.td}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{idx + 1}</span>
                            {isSample && <span style={styles.sampleTag}>SAMPLE</span>}
                          </td>
                          {cfg.displayCols.map(col => (
                            <td key={col} style={styles.td}>
                              <EditableCell
                                value={row[col]}
                                col={col}
                                formatter={cfg.formatters[col]}
                                onSave={cfg.updateFn ? (val) => handleCellSave(row, col, val) : null}
                              />
                            </td>
                          ))}
                          {cfg.deleteFn && (
                            <td style={styles.td}>
                              <button onClick={() => handleDelete(row)} style={styles.deleteBtn} title="Delete row">
                                <Trash2 size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* load more */}
              {visibleCount < sortedRows.length && (
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <button onClick={() => setVisibleCount(c => c + 50)} style={styles.btnSecondary}>
                    Load More ({sortedRows.length - visibleCount} remaining)
                  </button>
                </div>
              )}

              {/* summary bar */}
              <div style={styles.summaryBar}>
                Showing {displayedRows.length} of {sortedRows.length} rows
                {!showSample && sampleCount > 0 && ` (${sampleCount} sample rows hidden)`}
                {' | '}{userCount} user rows, {sampleCount} sample rows
              </div>
            </>
          )}
        </div>

        {/* schema panel */}
        <SchemaPanel
          schema={currentSchema}
          expanded={schemaExpanded}
          onToggle={() => setSchemaExpanded(e => !e)}
        />
      </main>

      {/* upload modal */}
      {showUpload && (
        <UploadModal
          table={activeTable}
          tableLabel={cfg.label}
          onClose={() => setShowUpload(false)}
          onImported={refresh}
        />
      )}

      {/* spinner keyframes */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────── */
const styles = {
  page: {
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--bg-secondary)',
  },

  /* sidebar */
  sidebar: {
    width: 200,
    minWidth: 200,
    background: '#fff',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '16px 14px 12px',
    borderBottom: '1px solid var(--border)',
    fontSize: '0.85rem',
  },
  sidebarNav: {
    flex: 1,
    overflowY: 'auto',
    padding: '6px 0',
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.82rem',
    color: 'var(--text)',
    transition: 'background 0.15s',
    textAlign: 'left',
  },
  sidebarItemActive: {
    background: 'var(--primary-light)',
    color: 'var(--primary)',
    fontWeight: 600,
    borderRight: '3px solid var(--primary)',
  },
  countBadge: {
    fontSize: '0.7rem',
    background: '#f1f5f9',
    color: 'var(--text-secondary)',
    borderRadius: 10,
    padding: '1px 7px',
    fontWeight: 600,
  },
  sidebarFooter: {
    borderTop: '1px solid var(--border)',
    padding: 10,
  },
  sidebarRefresh: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: '6px 10px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius)',
  },

  /* main area */
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    background: '#fff',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
    gap: 10,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  rowBadge: {
    fontSize: '0.72rem',
    background: 'var(--primary-light)',
    color: 'var(--primary)',
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 600,
  },
  sampleBadge: {
    fontSize: '0.72rem',
    background: '#fef3c7',
    color: '#92400e',
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 600,
  },

  /* table */
  tableWrap: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  scrollContainer: {
    flex: 1,
    overflowX: 'auto',
    overflowY: 'auto',
  },
  dataTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.82rem',
  },
  th: {
    position: 'sticky',
    top: 0,
    background: '#f8fafc',
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '0.76rem',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    borderBottom: '2px solid var(--border)',
    zIndex: 1,
  },
  td: {
    padding: '6px 12px',
    borderBottom: '1px solid #f1f5f9',
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sampleTag: {
    display: 'inline-block',
    fontSize: '0.6rem',
    fontWeight: 700,
    background: '#fde68a',
    color: '#78350f',
    borderRadius: 3,
    padding: '0px 4px',
    marginLeft: 4,
    verticalAlign: 'middle',
    lineHeight: '14px',
  },
  deleteBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: '#d1d5db',
    padding: 4,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
  },
  summaryBar: {
    padding: '8px 20px',
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    borderTop: '1px solid var(--border)',
    background: '#fff',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
  },
  errorBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 20px',
    background: '#fef2f2',
    color: 'var(--danger)',
    fontSize: '0.82rem',
    borderBottom: '1px solid #fecaca',
  },

  /* buttons */
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#fff',
    background: 'var(--primary)',
    border: 'none',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
  },
  btnSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--text)',
    background: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
  },
  btnDanger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#fff',
    background: 'var(--danger)',
    border: 'none',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
  },
  btnGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 10px',
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 'var(--radius)',
  },
  iconBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    color: 'var(--text-secondary)',
  },

  /* modal */
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalBox: {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    width: 560,
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  dropZone: {
    border: '2px dashed #d1d5db',
    borderRadius: 'var(--radius)',
    padding: '32px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
  },
  resultBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: '10px 14px',
    borderRadius: 'var(--radius)',
    border: '1px solid',
    fontSize: '0.82rem',
  },

  /* preview table */
  previewTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.75rem',
  },
  previewTh: {
    background: '#f8fafc',
    padding: '4px 8px',
    textAlign: 'left',
    fontWeight: 600,
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  previewTd: {
    padding: '3px 8px',
    borderBottom: '1px solid #f1f5f9',
    maxWidth: 150,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  /* schema panel */
  schemaPanel: {
    borderTop: '1px solid var(--border)',
    background: '#fff',
  },
  schemaTrigger: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '10px 20px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.82rem',
    color: 'var(--text)',
  },
  schemaCellHead: {
    padding: '6px 12px',
    fontWeight: 600,
    fontSize: '0.74rem',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    borderBottom: '2px solid var(--border)',
    background: '#f8fafc',
  },
  schemaCell: {
    padding: '5px 12px',
    fontSize: '0.78rem',
  },
};
