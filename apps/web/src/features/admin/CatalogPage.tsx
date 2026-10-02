import React, { useState } from "react";
import { StatusPill } from "@clinic/ui";

interface ServiceItem {
  id: string;
  code: string;
  name: string;
  category: "CONSULTATION" | "PROCEDURE" | "LABORATORY" | "PACKAGE";
  standardPrice: number;
  effectiveFrom: string;
  philhealthCovered: boolean;
}

const SAMPLE_SERVICES: ServiceItem[] = [
  {
    id: "srv-1",
    code: "CONS-GP",
    name: "General Practitioner Outpatient Consultation",
    category: "CONSULTATION",
    standardPrice: 500,
    effectiveFrom: "2026-01-01",
    philhealthCovered: true,
  },
  {
    id: "srv-2",
    code: "CONS-SPEC",
    name: "Specialist Consultation (Internal Medicine / Cardiology)",
    category: "CONSULTATION",
    standardPrice: 850,
    effectiveFrom: "2026-01-01",
    philhealthCovered: false,
  },
  {
    id: "srv-3",
    code: "ECG-12L",
    name: "12-Lead Electrocardiogram with Interpretation",
    category: "PROCEDURE",
    standardPrice: 650,
    effectiveFrom: "2026-01-01",
    philhealthCovered: true,
  },
  {
    id: "srv-4",
    code: "KONSULTA-FOB",
    name: "PhilHealth Konsulta First Outpatient Benefit Package",
    category: "PACKAGE",
    standardPrice: 0,
    effectiveFrom: "2026-01-01",
    philhealthCovered: true,
  },
  {
    id: "srv-5",
    code: "CBC-AUTO",
    name: "Complete Blood Count (CBC) with Platelet Count",
    category: "LABORATORY",
    standardPrice: 320,
    effectiveFrom: "2026-01-01",
    philhealthCovered: true,
  },
];

const DISCOUNT_TYPES = [
  { code: "SC20", name: "Senior Citizen Discount (RA 9994)", rate: "20% + VAT Exemption", requiresId: true },
  { code: "PWD20", name: "Persons with Disability (RA 10754)", rate: "20% + VAT Exemption", requiresId: true },
  { code: "EMP", name: "Clinic Staff & Dependent Benefit", rate: "50% Discount", requiresId: false },
  { code: "INDIGENT", name: "Barangay / Social Service Welfare Indigent", rate: "100% Subsidy", requiresId: true },
];

const PAYMENT_METHODS = [
  { code: "CASH", name: "Cash (Philippine Peso)", type: "DIRECT", active: true },
  { code: "GCASH", name: "GCash QR / Mobile Settlement", type: "E-WALLET", active: true },
  { code: "MAYA", name: "Maya QR / Terminal", type: "E-WALLET", active: true },
  { code: "PHILHEALTH", name: "PhilHealth Konsulta Primary Benefit", type: "INSURANCE", active: true },
  { code: "CARD", name: "Credit / Debit Card (Visa / Mastercard)", type: "POS_TERMINAL", active: true },
];

export function CatalogPage() {
  const [tab, setTab] = useState<"SERVICES" | "DISCOUNTS" | "PAYMENTS">("SERVICES");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Service Catalog & Price Lists</h1>
          <div className="page-subtitle">
            Configure clinical consultation fees, effective-dated prices, PhilHealth packages, and statutory discounts
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4">
        <div className="btn-group">
          <button
            type="button"
            className={`btn ${tab === "SERVICES" ? "btn-cerulean" : "btn-outline-secondary"}`}
            onClick={() => setTab("SERVICES")}
          >
            Clinical Services ({SAMPLE_SERVICES.length})
          </button>
          <button
            type="button"
            className={`btn ${tab === "DISCOUNTS" ? "btn-cerulean" : "btn-outline-secondary"}`}
            onClick={() => setTab("DISCOUNTS")}
          >
            Statutory Discounts ({DISCOUNT_TYPES.length})
          </button>
          <button
            type="button"
            className={`btn ${tab === "PAYMENTS" ? "btn-cerulean" : "btn-outline-secondary"}`}
            onClick={() => setTab("PAYMENTS")}
          >
            Payment Tender Methods ({PAYMENT_METHODS.length})
          </button>
        </div>
      </div>

      {/* Tab 1: Services */}
      {tab === "SERVICES" && (
        <div className="clinic-card">
          <div className="clinic-card-header">
            <span className="fw-bold">Outpatient Services & Pricing</span>
            <span className="small text-muted">Currency: PHP (₱)</span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light small text-secondary">
                <tr>
                  <th>CODE</th>
                  <th>SERVICE NAME</th>
                  <th>CATEGORY</th>
                  <th>STANDARD FEE</th>
                  <th>EFFECTIVE DATE</th>
                  <th>PHILHEALTH KONSULTA</th>
                  <th className="text-end">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_SERVICES.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="badge bg-light text-dark border font-monospace">
                        {s.code}
                      </span>
                    </td>
                    <td>
                      <strong className="text-dark">{s.name}</strong>
                    </td>
                    <td>
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
                        {s.category}
                      </span>
                    </td>
                    <td className="fw-bold text-dark">
                      {s.standardPrice === 0 ? "₱0.00 (Fully Covered)" : `₱${s.standardPrice.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`}
                    </td>
                    <td className="small text-muted">{s.effectiveFrom}</td>
                    <td>
                      {s.philhealthCovered ? (
                        <span className="badge bg-success-subtle text-success border border-success-subtle">
                          ✓ Covered
                        </span>
                      ) : (
                        <span className="badge bg-light text-muted border">Self-Pay</span>
                      )}
                    </td>
                    <td className="text-end">
                      <button type="button" className="btn btn-sm btn-outline-secondary">
                        Edit Rate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Discounts */}
      {tab === "DISCOUNTS" && (
        <div className="clinic-card">
          <div className="clinic-card-header">
            <span className="fw-bold">Statutory & Institutional Discount Rules</span>
            <span className="small text-muted">Philippine Republic Acts</span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light small text-secondary">
                <tr>
                  <th>CODE</th>
                  <th>DISCOUNT POLICY</th>
                  <th>BENEFIT RATE</th>
                  <th>IDENTIFICATION PROOF REQUIRED</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {DISCOUNT_TYPES.map((d) => (
                  <tr key={d.code}>
                    <td><span className="badge bg-light text-dark border font-monospace">{d.code}</span></td>
                    <td><strong className="text-dark">{d.name}</strong></td>
                    <td className="fw-semibold text-primary">{d.rate}</td>
                    <td>
                      {d.requiresId ? (
                        <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                          OSCA / PWD ID Mandated
                        </span>
                      ) : (
                        <span className="badge bg-light text-muted border">None</span>
                      )}
                    </td>
                    <td><StatusPill tone="normal" label="ACTIVE" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Payment Methods */}
      {tab === "PAYMENTS" && (
        <div className="clinic-card">
          <div className="clinic-card-header">
            <span className="fw-bold">Tender Settlement Gateways</span>
            <span className="small text-muted">Point of Sale (POS)</span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light small text-secondary">
                <tr>
                  <th>METHOD CODE</th>
                  <th>TENDER DESCRIPTION</th>
                  <th>PAYMENT CLASSIFICATION</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {PAYMENT_METHODS.map((p) => (
                  <tr key={p.code}>
                    <td><span className="badge bg-light text-dark border font-monospace">{p.code}</span></td>
                    <td><strong className="text-dark">{p.name}</strong></td>
                    <td><span className="badge bg-light text-dark border">{p.type}</span></td>
                    <td><StatusPill tone="normal" label="ENABLED" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
