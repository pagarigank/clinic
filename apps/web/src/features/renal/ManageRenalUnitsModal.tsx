import React, { useState } from "react";
import { Modal, Button, Alert } from "@clinic/ui";
import {
  renalApi,
  type RenalStation,
  type DialysisMachine,
} from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

export interface ManageRenalUnitsModalProps {
  show: boolean;
  onHide: () => void;
  stations: RenalStation[];
  machines: DialysisMachine[];
  onRefresh: () => Promise<void>;
}

export function ManageRenalUnitsModal({
  show,
  onHide,
  stations,
  machines,
  onRefresh,
}: ManageRenalUnitsModalProps) {
  const { session } = useAuth();
  const branchId =
    session?.branchId ||
    stations[0]?.branch_id ||
    machines[0]?.branch_id ||
    "00000000-0000-0000-0000-000000000000";

  const [activeTab, setActiveTab] = useState<"MACHINES" | "STATIONS">("MACHINES");

  // Machine Creation State
  const [isAddingMachine, setIsAddingMachine] = useState(false);
  const [machSerialNo, setMachSerialNo] = useState("");
  const [machBrand, setMachBrand] = useState("Fresenius Medical Care");
  const [machModel, setMachModel] = useState("4008S Classic");
  const [machStationId, setMachStationId] = useState("");
  const [machHours, setMachHours] = useState<number>(0);
  const [machIsIsolation, setMachIsIsolation] = useState(false);

  // Station Creation State
  const [isAddingStation, setIsAddingStation] = useState(false);
  const [stStationNo, setStStationNo] = useState("");
  const [stName, setStName] = useState("");
  const [stRoom, setStRoom] = useState("Main Bay");
  const [stIsIsolation, setStIsIsolation] = useState(false);

  // Machine Service Modal / Action State
  const [servicingMachine, setServicingMachine] = useState<DialysisMachine | null>(null);
  const [serviceType, setServiceType] = useState<"DISINFECTION" | "PREVENTIVE_MAINTENANCE" | "REPAIR" | "CALIBRATION">("DISINFECTION");
  const [serviceNotes, setServiceNotes] = useState("");
  const [serviceStatusAfter, setServiceStatusAfter] = useState<"ACTIVE" | "MAINTENANCE" | "QUARANTINE">("ACTIVE");

  // UI status
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add Machine Submit
  async function handleCreateMachine(e: React.FormEvent) {
    e.preventDefault();
    if (!machSerialNo.trim() || !machBrand.trim() || !machModel.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await renalApi.createMachine({
        branchId,
        serialNo: machSerialNo.trim(),
        brand: machBrand.trim(),
        model: machModel.trim(),
        stationId: machStationId || undefined,
        totalOperatingHours: Number(machHours) || 0,
        isIsolation: machIsIsolation,
      });
      setSuccessMsg(`Dialysis machine '${machSerialNo}' registered successfully.`);
      setIsAddingMachine(false);
      setMachSerialNo("");
      setMachStationId("");
      setMachHours(0);
      setMachIsIsolation(false);
      await onRefresh();
    } catch (err: any) {
      const detail = err?.problem?.detail || err?.message || "Failed to register machine";
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  // Add Station Submit
  async function handleCreateStation(e: React.FormEvent) {
    e.preventDefault();
    if (!stStationNo.trim() || !stName.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await renalApi.createStation({
        branchId,
        stationNo: stStationNo.trim(),
        name: stName.trim(),
        room: stRoom.trim() || undefined,
        isIsolation: stIsIsolation,
        isActive: true,
      });
      setSuccessMsg(`Dialysis chair station '${stStationNo}' created successfully.`);
      setIsAddingStation(false);
      setStStationNo("");
      setStName("");
      setStRoom("Main Bay");
      setStIsIsolation(false);
      await onRefresh();
    } catch (err: any) {
      const detail = err?.problem?.detail || err?.message || "Failed to create station";
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  // Re-pair machine to station or toggle machine status
  async function handleUpdateMachineStatus(machineId: string, newStatus: "ACTIVE" | "MAINTENANCE" | "QUARANTINE" | "DECOMMISSIONED") {
    setSubmitting(true);
    setError(null);
    try {
      await renalApi.updateMachine(machineId, { status: newStatus });
      await onRefresh();
      setSuccessMsg("Machine operational status updated.");
    } catch (err: any) {
      setError(err?.problem?.detail || err?.message || "Failed to update machine status");
    } finally {
      setSubmitting(false);
    }
  }

  // Service Machine Submit
  async function handleServiceMachine(e: React.FormEvent) {
    e.preventDefault();
    if (!servicingMachine) return;
    setSubmitting(true);
    setError(null);
    try {
      await renalApi.serviceMachine(servicingMachine.id, {
        serviceType,
        notes: serviceNotes || undefined,
        statusAfterService: serviceStatusAfter,
      });
      setSuccessMsg(`Machine ${servicingMachine.serial_no} serviced / disinfected. Status set to ${serviceStatusAfter}.`);
      setServicingMachine(null);
      setServiceNotes("");
      await onRefresh();
    } catch (err: any) {
      setError(err?.problem?.detail || err?.message || "Failed to record machine service");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal show={show} onHide={onHide} size="xl" centered>
      <Modal.Header closeButton className="border-bottom pb-3">
        <div>
          <Modal.Title className="h5 fw-bold text-primary d-flex align-items-center gap-2">
            <span>⚙️</span> Dialysis Unit Equipment &amp; Station Configuration
          </Modal.Title>
          <p className="text-muted small mb-0">
            Configure available dialysis machines, treatment chairs, isolation suites, and chair-to-machine pairings.
          </p>
        </div>
      </Modal.Header>

      <Modal.Body className="p-4">
        {error && (
          <Alert variant="danger" className="mb-3 py-2 small shadow-sm">
            <strong>Error:</strong> {error}
          </Alert>
        )}

        {successMsg && (
          <Alert variant="success" className="mb-3 py-2 small shadow-sm">
            <strong>Success:</strong> {successMsg}
          </Alert>
        )}

        {/* Tab Selection */}
        <div className="d-flex justify-content-between align-items-center mb-4 border-bottom pb-2">
          <div className="btn-group" role="group">
            <button
              type="button"
              className={`btn btn-sm ${
                activeTab === "MACHINES" ? "btn-primary" : "btn-outline-secondary"
              }`}
              onClick={() => setActiveTab("MACHINES")}
            >
              📟 Dialysis Machines ({machines.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${
                activeTab === "STATIONS" ? "btn-primary" : "btn-outline-secondary"
              }`}
              onClick={() => setActiveTab("STATIONS")}
            >
              💺 Chairs &amp; Stations ({stations.length})
            </button>
          </div>

          <div>
            {activeTab === "MACHINES" ? (
              <Button
                variant="primary"
                size="sm"
                className="shadow-sm fw-bold d-flex align-items-center gap-1"
                onClick={() => setIsAddingMachine(!isAddingMachine)}
              >
                <span>{isAddingMachine ? "✕ Cancel" : "➕ Register New Dialysis Machine"}</span>
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                className="shadow-sm fw-bold d-flex align-items-center gap-1"
                onClick={() => setIsAddingStation(!isAddingStation)}
              >
                <span>{isAddingStation ? "✕ Cancel" : "➕ Add Station / Chair"}</span>
              </Button>
            )}
          </div>
        </div>

        {/* ── 1. DIALYSIS MACHINES TAB ────────────────────────────────────────── */}
        {activeTab === "MACHINES" && (
          <div>
            {/* Inline Add Machine Form */}
            {isAddingMachine && (
              <div className="card border-primary bg-primary-subtle rounded-3 p-3 mb-4 shadow-sm">
                <h6 className="fw-bold text-primary mb-3">Register New Hemodialysis Machine</h6>
                <form onSubmit={handleCreateMachine}>
                  <div className="row g-2 mb-3">
                    <div className="col-md-3">
                      <label className="form-label small fw-bold">Serial / Asset Tag *</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="e.g. FMC-4008S-09"
                        value={machSerialNo}
                        onChange={(e) => setMachSerialNo(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-bold">Manufacturer / Brand *</label>
                      <select
                        className="form-select form-select-sm"
                        value={machBrand}
                        onChange={(e) => setMachBrand(e.target.value)}
                        required
                      >
                        <option value="Fresenius Medical Care">Fresenius Medical Care</option>
                        <option value="Nipro">Nipro</option>
                        <option value="B. Braun">B. Braun</option>
                        <option value="Baxter / Gambro">Baxter / Gambro</option>
                        <option value="Toray">Toray</option>
                        <option value="Bellco">Bellco</option>
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-bold">Model Name *</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="e.g. 4008S Classic / 5008 CorDiax"
                        value={machModel}
                        onChange={(e) => setMachModel(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-bold">Paired Chair / Station</label>
                      <select
                        className="form-select form-select-sm"
                        value={machStationId}
                        onChange={(e) => setMachStationId(e.target.value)}
                      >
                        <option value="">-- Standby / Unassigned --</option>
                        {stations.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.station_no} &bull; {st.name} {st.is_isolation ? "[ISOLATION]" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="row g-2 mb-3 align-items-center">
                    <div className="col-md-3">
                      <label className="form-label small fw-bold">Initial Operating Hours</label>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={machHours}
                        onChange={(e) => setMachHours(Number(e.target.value))}
                      />
                    </div>
                    <div className="col-md-5 pt-3">
                      <div className="form-check">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id="chkMachIso"
                          checked={machIsIsolation}
                          onChange={(e) => setMachIsIsolation(e.target.checked)}
                        />
                        <label className="form-check-label small fw-semibold" htmlFor="chkMachIso">
                          Designate as Isolation Machine (Dedicated strictly for HBsAg+ patients)
                        </label>
                      </div>
                    </div>
                    <div className="col-md-4 text-end pt-3">
                      <Button
                        variant="primary"
                        size="sm"
                        type="submit"
                        disabled={submitting}
                        className="fw-bold"
                      >
                        {submitting ? "Saving..." : "Save Dialysis Machine"}
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Machines Table */}
            <div className="table-responsive border rounded-3">
              <table className="table table-hover align-middle mb-0 small">
                <thead className="table-light text-uppercase text-muted">
                  <tr>
                    <th>Serial No</th>
                    <th>Brand &amp; Model</th>
                    <th>Assigned Station</th>
                    <th>Operating Hours</th>
                    <th>Designation</th>
                    <th>Status</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-4 text-muted">
                        No dialysis machines registered yet. Click "Register New Dialysis Machine" above.
                      </td>
                    </tr>
                  ) : (
                    machines.map((m) => {
                      const pairedStation = stations.find((s) => s.id === m.station_id);
                      return (
                        <tr key={m.id}>
                          <td>
                            <strong className="font-monospace text-primary">{m.serial_no}</strong>
                          </td>
                          <td>
                            <div className="fw-semibold text-dark">{m.brand}</div>
                            <div className="text-muted">{m.model}</div>
                          </td>
                          <td>
                            {pairedStation ? (
                              <span className="badge bg-light text-dark border">
                                {pairedStation.station_no} ({pairedStation.name})
                              </span>
                            ) : (
                              <span className="text-muted fst-italic">Standby Unit</span>
                            )}
                          </td>
                          <td>
                            <strong>{Number(m.total_operating_hours).toFixed(1)} hrs</strong>
                            {m.last_disinfected_at && (
                              <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                Disinfected: {new Date(m.last_disinfected_at).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                          <td>
                            {m.is_isolation ? (
                              <span className="badge bg-danger">ISOLATION (HBsAg+)</span>
                            ) : (
                              <span className="badge bg-light text-secondary border">STANDARD</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                m.status === "ACTIVE"
                                  ? "bg-success"
                                  : m.status === "MAINTENANCE"
                                  ? "bg-warning text-dark"
                                  : "bg-danger"
                              }`}
                            >
                              {m.status}
                            </span>
                          </td>
                          <td className="text-end">
                            <div className="d-flex justify-content-end gap-1">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-info"
                                onClick={() => setServicingMachine(m)}
                                title="Record disinfection or maintenance"
                              >
                                Disinfect / Service
                              </button>
                              {m.status === "ACTIVE" ? (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-warning"
                                  onClick={() => handleUpdateMachineStatus(m.id, "MAINTENANCE")}
                                >
                                  Hold for Maintenance
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-success"
                                  onClick={() => handleUpdateMachineStatus(m.id, "ACTIVE")}
                                >
                                  Mark Active
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 2. STATIONS & CHAIRS TAB ────────────────────────────────────────── */}
        {activeTab === "STATIONS" && (
          <div>
            {/* Inline Add Station Form */}
            {isAddingStation && (
              <div className="card border-primary bg-primary-subtle rounded-3 p-3 mb-4 shadow-sm">
                <h6 className="fw-bold text-primary mb-3">Add Dialysis Chair Station</h6>
                <form onSubmit={handleCreateStation}>
                  <div className="row g-2 mb-3 align-items-center">
                    <div className="col-md-3">
                      <label className="form-label small fw-bold">Station / Chair No *</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="e.g. Chair 05 / ST-05"
                        value={stStationNo}
                        onChange={(e) => setStStationNo(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-bold">Chair Name / Description *</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="e.g. BMA Electric Recliner #5"
                        value={stName}
                        onChange={(e) => setStName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-bold">Room / Treatment Area</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="e.g. Main Treatment Bay / Room A"
                        value={stRoom}
                        onChange={(e) => setStRoom(e.target.value)}
                      />
                    </div>
                    <div className="col-md-2 pt-3">
                      <div className="form-check">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id="chkStIso"
                          checked={stIsIsolation}
                          onChange={(e) => setStIsIsolation(e.target.checked)}
                        />
                        <label className="form-check-label small fw-semibold" htmlFor="chkStIso">
                          Isolation Chair
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="d-flex justify-content-end">
                    <Button
                      variant="primary"
                      size="sm"
                      type="submit"
                      disabled={submitting}
                      className="fw-bold"
                    >
                      {submitting ? "Saving..." : "Save Dialysis Station"}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* Stations Table */}
            <div className="table-responsive border rounded-3">
              <table className="table table-hover align-middle mb-0 small">
                <thead className="table-light text-uppercase text-muted">
                  <tr>
                    <th>Station No</th>
                    <th>Chair Name</th>
                    <th>Room / Area</th>
                    <th>Paired Machine</th>
                    <th>Designation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stations.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-4 text-muted">
                        No dialysis stations registered yet. Click "Add Station / Chair" above.
                      </td>
                    </tr>
                  ) : (
                    stations.map((st) => {
                      const pairedMachine = machines.find((m) => m.station_id === st.id);
                      return (
                        <tr key={st.id}>
                          <td>
                            <strong className="fs-6 text-primary">{st.station_no}</strong>
                          </td>
                          <td>
                            <div className="fw-semibold text-dark">{st.name}</div>
                          </td>
                          <td>
                            <span className="badge bg-light text-dark border">
                              {st.room || "Main Bay"}
                            </span>
                          </td>
                          <td>
                            {pairedMachine ? (
                              <div className="small">
                                <strong className="font-monospace text-dark">
                                  {pairedMachine.brand} {pairedMachine.model}
                                </strong>
                                <div className="text-muted">SN: {pairedMachine.serial_no}</div>
                              </div>
                            ) : (
                              <span className="text-muted fst-italic">No machine paired</span>
                            )}
                          </td>
                          <td>
                            {st.is_isolation ? (
                              <span className="badge bg-danger">ISOLATION (HBsAg+)</span>
                            ) : (
                              <span className="badge bg-light text-secondary border">STANDARD</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`badge ${st.is_active ? "bg-success" : "bg-secondary"}`}
                            >
                              {st.is_active ? "ACTIVE" : "INACTIVE"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Mini Disinfection / Service Modal */}
        {servicingMachine && (
          <div className="modal show d-block mt-4" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content border-0 shadow-lg">
                <div className="modal-header">
                  <h6 className="modal-title fw-bold">
                    Disinfection / Service: {servicingMachine.serial_no} ({servicingMachine.brand})
                  </h6>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setServicingMachine(null)}
                  ></button>
                </div>
                <form onSubmit={handleServiceMachine}>
                  <div className="modal-body small">
                    <div className="mb-2">
                      <label className="form-label fw-semibold">Service Type *</label>
                      <select
                        className="form-select form-select-sm"
                        value={serviceType}
                        onChange={(e: any) => setServiceType(e.target.value)}
                      >
                        <option value="DISINFECTION">Chemical Thermal Disinfection</option>
                        <option value="PREVENTIVE_MAINTENANCE">Preventive Maintenance (PM)</option>
                        <option value="CALIBRATION">Conductivity / Pressure Calibration</option>
                        <option value="REPAIR">Corrective Repair</option>
                      </select>
                    </div>

                    <div className="mb-2">
                      <label className="form-label fw-semibold">Status After Service</label>
                      <select
                        className="form-select form-select-sm"
                        value={serviceStatusAfter}
                        onChange={(e: any) => setServiceStatusAfter(e.target.value)}
                      >
                        <option value="ACTIVE">ACTIVE (Ready for Patient Treatment)</option>
                        <option value="MAINTENANCE">MAINTENANCE (Hold for Validation)</option>
                        <option value="QUARANTINE">QUARANTINE (Failed QA)</option>
                      </select>
                    </div>

                    <div className="mb-2">
                      <label className="form-label fw-semibold">Notes / Disinfectant Used</label>
                      <textarea
                        className="form-control form-control-sm"
                        rows={3}
                        placeholder="e.g. Citric acid heat disinfection 85°C completed, rinse conductivity verified."
                        value={serviceNotes}
                        onChange={(e) => setServiceNotes(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="modal-footer">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => setServicingMachine(null)}
                    >
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" type="submit" disabled={submitting}>
                      {submitting ? "Saving..." : "Record Service & Disinfection"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer className="border-top pt-3">
        <Button variant="primary" onClick={onHide}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
