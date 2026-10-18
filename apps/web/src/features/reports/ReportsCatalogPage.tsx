import React, { useEffect, useState, useMemo } from 'react';
import { apiGet, apiPost, apiDelete, ApiError } from '../../shared/api/client.js';
import { ReportPdfModal } from '../../shared/reports/ReportPdfModal.js';

interface ReportDefinition {
  id: string;
  module: string;
  name: string;
  description: string;
  category: string;
  permitted_fields: string[];
  default_period: string;
  export_formats: string[];
}

interface ReportSchedule {
  id: string;
  report_id: string;
  report_name?: string;
  cron_expression: string;
  format: string;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
}

interface ReportRunResult {
  runId: string;
  reportId: string;
  reportName: string;
  module: string;
  rowCount: number;
  data: any[];
  permittedFields: string[];
  executedAt: string;
}

export function ReportsCatalogPage() {
  const [activeTab, setActiveTab] = useState<'catalog' | 'schedules' | 'results'>('catalog');
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active run state
  const [activeReport, setActiveReport] = useState<ReportDefinition | null>(null);
  const [runResult, setRunResult] = useState<ReportRunResult | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfReportId, setPdfReportId] = useState<string | null>(null);
  const [pdfReportTitle, setPdfReportTitle] = useState<string>('');

  // Schedule form state
  const [scheduleCron, setScheduleCron] = useState('0 8 * * *');
  const [scheduleFormat, setScheduleFormat] = useState('CSV');
  const [scheduleRecipients, setScheduleRecipients] = useState('admin@clinic.local');

  // Load catalog
  const loadCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ reports: ReportDefinition[]; meta?: any }>('/reports/catalog');
      if (res?.reports) {
        setReports(res.reports);
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(`Failed to load catalog: ${err.problem?.detail || err.message}`);
      } else {
        setError(err.message || 'Error loading report catalog');
      }
    } finally {
      setLoading(false);
    }
  };

  // Load schedules
  const loadSchedules = async () => {
    try {
      const res = await apiGet<{ schedules: ReportSchedule[] }>('/reports/schedules');
      if (res?.schedules) {
        setSchedules(res.schedules);
      }
    } catch {
      // schedules fallback
    }
  };

  useEffect(() => {
    loadCatalog();
    loadSchedules();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => set.add(r.category || r.module.toUpperCase()));
    return ['ALL', ...Array.from(set)];
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      const matchesCategory =
        selectedCategory === 'ALL' ||
        (r.category && r.category.toUpperCase() === selectedCategory.toUpperCase()) ||
        r.module.toUpperCase() === selectedCategory.toUpperCase();
      const matchesSearch =
        r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [reports, selectedCategory, searchQuery]);

  const handleRunReport = async (report: ReportDefinition) => {
    setActiveReport(report);
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<ReportRunResult>(`/reports/${report.id}/run`, {});
      setRunResult(res);
      setActiveTab('results');
      setSuccessMsg(`Report ${report.id} generated ${res.rowCount} rows`);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to run report');
    } finally {
      setLoading(false);
    }
  };

  const handleExportReport = async (report: ReportDefinition, format = 'CSV') => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<{ runId: string; fileId: string; fileName: string }>(
        `/reports/${report.id}/export`,
        { format },
      );
      setSuccessMsg(`Export completed! File reference: ${res.fileName || res.fileId}`);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to export report');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSchedule = async () => {
    if (!activeReport) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost('/reports/schedules', {
        reportId: activeReport.id,
        cronExpression: scheduleCron,
        format: scheduleFormat,
        recipients: scheduleRecipients.split(',').map((s) => s.trim()),
      });
      setIsScheduleModalOpen(false);
      setSuccessMsg(`Schedule created for ${activeReport.id}`);
      await loadSchedules();
      setActiveTab('schedules');
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to create schedule');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Are you sure you want to remove this scheduled delivery?')) return;
    try {
      await apiDelete(`/reports/schedules/${id}`);
      setSuccessMsg('Schedule removed');
      await loadSchedules();
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to delete schedule');
    }
  };

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="h4 fw-bold mb-1" style={{ color: 'var(--grey-900)' }}>
            📊 Report Catalogue & Business Intelligence
          </h2>
          <p className="text-muted small mb-0">
            Tenant-isolated, entitlement-gated clinical, supply, financial, and compliance reporting (AC-21).
          </p>
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'catalog' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setActiveTab('catalog')}
          >
            📚 Catalogue ({reports.length})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'schedules' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setActiveTab('schedules')}
          >
            ⏰ Scheduled ({schedules.length})
          </button>
          {runResult && (
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'results' ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => setActiveTab('results')}
            >
              📄 Live View ({runResult.rowCount})
            </button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="alert alert-danger alert-dismissible fade show small" role="alert">
          <strong>Error:</strong> {error}
          <button type="button" className="btn-close" onClick={() => setError(null)} />
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success alert-dismissible fade show small" role="alert">
          {successMsg}
          <button type="button" className="btn-close" onClick={() => setSuccessMsg(null)} />
        </div>
      )}

      {/* Tab 1: Catalogue */}
      {activeTab === 'catalog' && (
        <>
          {/* Filter Chips & Search Bar */}
          <div className="card shadow-sm border-0 mb-4" style={{ borderRadius: 'var(--radius-md)' }}>
            <div className="card-body p-3">
              <div className="row g-2 align-items-center">
                <div className="col-md-5">
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-transparent border-end-0">🔍</span>
                    <input
                      type="text"
                      className="form-control border-start-0"
                      placeholder="Search reports by code, name, or description..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="col-md-7 d-flex flex-wrap gap-1 justify-content-md-end">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`btn btn-sm rounded-pill px-3 ${
                        selectedCategory === cat ? 'btn-dark' : 'btn-outline-secondary'
                      }`}
                      style={{ fontSize: '0.75rem' }}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Report Cards Grid */}
          <div className="row g-3">
            {filteredReports.map((report) => (
              <div key={report.id} className="col-md-6 col-lg-4">
                <div
                  className="card h-100 shadow-sm border-0"
                  style={{
                    borderRadius: 'var(--radius-md)',
                    borderLeft: `4px solid ${
                      report.module === 'supply'
                        ? '#0284c7'
                        : report.module === 'clinical'
                        ? '#16a34a'
                        : report.module === 'billing'
                        ? '#ca8a04'
                        : report.module === 'compliance'
                        ? '#dc2626'
                        : '#64748b'
                    }`,
                  }}
                >
                  <div className="card-body d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <span className="badge bg-light text-dark border font-monospace" style={{ fontSize: '0.75rem' }}>
                        {report.id}
                      </span>
                      <span className="badge bg-primary-subtle text-primary text-uppercase" style={{ fontSize: '0.68rem' }}>
                        {report.module}
                      </span>
                    </div>

                    <h5 className="h6 fw-bold mb-1" style={{ color: 'var(--grey-800)' }}>
                      {report.name}
                    </h5>
                    <p className="text-muted small flex-grow-1 mb-3" style={{ fontSize: '0.8rem', minHeight: 40 }}>
                      {report.description}
                    </p>

                    <div className="d-flex flex-wrap gap-1 mb-3">
                      <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: '0.65rem' }}>
                        Period: {report.default_period}
                      </span>
                      <span className="badge bg-info-subtle text-info" style={{ fontSize: '0.65rem' }}>
                        Formats: {report.export_formats?.join(', ') || 'CSV, JSON'}
                      </span>
                    </div>

                    <div className="d-flex gap-2 pt-2 border-top">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary flex-grow-1"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => handleRunReport(report)}
                        disabled={loading}
                      >
                        ⚡ Run Now
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => {
                          setPdfReportId(report.id);
                          setPdfReportTitle(report.name);
                          setPdfModalOpen(true);
                        }}
                        title="View / Print Formal True PDF"
                      >
                        📄 PDF
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => handleExportReport(report, 'CSV')}
                        title="Export as CSV"
                        disabled={loading}
                      >
                        📥 Export
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-dark"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => {
                          setActiveReport(report);
                          setIsScheduleModalOpen(true);
                        }}
                        title="Configure scheduled delivery"
                      >
                        ⏰
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {filteredReports.length === 0 && (
              <div className="col-12 text-center py-5 text-muted">
                No reports found matching your entitled modules and filter.
              </div>
            )}
          </div>
        </>
      )}

      {/* Tab 2: Scheduled Deliveries */}
      {activeTab === 'schedules' && (
        <div className="card shadow-sm border-0" style={{ borderRadius: 'var(--radius-md)' }}>
          <div className="card-header bg-white py-3">
            <h5 className="h6 fw-bold mb-0">Active Report Delivery Schedules (JOB-20)</h5>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.85rem' }}>
              <thead className="table-light">
                <tr>
                  <th>Report</th>
                  <th>Schedule (Cron)</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Last Run</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="badge bg-light text-dark border font-monospace me-2">{s.report_id}</span>
                      <span className="fw-medium">{s.report_name || s.report_id}</span>
                    </td>
                    <td>
                      <code>{s.cron_expression}</code>
                    </td>
                    <td>
                      <span className="badge bg-info-subtle text-info">{s.format}</span>
                    </td>
                    <td>
                      <span className={`badge ${s.is_active ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>
                        {s.is_active ? 'ACTIVE' : 'SUSPENDED'}
                      </span>
                    </td>
                    <td>{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'Never'}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger py-0 px-2"
                        onClick={() => handleDeleteSchedule(s.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {schedules.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-muted">
                      No automated report schedules configured. Use the ⏰ icon on any report to schedule.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Run Results Table */}
      {activeTab === 'results' && runResult && (
        <div className="card shadow-sm border-0" style={{ borderRadius: 'var(--radius-md)' }}>
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3">
            <div>
              <span className="badge bg-primary me-2">{runResult.reportId}</span>
              <strong className="h6 mb-0">{runResult.reportName}</strong>
              <span className="text-muted small ms-2">({runResult.rowCount} rows returned)</span>
            </div>
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-sm btn-danger d-flex align-items-center gap-1 shadow-sm"
                onClick={() => {
                  setPdfReportId(runResult.reportId);
                  setPdfReportTitle(runResult.reportName);
                  setPdfModalOpen(true);
                }}
              >
                <span>📄</span> Formal PDF View / Print
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() => handleExportReport({ id: runResult.reportId } as any, 'CSV')}
              >
                📥 Download CSV
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setActiveTab('catalog')}
              >
                Back to Catalogue
              </button>
            </div>
          </div>
          <div className="table-responsive" style={{ maxHeight: 600 }}>
            <table className="table table-striped table-sm table-hover align-middle mb-0" style={{ fontSize: '0.8rem' }}>
              <thead className="table-light sticky-top">
                <tr>
                  {runResult.data[0] &&
                    Object.keys(runResult.data[0]).map((col) => (
                      <th key={col} className="text-uppercase font-monospace" style={{ fontSize: '0.72rem' }}>
                        {col}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {runResult.data.map((row, idx) => (
                  <tr key={idx}>
                    {Object.values(row).map((val: any, cIdx) => (
                      <td key={cIdx}>
                        {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
                {runResult.data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-4 text-muted">
                      No data records found in report query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Schedule Delivery */}
      {isScheduleModalOpen && activeReport && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow">
              <div className="modal-header">
                <h5 className="modal-title h6 fw-bold">⏰ Schedule Delivery: {activeReport.id}</h5>
                <button type="button" className="btn-close" onClick={() => setIsScheduleModalOpen(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Report</label>
                  <input type="text" className="form-control form-control-sm" value={activeReport.name} disabled />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Cron Expression (Delivery cadence)</label>
                  <input
                    type="text"
                    className="form-control form-control-sm font-monospace"
                    value={scheduleCron}
                    onChange={(e) => setScheduleCron(e.target.value)}
                    placeholder="e.g. 0 8 * * * (Daily 08:00)"
                  />
                  <div className="form-text small">Standard 5-part cron (Minute Hour Dom Month Dow).</div>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Export Format</label>
                  <select
                    className="form-select form-select-sm"
                    value={scheduleFormat}
                    onChange={(e) => setScheduleFormat(e.target.value)}
                  >
                    <option value="CSV">CSV</option>
                    <option value="JSON">JSON</option>
                    <option value="PDF">PDF</option>
                  </select>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Recipients (comma separated)</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={scheduleRecipients}
                    onChange={(e) => setScheduleRecipients(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setIsScheduleModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={handleCreateSchedule} disabled={loading}>
                  Save Schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Formal True Vector PDF Report Viewer Modal ── */}
      <ReportPdfModal
        isOpen={pdfModalOpen}
        onClose={() => {
          setPdfModalOpen(false);
          setPdfReportId(null);
        }}
        reportId={pdfReportId || undefined}
        reportTitle={pdfReportTitle}
        filename={pdfReportId ? `${pdfReportId.toLowerCase()}_formal_report.pdf` : undefined}
      />
    </div>
  );
}
