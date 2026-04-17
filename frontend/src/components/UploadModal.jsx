import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, FileText, X, CheckCircle2, AlertCircle,
  ChevronRight, Loader, File, Trash2, Target, Database, ShieldCheck
} from 'lucide-react';
import { uploadDocuments, startExtraction, getExtractionJob } from '../api';

const STEPS = [
  { label: 'Upload', icon: Upload },
  { label: 'Uploading', icon: Loader },
  { label: 'Classification', icon: FileText },
  { label: 'Extraction', icon: Loader },
  { label: 'Review', icon: CheckCircle2 },
  { label: 'Complete', icon: CheckCircle2 },
];

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
];

const ACCEPTED_EXTENSIONS = '.pdf,.xlsx,.docx,.csv';

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function UploadModal({ dealId, isOpen, onClose, onComplete }) {
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Classification state
  const [classificationResults, setClassificationResults] = useState([]);
  const [selectedDocs, setSelectedDocs] = useState({});

  // Extraction state
  const [extractionJobId, setExtractionJobId] = useState(null);
  const [extractionProgress, setExtractionProgress] = useState({ progress: 0, message: '', stage: '' });
  const [extractedSummary, setExtractedSummary] = useState(null);

  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setFiles([]);
      setError('');
      setLoading(false);
      setClassificationResults([]);
      setSelectedDocs({});
      setExtractionJobId(null);
      setExtractionProgress({ progress: 0, message: '', stage: '' });
      setExtractedSummary(null);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleFilesSelected = useCallback((newFiles) => {
    const fileArr = Array.from(newFiles);
    setFiles(prev => [...prev, ...fileArr]);
    setError('');
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Step 0 -> 1 -> 2: Upload, then show uploaded files as "classification"
  const handleStartProcessing = async () => {
    if (files.length === 0) return;
    setError('');
    setLoading(true);
    setStep(1);

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));

      const result = await uploadDocuments(dealId, formData);
      const docs = result.documents || (Array.isArray(result) ? result : [result]);

      // Show each file with a detected type — document_type is populated later
      // by the classifier stage, but we display filename + mime guess here
      const classifications = docs.map((d, i) => ({
        id: d.id ?? i,
        filename: d.filename || files[i]?.name || `Document ${i + 1}`,
        detectedType: d.document_type || 'pending_classification',
        selected: true,
      }));

      setClassificationResults(classifications);
      const sel = {};
      classifications.forEach(c => { sel[c.id] = true; });
      setSelectedDocs(sel);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.details || err.response?.data?.error || err.message || 'Upload failed');
      setStep(0);
    } finally {
      setLoading(false);
    }
  };

  // Step 2 -> 3: Start real extraction pipeline, poll for progress
  const handleConfirmClassification = async () => {
    setError('');
    setLoading(true);
    setStep(3);

    try {
      const result = await startExtraction(dealId);
      const jobId = result.jobId ?? result.job_id;
      if (!jobId) {
        throw new Error('Server did not return a job id');
      }
      setExtractionJobId(jobId);

      // Poll up to ~10 minutes (200 polls @ 3s)
      let pollCount = 0;
      let consecutiveErrors = 0;
      pollRef.current = setInterval(async () => {
        pollCount++;
        try {
          const jobStatus = await getExtractionJob(jobId);
          consecutiveErrors = 0;

          const status = (jobStatus.status || 'running').toLowerCase();
          const progress = Number(jobStatus.progress ?? jobStatus.progress_pct ?? 0);

          setExtractionProgress({
            status,
            progress: isFinite(progress) ? progress : 0,
            message: jobStatus.message || jobStatus.stage || 'Processing...',
            stage: jobStatus.stage,
          });

          if (status === 'completed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setExtractedSummary(jobStatus.extracted_data || jobStatus.result?.extracted_data || null);
            setStep(4);
            setLoading(false);
          } else if (status === 'paused') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setExtractedSummary(jobStatus.extracted_data || { status: 'paused_for_review' });
            setStep(4);
            setLoading(false);
          } else if (status === 'failed' || status === 'error') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setError(jobStatus.error || jobStatus.error_message || 'Extraction failed');
            setLoading(false);
          }
        } catch (err) {
          consecutiveErrors++;
          if (consecutiveErrors >= 5 || pollCount > 200) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setError('Extraction polling timed out. Check Documents tab for status.');
            setLoading(false);
          }
        }
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.details || err.response?.data?.error || err.message || 'Extraction failed to start');
      setStep(2);
      setLoading(false);
    }
  };

  // Step 4 -> 5: Confirm extracted data
  const handleConfirmExtracted = () => {
    setStep(5);
    if (onComplete) onComplete();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal-content"
        style={{ maxWidth: 820, display: 'flex', minHeight: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left stepper */}
        <div
          style={{
            width: 200,
            minWidth: 200,
            background: 'var(--bg-secondary)',
            borderRight: '1px solid var(--border)',
            padding: '20px 0',
            borderRadius: 'var(--radius) 0 0 var(--radius)',
          }}
        >
          <div style={{ padding: '0 16px 16px', fontWeight: 600, fontSize: '0.9rem' }}>
            Upload Documents
          </div>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 16px',
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--primary)' : isDone ? 'var(--success)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--primary-light)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
                }}
              >
                {isDone ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                {s.label}
              </div>
            );
          })}
        </div>

        {/* Right content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div className="modal-header">
            <h3>{STEPS[step].label}</h3>
            <button className="btn-icon" onClick={onClose}><X size={18} /></button>
          </div>

          {/* Body */}
          <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
            {/* Error display */}
            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  background: '#fee2e2',
                  color: '#991b1b',
                  borderRadius: 'var(--radius)',
                  fontSize: '0.85rem',
                  marginBottom: 16,
                }}
              >
                <AlertCircle size={16} />
                <span style={{ flex: 1 }}>{error}</span>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => { setError(''); setStep(0); }}
                >
                  Retry
                </button>
              </div>
            )}

            {/* Step 0: Upload */}
            {step === 0 && (
              <div>
                <div
                  style={{
                    border: dragActive ? '2px dashed var(--primary)' : '2px dashed var(--border)',
                    background: dragActive ? 'var(--primary-light)' : 'var(--bg-secondary)',
                    borderRadius: 'var(--radius)',
                    padding: 40,
                    textAlign: 'center',
                    cursor: 'pointer',
                    marginBottom: 16,
                  }}
                  onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={36} style={{ marginBottom: 8, color: 'var(--text-secondary)' }} />
                  <p className="font-semibold">Drag & drop files here or click to browse</p>
                  <p className="text-xs text-muted">PDF, XLSX, DOCX, CSV</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_EXTENSIONS}
                    className="hidden"
                    onChange={e => handleFilesSelected(e.target.files)}
                  />
                </div>

                {/* File list */}
                {files.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold mb-2">{files.length} file(s) selected</div>
                    {files.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 10px',
                          borderBottom: '1px solid var(--border)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <File size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                        <span style={{ flex: 1 }} className="truncate">{f.name}</span>
                        <span className="text-xs text-muted">{formatFileSize(f.size)}</span>
                        <button className="btn-icon" onClick={() => removeFile(i)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 1: Uploading */}
            {step === 1 && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Loader size={32} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite', marginBottom: 12 }} />
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Uploading {files.length} file(s)...</p>
              </div>
            )}

            {/* Step 2: Classification review */}
            {step === 2 && (
              <div>
                <p style={{ fontSize: '0.85rem', marginBottom: 12 }}>
                  {classificationResults.length} file(s) uploaded. Start extraction to parse, classify,
                  and extract financial data.
                </p>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {classificationResults.map(c => (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 12px', borderBottom: '1px solid var(--border)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <FileText size={14} style={{ color: 'var(--text-secondary)' }} />
                      <span style={{ flex: 1 }} className="truncate">{c.filename}</span>
                      <span className="text-xs text-muted">{String(c.detectedType).replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Extraction in progress */}
            {step === 3 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <Loader size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{extractionProgress.message || 'Starting pipeline...'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Stage: {extractionProgress.stage || 'initializing'}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {Math.round(extractionProgress.progress || 0)}%
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${extractionProgress.progress || 0}%`,
                      background: 'var(--primary)',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
                <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Pipeline stages</div>
                  {[
                    ['Parsing documents', 0, 10],
                    ['Classifying documents', 10, 20],
                    ['Extracting financial data', 20, 55],
                    ['Reconciling cross-document data', 55, 65],
                    ['Classifying sector & selecting comps', 65, 80],
                    ['Running quality checks', 80, 90],
                    ['Loading data into database', 90, 100],
                  ].map(([label, lo, hi]) => {
                    const p = extractionProgress.progress || 0;
                    const state = p >= hi ? 'done' : p >= lo ? 'active' : 'pending';
                    return (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        {state === 'done' && <CheckCircle2 size={12} style={{ color: 'var(--success)' }} />}
                        {state === 'active' && <Loader size={12} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />}
                        {state === 'pending' && <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1px solid var(--border)' }} />}
                        <span style={{ opacity: state === 'pending' ? 0.5 : 1 }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 4: Review extracted data */}
            {step === 4 && (
              <div>
                {extractedSummary?.status === 'paused_for_review' ? (
                  <div style={{ padding: 14, background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, fontSize: '0.85rem', color: '#92400e', marginBottom: 12 }}>
                    <strong>Paused for Human Review</strong> — Quality check found issues.
                    A review item has been created in Reviews.
                  </div>
                ) : extractedSummary ? (
                  <div style={{ padding: 14, background: '#d1fae5', border: '1px solid #10b981', borderRadius: 8, fontSize: '0.85rem', color: '#065f46', marginBottom: 12 }}>
                    <strong>Extraction complete.</strong> Financial data has been loaded to this deal.
                  </div>
                ) : null}

                {extractedSummary && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    {[
                      ['Sector', extractedSummary.sector, Target],
                      ['Periods loaded',
                        extractedSummary.periods
                          ? `${extractedSummary.periods.inserted ?? 0} inserted / ${extractedSummary.periods.updated ?? 0} updated`
                          : '—',
                        Database],
                      ['Quality score', extractedSummary.qualityScore != null ? `${extractedSummary.qualityScore}/100` : '—', ShieldCheck],
                      ['Quality issues', extractedSummary.qualityIssues ?? 0, AlertCircle],
                      ['Comps selected', extractedSummary.selectedComps ?? 0, FileText],
                      ['Transactions selected', extractedSummary.selectedTransactions ?? 0, FileText],
                    ].map(([k, v, Icon]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                        {Icon && <Icon size={14} style={{ color: 'var(--text-secondary)' }} />}
                        <span style={{ flex: 1 }}>{k}</span>
                        <span style={{ fontWeight: 600 }}>{v ?? '—'}</span>
                      </div>
                    ))}
                    {extractedSummary.errors?.length > 0 && (
                      <div style={{ padding: 12, background: '#fff7ed', fontSize: '0.78rem', color: '#9a3412' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Warnings:</div>
                        {extractedSummary.errors.slice(0, 5).map((e, i) => (
                          <div key={i}>• {e}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 5: Complete */}
            {step === 5 && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <CheckCircle2 size={48} style={{ color: 'var(--success)', marginBottom: 12 }} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Done</h3>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                  Data has been loaded. Close this dialog to continue — default assumptions
                  have been auto-generated so you can build the model immediately.
                </p>
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {step === 0 && (
              <>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={handleStartProcessing}
                  disabled={files.length === 0 || loading}
                >
                  Start Processing <ChevronRight size={14} />
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <button className="btn btn-secondary" onClick={() => setStep(0)}>Back</button>
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmClassification}
                  disabled={loading}
                >
                  Run Extraction Pipeline <ChevronRight size={14} />
                </button>
              </>
            )}
            {step === 4 && (
              <>
                <button className="btn btn-primary" onClick={handleConfirmExtracted}>
                  Continue <ChevronRight size={14} />
                </button>
              </>
            )}
            {step === 5 && (
              <button className="btn btn-primary" onClick={onClose}>Close</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
