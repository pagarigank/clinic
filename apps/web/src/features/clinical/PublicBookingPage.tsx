import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertBanner, DateField } from "@clinic/ui";
import { apiGet, apiPost, ApiError } from "../../shared/api/client.js";

interface Branch {
  id: string;
  name: string;
  code: string;
  service_profile?: any;
}

interface Practitioner {
  id: string;
  name: string;
  email?: string;
  title?: string;
  specialization?: string;
}

interface ClinicConfig {
  clinic: {
    id: string;
    name: string;
    slug: string;
  };
  branches: Branch[];
  practitioners: Practitioner[];
}

interface Slot {
  startsAt: string;
  endsAt: string;
  available: boolean;
}

interface BookingSuccessResult {
  appointmentId: string;
  referenceNo: string;
  status: string;
  channel: string;
  startsAt: string;
  endsAt: string;
  patientName: string;
  practitionerId: string;
  branchId: string;
}

function formatDate(isoDate: string): string {
  try {
    const d = new Date(`${isoDate}T00:00:00`);
    return d.toLocaleDateString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function formatTime(isoDateTime: string): string {
  if (!isoDateTime) return "--:--";
  const time = isoDateTime.slice(11, 16);
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr || "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${mStr || "00"} ${ampm}`;
}

function calculateAge(dobString: string): number | null {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;
  const diff = Date.now() - dob.getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

export function PublicBookingPage() {
  const [searchParams] = useSearchParams();
  const initialSlug = searchParams.get("slug") || "demo-a";

  const [slug, setSlug] = useState(initialSlug);
  const [tenantInput, setTenantInput] = useState(initialSlug);
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Booking selections
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string>("");

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const [selectedDate, setSelectedDate] = useState<string>(tomorrow);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  // Patient info
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("1995-01-01");
  const [gender, setGender] = useState<"M" | "F" | "OTHER">("M");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<BookingSuccessResult | null>(null);

  // Load clinic config
  const loadConfig = useCallback(async (clinicSlug: string) => {
    setLoadingConfig(true);
    setConfigError(null);
    try {
      const data = await apiGet<ClinicConfig>(`/public/booking/clinic?slug=${encodeURIComponent(clinicSlug)}`);
      setConfig(data);
      if (data.branches?.length > 0 && data.branches[0]) {
        setSelectedBranchId(data.branches[0].id);
      }
      if (data.practitioners?.length > 0 && data.practitioners[0]) {
        setSelectedPractitionerId(data.practitioners[0].id);
      }
    } catch (err) {
      setConfigError(
        err instanceof ApiError
          ? err.problem.detail || `Clinic "${clinicSlug}" not found.`
          : `Failed to load clinic information for "${clinicSlug}".`,
      );
      setConfig(null);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig(slug);
  }, [slug, loadConfig]);

  // Load available slots
  const loadAvailability = useCallback(async () => {
    if (!slug || !selectedBranchId || !selectedPractitionerId || !selectedDate) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);
    setSelectedSlot(null);
    try {
      const res = await apiGet<{ slots?: Slot[] }>(
        `/public/booking/availability?slug=${encodeURIComponent(slug)}&branchId=${encodeURIComponent(selectedBranchId)}&practitionerId=${encodeURIComponent(selectedPractitionerId)}&date=${encodeURIComponent(selectedDate)}`,
      );
      setSlots(res?.slots ?? []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [slug, selectedBranchId, selectedPractitionerId, selectedDate]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  const handleApplySlug = (e: React.FormEvent) => {
    e.preventDefault();
    if (tenantInput.trim()) {
      setSlug(tenantInput.trim());
      setBookingSuccess(null);
    }
  };

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!selectedSlot) {
      setSubmitError("Please pick a consultation time slot.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setSubmitError("Patient first and last name are required.");
      return;
    }
    if (!dateOfBirth) {
      setSubmitError("Patient date of birth is required.");
      return;
    }
    if (!phone.trim()) {
      setSubmitError("Contact mobile number is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiPost<BookingSuccessResult>("/public/booking/appointments", {
        slug,
        branchId: selectedBranchId,
        practitionerId: selectedPractitionerId,
        startsAt: selectedSlot.startsAt,
        endsAt: selectedSlot.endsAt,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || undefined,
        dateOfBirth,
        gender,
        phone: phone.trim(),
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setBookingSuccess(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.problem.code === "APPOINTMENT_CONFLICT"
            ? "This time slot was just booked by another patient. Please select a different slot."
            : err.problem.detail || err.problem.title
          : "Appointment booking failed. Please check your network connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedDoctor = useMemo(() => {
    return config?.practitioners?.find((p) => p.id === selectedPractitionerId);
  }, [config, selectedPractitionerId]);

  const selectedBranch = useMemo(() => {
    return config?.branches?.find((b) => b.id === selectedBranchId);
  }, [config, selectedBranchId]);

  const patientAge = useMemo(() => calculateAge(dateOfBirth), [dateOfBirth]);

  const morningSlots = useMemo(() => {
    return slots.filter((s) => {
      const hour = new Date(s.startsAt).getUTCHours();
      return hour < 12;
    });
  }, [slots]);

  const afternoonSlots = useMemo(() => {
    return slots.filter((s) => {
      const hour = new Date(s.startsAt).getUTCHours();
      return hour >= 12;
    });
  }, [slots]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", color: "#1e293b", fontFamily: "var(--font-sans, system-ui, sans-serif)" }}>
      {/* Top Navbar */}
      <header className="navbar navbar-expand-lg bg-white border-bottom shadow-sm px-4 py-3 sticky-top">
        <div className="container-xl d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center gap-3">
            <div
              style={{
                width: "42px",
                height: "42px",
                backgroundColor: "#0284c7",
                color: "#ffffff",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.4rem",
                fontWeight: 700,
                boxShadow: "0 2px 6px rgba(2, 132, 199, 0.3)",
              }}
            >
              ⚕
            </div>
            <div>
              <div className="fw-bold fs-5 text-dark lh-sm">
                {config?.clinic?.name || "Clinic Appointment Portal"}
              </div>
              <div className="small text-muted">
                Public Online Scheduling · Outpatient Consultations
              </div>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-success-subtle text-success border border-success-subtle px-3 py-2 d-none d-sm-inline-flex align-items-center gap-1">
              <span className="spinner-grow spinner-grow-sm text-success" style={{ width: "8px", height: "8px" }} role="status" />
              Direct Patient Booking (No Login)
            </span>
            <Link to="/login" className="btn btn-outline-secondary btn-sm px-3">
              Staff Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="container-xl py-4 py-md-5">
        {/* Clinic Identifier Bar */}
        <div className="card shadow-sm border-0 mb-4 p-3 bg-white rounded-3">
          <form onSubmit={handleApplySlug} className="row g-2 align-items-center">
            <div className="col-auto">
              <span className="small text-muted fw-semibold">Clinic Identifier:</span>
            </div>
            <div className="col-auto">
              <div className="input-group input-group-sm" style={{ maxWidth: "260px" }}>
                <input
                  type="text"
                  id="tenant-slug-input"
                  className="form-control"
                  value={tenantInput}
                  onChange={(e) => setTenantInput(e.target.value)}
                  placeholder="e.g. metrocare"
                  required
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Switch Clinic
                </button>
              </div>
            </div>
            <div className="col text-md-end small text-secondary">
              {config?.clinic?.name ? (
                <span>
                  Booking appointments for <strong>{config.clinic.name}</strong> ({config.clinic.slug})
                </span>
              ) : null}
            </div>
          </form>
        </div>

        {/* Loading / Error states */}
        {loadingConfig && (
          <div className="text-center py-5">
            <div className="spinner-border text-primary mb-3" role="status" />
            <p className="text-muted">Loading available doctors and clinic schedule...</p>
          </div>
        )}

        {configError && !loadingConfig && (
          <div className="mb-4">
            <AlertBanner severity="danger" title="Clinic Not Found">
              {configError}
            </AlertBanner>
          </div>
        )}

        {/* Booking Confirmed Receipt Screen */}
        {bookingSuccess && (
          <div className="card border-0 shadow-lg rounded-4 overflow-hidden mb-5">
            <div className="p-4 p-md-5 text-white" style={{ background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)" }}>
              <div className="d-flex align-items-center gap-3 mb-3">
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    backgroundColor: "rgba(255, 255, 255, 0.2)",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "2rem",
                  }}
                >
                  ✓
                </div>
                <div>
                  <h1 className="h3 fw-bold mb-1">Appointment Confirmed!</h1>
                  <p className="mb-0 opacity-90 small">
                    Your appointment has been registered with {config?.clinic?.name || "the clinic"}.
                  </p>
                </div>
              </div>
            </div>

            <div className="card-body p-4 p-md-5">
              <div className="row g-4">
                <div className="col-md-7">
                  <div className="p-3 bg-light rounded-3 mb-4 border">
                    <div className="small text-muted mb-1 text-uppercase fw-semibold tracking-wide">
                      Appointment Reference Code
                    </div>
                    <div className="fs-3 font-monospace fw-bold text-primary">
                      {bookingSuccess.referenceNo}
                    </div>
                    <div className="small text-secondary">
                      Keep this reference code for check-in at the clinic reception.
                    </div>
                  </div>

                  <h2 className="h6 text-uppercase fw-bold text-muted mb-3">Appointment Details</h2>
                  <dl className="row mb-0 small">
                    <dt className="col-sm-4 text-secondary">Doctor:</dt>
                    <dd className="col-sm-8 fw-semibold text-dark">
                      {selectedDoctor?.name || "Attending Physician"} ({selectedDoctor?.specialization || "General Medicine"})
                    </dd>

                    <dt className="col-sm-4 text-secondary">Date & Time:</dt>
                    <dd className="col-sm-8 fw-semibold text-dark">
                      {formatDate(selectedDate)} at {formatTime(bookingSuccess.startsAt)} – {formatTime(bookingSuccess.endsAt)}
                    </dd>

                    <dt className="col-sm-4 text-secondary">Clinic Branch:</dt>
                    <dd className="col-sm-8 fw-semibold text-dark">
                      {selectedBranch?.name || "Main Branch"}
                    </dd>

                    <dt className="col-sm-4 text-secondary">Patient Name:</dt>
                    <dd className="col-sm-8 fw-semibold text-dark">
                      {bookingSuccess.patientName}
                    </dd>

                    <dt className="col-sm-4 text-secondary">Status:</dt>
                    <dd className="col-sm-8">
                      <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">
                        CONFIRMED (ONLINE BOOKING)
                      </span>
                    </dd>
                  </dl>
                </div>

                <div className="col-md-5">
                  <div className="p-4 border rounded-3 bg-white h-100 d-flex flex-column justify-content-between">
                    <div>
                      <h3 className="h6 fw-bold mb-2">📋 Preparation Checklist</h3>
                      <ul className="small text-secondary ps-3 mb-3">
                        <li>Please arrive <strong>10–15 minutes</strong> before your scheduled time.</li>
                        <li>Bring a valid government-issued ID or company ID.</li>
                        <li>Present your Reference Code <strong>{bookingSuccess.referenceNo}</strong> at the reception desk.</li>
                        <li>Bring any existing medical records, prescriptions, or laboratory results.</li>
                      </ul>
                    </div>

                    <div className="d-grid gap-2 pt-3 border-top">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => window.print()}
                      >
                        🖨️ Print Confirmation
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => {
                          setBookingSuccess(null);
                          setSelectedSlot(null);
                        }}
                      >
                        + Book Another Appointment
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Booking Form Interface */}
        {!bookingSuccess && config && (
          <div>
            {/* Hero Header */}
            <div className="mb-4 text-center text-md-start">
              <h1 className="display-6 fw-bold text-dark mb-2">
                Schedule a Doctor's Appointment
              </h1>
              <p className="text-secondary fs-6 mb-0">
                Choose your doctor, pick a date and time slot, and confirm your outpatient appointment instantly.
              </p>
            </div>

            {submitError && (
              <div className="mb-4">
                <AlertBanner severity="danger" title="Booking could not be completed">
                  {submitError}
                </AlertBanner>
              </div>
            )}

            <form onSubmit={handleBook}>
              <div className="row g-4">
                {/* Left Column: Flow Steps */}
                <div className="col-lg-8">
                  {/* Step 1: Doctor & Branch Selection */}
                  <div className="card border-0 shadow-sm rounded-3 mb-4">
                    <div className="card-header bg-white py-3 border-bottom d-flex align-items-center gap-2">
                      <span className="badge bg-primary rounded-pill px-2 py-1">Step 1</span>
                      <h2 className="h6 fw-bold mb-0">Choose Branch & Doctor</h2>
                    </div>
                    <div className="card-body p-4">
                      {/* Branch Selection */}
                      <div className="mb-4">
                        <label htmlFor="select-branch" className="form-label small fw-semibold text-secondary">
                          CLINIC BRANCH LOCATION
                        </label>
                        <select
                          id="select-branch"
                          className="form-select"
                          value={selectedBranchId}
                          onChange={(e) => setSelectedBranchId(e.target.value)}
                        >
                          {config.branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Doctor Selection */}
                      <div>
                        <label className="form-label small fw-semibold text-secondary mb-2">
                          SELECT PRACTITIONER / PHYSICIAN
                        </label>
                        <div className="row g-3">
                          {config.practitioners.map((doc) => {
                            const isSelected = doc.id === selectedPractitionerId;
                            return (
                              <div key={doc.id} className="col-sm-6">
                                <div
                                  role="button"
                                  tabIndex={0}
                                  id={`practitioner-card-${doc.id}`}
                                  className={`p-3 rounded-3 border h-100 transition-all cursor-pointer ${
                                    isSelected
                                      ? "border-primary bg-primary-subtle shadow-sm"
                                      : "border-light-subtle bg-white hover-shadow"
                                  }`}
                                  onClick={() => setSelectedPractitionerId(doc.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      setSelectedPractitionerId(doc.id);
                                    }
                                  }}
                                  style={{ cursor: "pointer", transition: "all 0.15s ease-in-out" }}
                                >
                                  <div className="d-flex align-items-center gap-3">
                                    <div
                                      style={{
                                        width: "44px",
                                        height: "44px",
                                        borderRadius: "50%",
                                        backgroundColor: isSelected ? "#0284c7" : "#e2e8f0",
                                        color: isSelected ? "#ffffff" : "#475569",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "1.2rem",
                                        fontWeight: 600,
                                        flexShrink: 0,
                                      }}
                                    >
                                      👨‍⚕️
                                    </div>
                                    <div className="flex-grow-1 overflow-hidden">
                                      <div className="fw-semibold text-dark text-truncate">
                                        {doc.name}
                                      </div>
                                      <div className="small text-muted text-truncate">
                                        {doc.specialization || "General Medicine"}
                                      </div>
                                      <span className="badge bg-light text-secondary border mt-1" style={{ fontSize: "0.7rem" }}>
                                        {doc.title || "Physician"}
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <span className="text-primary fw-bold fs-5">✓</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Date & Available Slots Selection */}
                  <div className="card border-0 shadow-sm rounded-3 mb-4">
                    <div className="card-header bg-white py-3 border-bottom d-flex align-items-center gap-2">
                      <span className="badge bg-primary rounded-pill px-2 py-1">Step 2</span>
                      <h2 className="h6 fw-bold mb-0">Select Date & Time Slot</h2>
                    </div>
                    <div className="card-body p-4">
                      {/* Date Picker & Quick Actions */}
                      <div className="mb-4">
                        <label htmlFor="appointment-date" className="form-label small fw-semibold text-secondary">
                          CONSULTATION DATE
                        </label>
                        <div className="row g-2 align-items-center mb-2">
                          <div className="col-sm-6">
                            <DateField
                              id="appointment-date"
                              label=""
                              value={selectedDate}
                              onChange={(val) => setSelectedDate(val)}
                            />
                          </div>
                          <div className="col-sm-6 d-flex gap-2">
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
                            >
                              Today
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => setSelectedDate(tomorrow)}
                            >
                              Tomorrow
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 2);
                                setSelectedDate(d.toISOString().slice(0, 10));
                              }}
                            >
                              In 2 days
                            </button>
                          </div>
                        </div>
                        <div className="small text-muted">
                          Selected: <strong>{formatDate(selectedDate)}</strong>
                        </div>
                      </div>

                      {/* Slot Selection */}
                      <div>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <label className="form-label small fw-semibold text-secondary mb-0">
                            AVAILABLE APPOINTMENT SLOTS
                          </label>
                          <span className="small text-muted">
                            {slots.filter((s) => s.available).length} slots open
                          </span>
                        </div>

                        {loadingSlots ? (
                          <div className="p-4 text-center text-muted">
                            <div className="spinner-border spinner-border-sm text-primary me-2" role="status" />
                            Checking doctor schedule...
                          </div>
                        ) : slots.length === 0 ? (
                          <div className="p-4 bg-light rounded-3 text-center text-muted border">
                            <p className="mb-1 fw-semibold">No appointment slots available on this date.</p>
                            <p className="small mb-0">Please choose a different date or select another practitioner.</p>
                          </div>
                        ) : (
                          <div>
                            {/* Morning Slots */}
                            {morningSlots.length > 0 && (
                              <div className="mb-3">
                                <div className="small fw-semibold text-muted text-uppercase mb-2" style={{ fontSize: "0.75rem" }}>
                                  🌅 Morning Slots
                                </div>
                                <div className="d-flex flex-wrap gap-2">
                                  {morningSlots.map((s) => {
                                    const isSelected = selectedSlot?.startsAt === s.startsAt;
                                    return (
                                      <button
                                        key={s.startsAt}
                                        type="button"
                                        id={`slot-btn-${s.startsAt.slice(11, 16)}`}
                                        disabled={!s.available}
                                        className={`btn btn-sm px-3 py-2 ${
                                          isSelected
                                            ? "btn-primary shadow-sm"
                                            : s.available
                                            ? "btn-outline-primary"
                                            : "btn-outline-secondary opacity-50 text-decoration-line-through"
                                        }`}
                                        onClick={() => setSelectedSlot(s)}
                                        title={s.available ? "Click to pick this slot" : "Slot already booked"}
                                      >
                                        {formatTime(s.startsAt)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Afternoon Slots */}
                            {afternoonSlots.length > 0 && (
                              <div>
                                <div className="small fw-semibold text-muted text-uppercase mb-2" style={{ fontSize: "0.75rem" }}>
                                  ☀️ Afternoon Slots
                                </div>
                                <div className="d-flex flex-wrap gap-2">
                                  {afternoonSlots.map((s) => {
                                    const isSelected = selectedSlot?.startsAt === s.startsAt;
                                    return (
                                      <button
                                        key={s.startsAt}
                                        type="button"
                                        id={`slot-btn-${s.startsAt.slice(11, 16)}`}
                                        disabled={!s.available}
                                        className={`btn btn-sm px-3 py-2 ${
                                          isSelected
                                            ? "btn-primary shadow-sm"
                                            : s.available
                                            ? "btn-outline-primary"
                                            : "btn-outline-secondary opacity-50 text-decoration-line-through"
                                        }`}
                                        onClick={() => setSelectedSlot(s)}
                                        title={s.available ? "Click to pick this slot" : "Slot already booked"}
                                      >
                                        {formatTime(s.startsAt)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Step 3: Patient Information Form */}
                  <div className="card border-0 shadow-sm rounded-3 mb-4">
                    <div className="card-header bg-white py-3 border-bottom d-flex align-items-center gap-2">
                      <span className="badge bg-primary rounded-pill px-2 py-1">Step 3</span>
                      <h2 className="h6 fw-bold mb-0">Patient Personal Details</h2>
                    </div>
                    <div className="card-body p-4">
                      <p className="small text-muted mb-3">
                        Your patient information will be securely linked to the clinic's records. No account registration or password required.
                      </p>

                      <div className="row g-3">
                        <div className="col-md-5">
                          <label htmlFor="first-name" className="form-label small fw-semibold">
                            FIRST NAME *
                          </label>
                          <input
                            id="first-name"
                            type="text"
                            className="form-control"
                            placeholder="e.g. Maria Elena"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="col-md-4">
                          <label htmlFor="last-name" className="form-label small fw-semibold">
                            LAST NAME *
                          </label>
                          <input
                            id="last-name"
                            type="text"
                            className="form-control"
                            placeholder="e.g. Santos"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="col-md-3">
                          <label htmlFor="middle-name" className="form-label small fw-semibold">
                            MIDDLE NAME
                          </label>
                          <input
                            id="middle-name"
                            type="text"
                            className="form-control"
                            placeholder="e.g. Cruz"
                            value={middleName}
                            onChange={(e) => setMiddleName(e.target.value)}
                          />
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="date-of-birth" className="form-label small fw-semibold">
                            DATE OF BIRTH * {patientAge !== null && <span className="text-muted fw-normal">({patientAge} yrs old)</span>}
                          </label>
                          <input
                            id="date-of-birth"
                            type="date"
                            className="form-control"
                            value={dateOfBirth}
                            onChange={(e) => setDateOfBirth(e.target.value)}
                            required
                          />
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="gender-select" className="form-label small fw-semibold">
                            SEX / GENDER *
                          </label>
                          <select
                            id="gender-select"
                            className="form-select"
                            value={gender}
                            onChange={(e) => setGender(e.target.value as "M" | "F" | "OTHER")}
                            required
                          >
                            <option value="M">Male</option>
                            <option value="F">Female</option>
                            <option value="OTHER">Other / Non-binary</option>
                          </select>
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="contact-phone" className="form-label small fw-semibold">
                            MOBILE NUMBER *
                          </label>
                          <div className="input-group">
                            <span className="input-group-text bg-light text-muted small">🇵🇭 +63</span>
                            <input
                              id="contact-phone"
                              type="tel"
                              className="form-control"
                              placeholder="0917-123-4567"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              required
                            />
                          </div>
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="contact-email" className="form-label small fw-semibold">
                            EMAIL ADDRESS (FOR RECEIPT)
                          </label>
                          <input
                            id="contact-email"
                            type="email"
                            className="form-control"
                            placeholder="patient@example.ph"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                          />
                        </div>

                        <div className="col-12">
                          <label htmlFor="consultation-notes" className="form-label small fw-semibold">
                            REASON FOR CONSULTATION / CHIEF COMPLAINT (OPTIONAL)
                          </label>
                          <textarea
                            id="consultation-notes"
                            rows={3}
                            className="form-control"
                            placeholder="Briefly describe your symptoms or reason for visiting the doctor (e.g. fever for 3 days, routine follow-up)..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            maxLength={1000}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Live Booking Summary */}
                <div className="col-lg-4">
                  <div className="card border-0 shadow-sm rounded-3 sticky-top" style={{ top: "90px" }}>
                    <div className="card-header bg-white py-3 border-bottom">
                      <h2 className="h6 fw-bold mb-0">Booking Summary</h2>
                    </div>
                    <div className="card-body p-4">
                      {/* Doctor Info */}
                      <div className="d-flex align-items-center gap-3 mb-3 pb-3 border-bottom">
                        <div
                          style={{
                            width: "48px",
                            height: "48px",
                            borderRadius: "50%",
                            backgroundColor: "#e0f2fe",
                            color: "#0369a1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "1.4rem",
                          }}
                        >
                          🩺
                        </div>
                        <div>
                          <div className="fw-semibold text-dark">
                            {selectedDoctor?.name || "Select a Doctor"}
                          </div>
                          <div className="small text-muted">
                            {selectedDoctor?.specialization || "General Medicine"}
                          </div>
                        </div>
                      </div>

                      {/* Location & Time breakdown */}
                      <dl className="small mb-4">
                        <div className="mb-2">
                          <dt className="text-secondary fw-normal">Location:</dt>
                          <dd className="fw-semibold text-dark mb-0">
                            {selectedBranch?.name || "Main Branch"}
                          </dd>
                        </div>

                        <div className="mb-2">
                          <dt className="text-secondary fw-normal">Date:</dt>
                          <dd className="fw-semibold text-dark mb-0">
                            {formatDate(selectedDate)}
                          </dd>
                        </div>

                        <div className="mb-2">
                          <dt className="text-secondary fw-normal">Time Slot:</dt>
                          <dd className="fw-semibold mb-0">
                            {selectedSlot ? (
                              <span className="text-primary">
                                {formatTime(selectedSlot.startsAt)} – {formatTime(selectedSlot.endsAt)}
                              </span>
                            ) : (
                              <span className="text-danger">⚠️ Please select a slot</span>
                            )}
                          </dd>
                        </div>

                        <div className="mb-0">
                          <dt className="text-secondary fw-normal">Patient:</dt>
                          <dd className="fw-semibold text-dark mb-0">
                            {firstName || lastName ? `${firstName} ${lastName}`.trim() : "—"}
                          </dd>
                        </div>
                      </dl>

                      <div className="p-3 bg-light rounded-3 mb-4 small text-secondary">
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <span className="text-success">✓</span>
                          <span>Instant slot reservation</span>
                        </div>
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <span className="text-success">✓</span>
                          <span>No upfront payment required</span>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          <span className="text-success">✓</span>
                          <span>Double-booking prevention active</span>
                        </div>
                      </div>

                      <div className="d-grid">
                        <button
                          type="submit"
                          id="submit-booking-btn"
                          className="btn btn-primary py-2 fw-semibold d-flex align-items-center justify-content-center gap-2"
                          disabled={isSubmitting || !selectedSlot || !firstName.trim() || !lastName.trim() || !phone.trim()}
                        >
                          {isSubmitting ? (
                            <>
                              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                              <span>Securing Appointment...</span>
                            </>
                          ) : (
                            <span>Confirm & Book Appointment</span>
                          )}
                        </button>
                      </div>

                      <div className="text-center mt-3">
                        <Link to="/login" className="small text-decoration-none text-muted">
                          ← Back to Staff Login
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
