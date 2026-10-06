import { useState } from "react";

export interface StarterCredentialItem {
  role: string;
  email: string;
  name: string;
  description: string;
}

export interface StarterCredentialsPayload {
  defaultPassword: string;
  loginUrl?: string;
  logins: StarterCredentialItem[];
  formattedText: string;
}

export function getFallbackCredentials(slug: string, name: string): StarterCredentialsPayload {
  const defaultPassword = "DemoPassw0rd!2026";
  const cleanSlug = slug || "tenant";
  const cleanName = name || "New Clinic";

  const logins: StarterCredentialItem[] = [
    {
      role: "Tenant Administrator",
      email: `admintenant@${cleanSlug}.emr`,
      name: `${cleanName} — Tenant Admin`,
      description: "Clinic administration, staff management, settings, master data",
    },
    {
      role: "Doctor",
      email: `doctor@${cleanSlug}.emr`,
      name: `${cleanName} — Doctor`,
      description: "Consultations, medical notes, e-prescriptions, clinical orders",
    },
    {
      role: "Receptionist",
      email: `receptionist@${cleanSlug}.emr`,
      name: `${cleanName} — Receptionist`,
      description: "Patient registration, appointment scheduling, queueing, visits",
    },
    {
      role: "Pharmacist",
      email: `pharmacist@${cleanSlug}.emr`,
      name: `${cleanName} — Pharmacist`,
      description: "Formulary dispensing, medicine inventory, prescription processing",
    },
    {
      role: "Medical Technologist",
      email: `labtech@${cleanSlug}.emr`,
      name: `${cleanName} — Medical Technologist`,
      description: "Laboratory specimen receipt, analyzer entry, test processing",
    },
    {
      role: "Cashier",
      email: `cashier@${cleanSlug}.emr`,
      name: `${cleanName} — Cashier`,
      description: "POS billing, invoice settlement, official receipts, shift balancing",
    },
    {
      role: "Nurse",
      email: `nurse@${cleanSlug}.emr`,
      name: `${cleanName} — Nurse`,
      description: "Triage, vital signs capture, immunization, clinical procedures",
    },
    {
      role: "Pharmacist Verifier",
      email: `verifier@${cleanSlug}.emr`,
      name: `${cleanName} — Pharmacist Verifier`,
      description: "Independent clinical prescription review and verification (PHM-T1)",
    },
    {
      role: "Laboratory Verifier",
      email: `labverify@${cleanSlug}.emr`,
      name: `${cleanName} — Lab Verifier`,
      description: "Independent lab result verification and report release (AC-17)",
    },
    {
      role: "Tenant Admin (Alias)",
      email: `admin@${cleanSlug}.emr`,
      name: `${cleanName} — Tenant Admin`,
      description: "Alternative short login for tenant administration",
    },
    {
      role: "Receptionist (Alias)",
      email: `staff@${cleanSlug}.emr`,
      name: `${cleanName} — Front Desk Staff`,
      description: "Alternative short login for front desk staff",
    },
    {
      role: "Pharmacist (Alias)",
      email: `dispenser@${cleanSlug}.emr`,
      name: `${cleanName} — Pharmacist / Dispenser`,
      description: "Alternative short login for pharmacy dispensary",
    },
  ];

  const loginUrl =
    typeof window !== "undefined" && window.location?.origin
      ? `${window.location.origin}/login`
      : "http://localhost:8085/login";

  const formattedText = [
    "============================================================",
    "CLINIC PLATFORM — NEW TENANT CREDENTIALS",
    "============================================================",
    `Tenant Name:      ${cleanName}`,
    `Tenant Slug:      ${cleanSlug}`,
    `Login URL:        ${loginUrl}`,
    `Default Password: ${defaultPassword}`,
    `(All accounts share common email stub: '@${cleanSlug}.emr')`,
    "",
    "PRIMARY ROLES & LOGINS:",
    "------------------------------------------------------------",
    ...logins.slice(0, 9).map((l) => `• ${l.role.padEnd(24)} ${l.email}`),
    "",
    "COMPATIBILITY ALIASES:",
    "------------------------------------------------------------",
    ...logins.slice(9).map((l) => `• ${l.role.padEnd(24)} ${l.email}`),
    "============================================================",
  ].join("\n");

  return { defaultPassword, loginUrl, logins, formattedText };
}

interface TenantCredentialsCardProps {
  tenantName: string;
  tenantSlug: string;
  credentials?: StarterCredentialsPayload;
  onProceed?: () => void;
  proceedLabel?: string;
}

export function TenantCredentialsCard({
  tenantName,
  tenantSlug,
  credentials,
  onProceed,
  proceedLabel = "Proceed to Tenant Console",
}: TenantCredentialsCardProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  const creds = credentials ?? getFallbackCredentials(tenantSlug, tenantName);
  const displayLoginUrl =
    creds.loginUrl ||
    (typeof window !== "undefined" && window.location?.origin
      ? `${window.location.origin}/login`
      : "http://localhost:8085/login");

  const copyToClipboard = async (text: string, key: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch (e) {
      console.error("Failed to copy to clipboard", e);
    }
  };

  return (
    <div className="card shadow-sm border-0 mb-4">
      <div className="card-header bg-success text-white py-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div>
          <h5 className="mb-0 fw-bold d-flex align-items-center gap-2">
            <span>🔑</span> Tenant Logins & Default Password
          </h5>
          <small className="opacity-90">
            Copy and send these credentials to the clinic administrator for initial access.
          </small>
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-light btn-sm fw-bold px-3 shadow-sm"
            onClick={() => copyToClipboard(creds.formattedText, "all")}
          >
            {copiedKey === "all" ? "✓ Copied All Logins!" : "📋 Copy All Credentials"}
          </button>
        </div>
      </div>

      <div className="card-body p-4">
        {/* Quick summary info boxes */}
        <div className="row g-3 mb-4">
          <div className="col-md-4">
            <div className="p-3 bg-light rounded border h-100">
              <div className="text-muted small fw-semibold text-uppercase mb-1">Common Default Password</div>
              <div className="d-flex align-items-center justify-content-between">
                <code className="fs-6 fw-bold text-dark">{creds.defaultPassword}</code>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm py-0 px-2"
                  onClick={() => copyToClipboard(creds.defaultPassword, "password")}
                  title="Copy password"
                >
                  {copiedKey === "password" ? "✓" : "Copy"}
                </button>
              </div>
              <div className="text-muted small mt-1">Shared by all starter accounts</div>
            </div>
          </div>

          <div className="col-md-4">
            <div className="p-3 bg-light rounded border h-100">
              <div className="text-muted small fw-semibold text-uppercase mb-1">Common Email Stub</div>
              <div className="d-flex align-items-center justify-content-between">
                <code className="fs-6 fw-bold text-primary">@{tenantSlug}.emr</code>
                <span className="badge bg-primary-subtle text-primary border">Domain</span>
              </div>
              <div className="text-muted small mt-1">Common across all login accounts</div>
            </div>
          </div>

          <div className="col-md-4">
            <div className="p-3 bg-light rounded border h-100">
              <div className="text-muted small fw-semibold text-uppercase mb-1">Login URL</div>
              <div className="d-flex align-items-center justify-content-between">
                <code className="fs-6 text-dark text-truncate">{displayLoginUrl}</code>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm py-0 px-2 ms-1"
                  onClick={() => copyToClipboard(displayLoginUrl, "url")}
                  title="Copy login URL"
                >
                  {copiedKey === "url" ? "✓" : "Copy"}
                </button>
              </div>
              <div className="text-muted small mt-1">Direct web entrance portal</div>
            </div>
          </div>
        </div>

        {/* Credentials table */}
        <h6 className="fw-bold mb-2 text-dark">Default Role Logins:</h6>
        <div className="table-responsive border rounded mb-3">
          <table className="table table-hover table-striped align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th style={{ width: "22%" }}>Role</th>
                <th style={{ width: "38%" }}>Login Email (Username)</th>
                <th style={{ width: "25%" }}>Account / Display Name</th>
                <th style={{ width: "15%" }} className="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {creds.logins.map((item, index) => (
                <tr key={item.email}>
                  <td>
                    <span className={`badge ${index < 9 ? "bg-primary" : "bg-secondary"}`}>
                      {item.role}
                    </span>
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <code className="fw-bold text-dark">{item.email}</code>
                    </div>
                  </td>
                  <td>
                    <div className="small fw-semibold">{item.name}</div>
                    <div className="text-muted small" style={{ fontSize: "0.75rem" }}>{item.description}</div>
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary py-0 px-2"
                      onClick={() => copyToClipboard(item.email, item.email)}
                    >
                      {copiedKey === item.email ? "✓ Copied" : "Copy"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Expandable raw text snippet */}
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-none"
              onClick={() => setShowRawText(!showRawText)}
            >
              {showRawText ? "▼ Hide Formatted Text Block" : "► View Formatted Handover Text Block"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm py-0 px-2"
              onClick={() => copyToClipboard(creds.formattedText, "raw")}
            >
              {copiedKey === "raw" ? "✓ Copied Text!" : "Copy Handover Text"}
            </button>
          </div>
          {showRawText && (
            <textarea
              className="form-control font-monospace small bg-dark text-light p-3"
              rows={14}
              readOnly
              value={creds.formattedText}
            />
          )}
        </div>

        {/* Action button */}
        {onProceed && (
          <div className="d-flex justify-content-end pt-2 border-top">
            <button type="button" className="btn btn-cerulean px-4 fw-bold" onClick={onProceed}>
              {proceedLabel} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
