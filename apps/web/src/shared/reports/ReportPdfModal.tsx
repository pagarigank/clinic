import React, { useEffect, useState, useRef } from 'react';
import { apiGetBlob, ApiError } from '../api/client.js';

export interface ReportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportId?: string;
  reportTitle?: string;
  pdfEndpoint?: string;
  queryParams?: Record<string, string | number | boolean | undefined>;
  filename?: string;
}

export function ReportPdfModal({
  isOpen,
  onClose,
  reportId,
  reportTitle,
  pdfEndpoint,
  queryParams,
  filename,
}: ReportPdfModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const resolvedEndpoint = pdfEndpoint || (reportId ? `/reports/${reportId}/pdf` : '');
  const displayTitle = reportTitle || (reportId ? `Report: ${reportId}` : 'Document Preview');
  const downloadFilename = filename || `${(reportId || 'formal_report').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;

  const fetchPdf = async () => {
    if (!isOpen || !resolvedEndpoint) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (queryParams) {
        Object.entries(queryParams).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== '') {
            params.set(k, String(v));
          }
        });
      }
      const qs = params.toString() ? `?${params.toString()}` : '';
      const url = `${resolvedEndpoint}${qs}`;

      const blob = await apiGetBlob(url);
      const urlObject = window.URL.createObjectURL(blob);
      setBlobUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return urlObject;
      });
    } catch (err) {
      console.error('Failed to load PDF document:', err);
      const msg =
        err instanceof ApiError
          ? `${err.problem.title}${err.problem.detail ? ': ' + err.problem.detail : ''}`
          : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchPdf();
    } else {
      if (blobUrl) {
        window.URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
      }
    }
    return () => {
      if (blobUrl) {
        window.URL.revokeObjectURL(blobUrl);
      }
    };
  }, [isOpen, resolvedEndpoint, JSON.stringify(queryParams)]);

  const handlePrint = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.focus();
        iframeRef.current.contentWindow.print();
      } catch (e) {
        console.error('Iframe print failed, falling back to window open:', e);
        if (blobUrl) {
          const w = window.open(blobUrl, '_blank');
          w?.print();
        }
      }
    }
  };

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = downloadFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal fade show d-block"
      tabIndex={-1}
      role="dialog"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.75)', zIndex: 1055 }}
    >
      <div className="modal-dialog modal-xl modal-dialog-centered" style={{ maxWidth: '94vw', height: '92vh' }}>
        <div
          className="modal-content shadow-lg border-0 d-flex flex-column"
          style={{ height: '92vh', borderRadius: '12px', overflow: 'hidden' }}
        >
          {/* Modal Header */}
          <div className="modal-header bg-white border-bottom py-2 px-4 d-flex justify-content-between align-items-center">
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-primary-subtle text-primary fw-semibold px-2 py-1" style={{ fontSize: '0.8rem' }}>
                True Vector PDF
              </span>
              <h5 className="modal-title h6 fw-bold mb-0 text-dark">
                {displayTitle}
              </h5>
              {reportId && (
                <span className="badge bg-light text-muted border font-monospace" style={{ fontSize: '0.75rem' }}>
                  {reportId}
                </span>
              )}
            </div>

            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                onClick={fetchPdf}
                disabled={loading}
                title="Regenerate Document"
              >
                🔄 Refresh
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                onClick={handleDownload}
                disabled={!blobUrl || loading}
                title="Download true PDF to local disk"
              >
                📥 Download PDF
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary d-flex align-items-center gap-1 px-3"
                onClick={handlePrint}
                disabled={!blobUrl || loading}
                title="Print formal vector document (without menus or page chrome)"
              >
                🖨️ Print Document
              </button>
              <button
                type="button"
                className="btn-close ms-2"
                aria-label="Close"
                onClick={onClose}
              />
            </div>
          </div>

          {/* Modal Body */}
          <div className="modal-body p-0 flex-grow-1 position-relative bg-light" style={{ overflow: 'hidden' }}>
            {loading && (
              <div
                className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center bg-white bg-opacity-75"
                style={{ zIndex: 10 }}
              >
                <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
                  <span className="visually-hidden">Rendering...</span>
                </div>
                <div className="fw-semibold text-dark">Rendering High-Fidelity Healthcare PDF...</div>
                <div className="text-muted small mt-1">Applying regulatory formatting, SHA-256 digest, and letterheads</div>
              </div>
            )}

            {error ? (
              <div className="p-4 text-center my-5">
                <div className="alert alert-danger d-inline-block text-start" style={{ maxWidth: 600 }}>
                  <h6 className="fw-bold mb-1">Failed to generate PDF document</h6>
                  <p className="mb-3 small">{error}</p>
                  <button type="button" className="btn btn-sm btn-danger" onClick={fetchPdf}>
                    Retry Generation
                  </button>
                </div>
              </div>
            ) : blobUrl ? (
              <iframe
                ref={iframeRef}
                src={blobUrl}
                title="Formal PDF Document Preview"
                className="w-100 h-100 border-0"
                style={{ display: 'block' }}
              />
            ) : null}
          </div>

          {/* Modal Footer */}
          <div className="modal-footer bg-white border-top py-2 px-4 d-flex justify-content-between align-items-center">
            <span className="text-muted" style={{ fontSize: '0.78rem' }}>
              🔒 Document certified with cryptographic SHA-256 seal &middot; Formal statutory format for DOH / PhilHealth compliance
            </span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
