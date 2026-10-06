import React, { useState, useEffect, useCallback } from "react";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from "../../shared/api/client.js";

interface Icd10Record {
  code: string;
  description: string;
}

export function Icd10ManagementPage() {
  const [items, setItems] = useState<Icd10Record[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const pageSize = 20;

  // Alerts & notifications
  const [feedback, setFeedback] = useState<{ message: string; severity: "success" | "danger" | "info" } | null>(null);

  // Add modal state
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
  const [newCode, setNewCode] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit modal state
  const [editingItem, setEditingItem] = useState<Icd10Record | null>(null);
  const [editDescription, setEditDescription] = useState<string>("");
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete modal state
  const [deletingItem, setDeletingItem] = useState<Icd10Record | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState<boolean>(false);

  // Seeding state
  const [seeding, setSeeding] = useState<boolean>(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load items
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));

      const res = await apiGet<{ data: Icd10Record[]; total?: number; limit?: number; offset?: number }>(
        `/reference/icd10?${params.toString()}`,
      );

      const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? (res as any) : [];
      setItems(list);
      setTotal(typeof res?.total === "number" ? res.total : list.length);
    } catch (err: any) {
      setFeedback({
        message: err instanceof ApiError ? err.problem.detail || err.message : "Failed to load ICD-10 registry.",
        severity: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, pageSize]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Handle Create
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const code = newCode.trim().toUpperCase();
    const description = newDescription.trim();

    if (!code || !description) {
      setFormError("Both ICD-10 Code and Description are required.");
      return;
    }

    setFormSubmitting(true);
    try {
      await apiPost("/reference/icd10", { code, description });
      setFeedback({
        message: `ICD-10 Code "${code}" successfully added to master reference catalog.`,
        severity: "success",
      });
      setIsAddOpen(false);
      setNewCode("");
      setNewDescription("");
      void loadData();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setFormError(err.problem.detail || err.message);
      } else {
        setFormError(err?.message || "Failed to add ICD-10 code.");
      }
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Update
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setEditError(null);
    const description = editDescription.trim();

    if (!description) {
      setEditError("Description cannot be empty.");
      return;
    }

    setEditSubmitting(true);
    try {
      await apiPut(`/reference/icd10/${encodeURIComponent(editingItem.code)}`, { description });
      setFeedback({
        message: `ICD-10 Code "${editingItem.code}" description updated successfully.`,
        severity: "success",
      });
      setEditingItem(null);
      void loadData();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setEditError(err.problem.detail || err.message);
      } else {
        setEditError(err?.message || "Failed to update ICD-10 code.");
      }
    } finally {
      setEditSubmitting(false);
    }
  };

  // Handle Delete
  const handleDelete = async () => {
    if (!deletingItem) return;
    setDeleteSubmitting(true);
    try {
      await apiDelete(`/reference/icd10/${encodeURIComponent(deletingItem.code)}`);
      setFeedback({
        message: `ICD-10 Code "${deletingItem.code}" was removed from the catalog.`,
        severity: "info",
      });
      setDeletingItem(null);
      void loadData();
    } catch (err: any) {
      setFeedback({
        message: err instanceof ApiError ? err.problem.detail || err.message : "Failed to delete ICD-10 code.",
        severity: "danger",
      });
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // Handle Quick Seed
  const handleSeedCommon = async () => {
    setSeeding(true);
    try {
      const res = await apiPost<{ success: boolean; inserted: number; totalCommon: number }>(
        "/reference/icd10/seed-common",
      );
      setFeedback({
        message: `Standard codes sync completed: ${res.inserted} new outpatient codes added (total standard catalog: ${res.totalCommon}).`,
        severity: "success",
      });
      void loadData();
    } catch (err: any) {
      setFeedback({
        message: err instanceof ApiError ? err.problem.detail || err.message : "Failed to seed standard codes.",
        severity: "danger",
      });
    } finally {
      setSeeding(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {/* Header */}
      <div className="page-header d-flex justify-content-between align-items-start flex-wrap gap-3">
        <div>
          <h1 className="page-title">ICD-10 Diagnostic Codes Catalogue</h1>
          <div className="page-subtitle">
            Manage global ICD-10 reference codes, impressions, and diagnoses used across clinical visit charts and prescription printing.
          </div>
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={handleSeedCommon}
            disabled={seeding}
          >
            {seeding ? "Syncing..." : "⚡ Sync Common Outpatient Codes"}
          </button>
          <button
            type="button"
            className="btn btn-cerulean btn-sm"
            onClick={() => {
              setFormError(null);
              setNewCode("");
              setNewDescription("");
              setIsAddOpen(true);
            }}
          >
            + Add ICD-10 Code
          </button>
        </div>
      </div>

      {/* Real-time sync banner */}
      <div className="alert alert-info py-2 px-3 mb-4 d-flex align-items-center justify-content-between small">
        <div className="d-flex align-items-center gap-2">
          <span className="fs-5">🩺</span>
          <div>
            <strong>Live Clinical Wiring:</strong> Any code created, updated, or removed in this catalogue is immediately reflected in the doctor's consultation chart, SOAP notes, and prescription printing.
          </div>
        </div>
        <span className="badge bg-light text-primary border font-monospace">
          {total} Total Registered Codes
        </span>
      </div>

      {feedback && (
        <div className="mb-4">
          <AlertBanner severity={feedback.severity}>{feedback.message}</AlertBanner>
        </div>
      )}

      {/* Main Table Card */}
      <div className="clinic-card">
        <div className="clinic-card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-bold">Reference Catalogue</span>
            <span className="badge bg-secondary-subtle text-secondary small">
              Page {page} of {totalPages}
            </span>
          </div>

          <div className="d-flex align-items-center gap-2" style={{ minWidth: "280px" }}>
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="Search by code (e.g. J06) or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setSearch("")}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th style={{ width: "160px" }}>ICD-10 CODE</th>
                <th>CLINICAL IMPRESSION / DESCRIPTION</th>
                <th style={{ width: "140px" }} className="text-center">STATUS</th>
                <th style={{ width: "140px" }} className="text-end">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="text-center py-4 text-muted small">
                    <div className="spinner-border spinner-border-sm text-primary me-2" role="status" />
                    Loading ICD-10 catalogue...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-4 text-muted small">
                    {debouncedSearch ? (
                      <>No ICD-10 codes found matching "<strong>{debouncedSearch}</strong>".</>
                    ) : (
                      <>No ICD-10 codes recorded yet. Click "Sync Common Outpatient Codes" or "+ Add ICD-10 Code" to get started.</>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.code}>
                    <td>
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace fw-bold fs-6">
                        {item.code}
                      </span>
                    </td>
                    <td>
                      <div className="fw-semibold text-dark">{item.description}</div>
                      <div className="small text-muted font-monospace" style={{ fontSize: "0.75rem" }}>
                        ref_icd10 · {item.code}
                      </div>
                    </td>
                    <td className="text-center">
                      <span className="badge bg-success-subtle text-success border border-success-subtle">
                        Active in Visits
                      </span>
                    </td>
                    <td className="text-end">
                      <div className="btn-group btn-group-sm">
                        <button
                          type="button"
                          className="btn btn-outline-primary"
                          title="Edit diagnosis description"
                          onClick={() => {
                            setEditingItem(item);
                            setEditDescription(item.description);
                            setEditError(null);
                          }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger"
                          title="Delete ICD-10 code"
                          onClick={() => setDeletingItem(item)}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {total > pageSize && (
          <div className="clinic-card-footer d-flex justify-content-between align-items-center p-3 border-top">
            <span className="small text-muted">
              Showing {Math.min((page - 1) * pageSize + 1, total)} to {Math.min(page * pageSize, total)} of {total} codes
            </span>
            <div className="btn-group btn-group-sm">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Add Modal ──────────────────────────────────────────────────────── */}
      {isAddOpen && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleCreate}>
                <div className="modal-header">
                  <h5 className="modal-title fw-bold">Add ICD-10 Diagnostic Code</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setIsAddOpen(false)}
                    disabled={formSubmitting}
                  />
                </div>
                <div className="modal-body">
                  {formError && (
                    <div className="mb-3">
                      <AlertBanner severity="danger">{formError}</AlertBanner>
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label small fw-semibold" htmlFor="add-icd10-code">
                      ICD-10 Code *
                    </label>
                    <input
                      id="add-icd10-code"
                      type="text"
                      className="form-control font-monospace"
                      placeholder="e.g. J06.9, E11, R69"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      required
                      autoFocus
                    />
                    <div className="form-text small">
                      Standard alphanumeric format (e.g., A00 to Z99 with optional subcategory dot).
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold" htmlFor="add-icd10-desc">
                      Clinical Description / Impression *
                    </label>
                    <textarea
                      id="add-icd10-desc"
                      className="form-control"
                      rows={3}
                      placeholder="e.g. Acute upper respiratory infection, unspecified"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      required
                    />
                    <div className="form-text small">
                      This text will appear as the doctor's diagnosis and be printed on patient prescription pads.
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setIsAddOpen(false)}
                    disabled={formSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-cerulean"
                    disabled={formSubmitting}
                  >
                    {formSubmitting ? "Saving..." : "Save to Catalog"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ─────────────────────────────────────────────────────── */}
      {editingItem && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleUpdate}>
                <div className="modal-header">
                  <h5 className="modal-title fw-bold">Edit ICD-10 Code: {editingItem.code}</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setEditingItem(null)}
                    disabled={editSubmitting}
                  />
                </div>
                <div className="modal-body">
                  {editError && (
                    <div className="mb-3">
                      <AlertBanner severity="danger">{editError}</AlertBanner>
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">ICD-10 Code</label>
                    <input
                      type="text"
                      className="form-control font-monospace bg-light"
                      value={editingItem.code}
                      disabled
                    />
                    <div className="form-text small">Primary key code cannot be renamed.</div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold" htmlFor="edit-icd10-desc">
                      Clinical Description / Impression *
                    </label>
                    <textarea
                      id="edit-icd10-desc"
                      className="form-control"
                      rows={3}
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setEditingItem(null)}
                    disabled={editSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={editSubmitting}
                  >
                    {editSubmitting ? "Updating..." : "Update Description"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ──────────────────────────────────────── */}
      {deletingItem && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-danger">Delete ICD-10 Code</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setDeletingItem(null)}
                  disabled={deleteSubmitting}
                />
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to remove <strong>{deletingItem.code}</strong> (<em>{deletingItem.description}</em>) from the master catalogue?
                </p>
                <div className="alert alert-warning small mb-0">
                  ⚠️ Note: Existing past clinical visit records that already referenced this code will retain their recorded diagnosis, but new visits will no longer see it in auto-suggestions.
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setDeletingItem(null)}
                  disabled={deleteSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={handleDelete}
                  disabled={deleteSubmitting}
                >
                  {deleteSubmitting ? "Deleting..." : "Confirm Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
