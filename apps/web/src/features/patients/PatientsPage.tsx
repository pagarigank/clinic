import React, { useState } from "react";
import { AlertBanner } from "@clinic/ui";

interface PatientRow {
  id: string;
  patientNo: string;
  name: string;
  dob: string;
  gender: string;
  phone: string;
  philhealthNo?: string;
  status: "ACTIVE" | "INACTIVE";
}

const SAMPLE_PATIENTS: PatientRow[] = [
  {
    id: "p1",
    patientNo: "PAT-2026-0001",
    name: "Santos, Maria Elena P.",
    dob: "1988-04-12",
    gender: "F",
    phone: "0917-555-0192",
    philhealthNo: "12-345678901-2",
    status: "ACTIVE",
  },
  {
    id: "p2",
    patientNo: "PAT-2026-0002",
    name: "Dela Cruz, Juan Carlos",
    dob: "1975-11-23",
    gender: "M",
    phone: "0918-555-0344",
    philhealthNo: "09-876543210-9",
    status: "ACTIVE",
  },
  {
    id: "p3",
    patientNo: "PAT-2026-0003",
    name: "Reyes, Angelita M.",
    dob: "1994-08-30",
    gender: "F",
    phone: "0920-555-0811",
    status: "ACTIVE",
  },
  {
    id: "p4",
    patientNo: "PAT-2026-0004",
    name: "Lim, Roberto S.",
    dob: "1960-01-15",
    gender: "M",
    phone: "0917-555-0999",
    philhealthNo: "11-223344556-7",
    status: "ACTIVE",
  },
];

export function PatientsPage() {
  const [patients, setPatients] = useState<PatientRow[]>(SAMPLE_PATIENTS);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // New patient form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("1990-01-01");
  const [gender, setGender] = useState("F");
  const [phone, setPhone] = useState("");
  const [philhealthNo, setPhilhealthNo] = useState("");
  const [isEmergency, setIsEmergency] = useState(false);

  const filtered = patients.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.patientNo.toLowerCase().includes(search.toLowerCase()) ||
    p.phone.includes(search)
  );

  const handleCreatePatient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    const newPatient: PatientRow = {
      id: `p-${Date.now()}`,
      patientNo: `PAT-2026-${String(patients.length + 5).padStart(4, "0")}`,
      name: `${lastName}, ${firstName}`,
      dob,
      gender,
      phone: phone || "N/A",
      philhealthNo: philhealthNo || undefined,
      status: "ACTIVE",
    };

    setPatients([newPatient, ...patients]);
    setIsModalOpen(false);
    setMessage(`Patient ${newPatient.name} registered successfully.`);

    // Reset form
    setFirstName("");
    setLastName("");
    setPhone("");
    setPhilhealthNo("");
    setIsEmergency(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Patient Registry</h1>
          <div className="page-subtitle">
            Search patient charts, verify PhilHealth Konsulta eligibility, or register new patients
          </div>
        </div>
        <button
          type="button"
          className="btn btn-cerulean d-flex align-items-center gap-2"
          onClick={() => setIsModalOpen(true)}
        >
          <span>+</span>
          <span>Register Patient</span>
        </button>
      </div>

      {message && (
        <div className="mb-3">
          <AlertBanner severity="success">{message}</AlertBanner>
        </div>
      )}

      {/* Search and Filters */}
      <div className="clinic-card mb-3 p-3">
        <div className="row g-2 align-items-center">
          <div className="col-md-6">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-light text-muted">🔍</span>
              <input
                type="text"
                className="form-control"
                placeholder="Search by patient name, MRN (PAT-...), or mobile number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="btn btn-outline-secondary" onClick={() => setSearch("")}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="col-md-6 text-md-end text-muted small">
            Displaying {filtered.length} of {patients.length} patient records
          </div>
        </div>
      </div>

      {/* Patients Table */}
      <div className="clinic-card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>RECORD NO.</th>
                <th>PATIENT NAME</th>
                <th>DOB / AGE</th>
                <th>GENDER</th>
                <th>CONTACT</th>
                <th>PHILHEALTH PIN</th>
                <th>STATUS</th>
                <th className="text-end">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const birthYear = parseInt(p.dob.split("-")[0] || "1990", 10);
                const age = 2026 - birthYear;
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="font-monospace fw-semibold text-secondary">
                        {p.patientNo}
                      </span>
                    </td>
                    <td>
                      <strong className="text-dark">{p.name}</strong>
                    </td>
                    <td className="small text-secondary">
                      {p.dob} ({age}y)
                    </td>
                    <td>
                      <span className="badge bg-light text-dark border">
                        {p.gender}
                      </span>
                    </td>
                    <td className="small text-secondary">{p.phone}</td>
                    <td className="small">
                      {p.philhealthNo ? (
                        <span className="badge bg-success-subtle text-success border border-success-subtle">
                          {p.philhealthNo}
                        </span>
                      ) : (
                        <span className="text-muted small">None</span>
                      )}
                    </td>
                    <td>
                      <span className="badge bg-success">
                        {p.status}
                      </span>
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => alert(`Opening chart for ${p.name} (MRN: ${p.patientNo})`)}
                      >
                        Open Chart
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Registration Modal */}
      {isModalOpen && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <form onSubmit={handleCreatePatient}>
                <div className="modal-header">
                  <h5 className="modal-title">Patient Intake & Registration</h5>
                  <button type="button" className="btn-close" onClick={() => setIsModalOpen(false)} />
                </div>
                <div className="modal-body">
                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">FIRST NAME *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">LAST NAME *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="row g-3 mb-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">DATE OF BIRTH *</label>
                      <input
                        type="date"
                        className="form-control"
                        value={dob}
                        onChange={(e) => setDob(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">GENDER *</label>
                      <select
                        className="form-select"
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                      >
                        <option value="F">Female</option>
                        <option value="M">Male</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">MOBILE NO.</label>
                      <input
                        type="tel"
                        className="form-control"
                        placeholder="0917-000-0000"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">PHILHEALTH IDENTIFICATION NO. (PIN)</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="12-digit PhilHealth PIN"
                      value={philhealthNo}
                      onChange={(e) => setPhilhealthNo(e.target.value)}
                    />
                  </div>

                  <div className="form-check p-3 bg-light rounded border">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="emergencyReg"
                      checked={isEmergency}
                      onChange={(e) => setIsEmergency(e.target.checked)}
                    />
                    <label className="form-check-label small" htmlFor="emergencyReg">
                      <strong>Emergency Intake (Deferred Consent):</strong> Patient requires immediate triage. Consent capture will be prompted at the next clinical encounter.
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-cerulean">
                    Save & Create Patient Record
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
