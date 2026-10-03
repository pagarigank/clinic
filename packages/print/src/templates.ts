/**
 * HTML templates for the platform's PDF documents (todo.md 3.2 print pipeline).
 *
 * These return a complete, self-contained HTML string. `renderPdf` feeds it to
 * Chromium with `setContent`, so there is no template engine, no bundler, and
 * no network fetch: a document rendered today renders identically in a year,
 * which is what makes the SHA-256 meaningful.
 *
 * All patient-identifying content is passed in by the caller. These functions
 * never query the database, which keeps PHI handling in the service layer
 * where the tenant transaction and audit log already live.
 */

/** Inline CSS shared by every template. Sized for A4 at 96dpi. */
const BASE_CSS = `
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    font-size: 11pt; color: #111; margin: 0; line-height: 1.45;
  }
  h1 { font-size: 15pt; margin: 0 0 2mm; letter-spacing: 0.4pt; text-transform: uppercase; }
  h2 { font-size: 12pt; margin: 6mm 0 2mm; }
  .clinic { font-size: 13pt; font-weight: 700; margin: 0 0 1mm; }
  .muted { color: #555; font-size: 9pt; }
  .doc-no { font-family: Consolas, "Courier New", monospace; font-size: 10pt; font-weight: 700; }
  header { border-bottom: 1.5pt solid #111; padding-bottom: 3mm; margin-bottom: 4mm; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1mm 6mm; }
  .field { margin-bottom: 1.5mm; }
  .field .k { color: #555; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3pt; }
  .field .v { font-size: 10.5pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
  th, td { border-bottom: 0.5pt solid #bbb; padding: 1.6mm 2mm; text-align: left; font-size: 9.5pt; }
  th { background: #f0f0f0; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 4mm; margin-left: auto; width: 70mm; }
  .totals div { display: flex; justify-content: space-between; padding: 1.2mm 0; font-size: 10pt; }
  .totals .grand { border-top: 1pt solid #111; margin-top: 1.5mm; padding-top: 2mm; font-weight: 700; font-size: 12pt; }
  .sig { margin-top: 12mm; }
  .sig-line { border-top: 0.5pt solid #111; width: 70mm; margin-top: 12mm; padding-top: 1.5mm; font-size: 9pt; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 8pt; color: #555;
           border-top: 0.5pt solid #ccc; padding-top: 1.5mm; }
`.trim();

/** Escape text for interpolation into HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Money is formatted to two decimals, thousands-separated. */
function money(amount: number | string): string {
  const n = typeof amount === "number" ? amount : Number.parseFloat(String(amount));
  return Number.isFinite(n)
    ? n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function shell(title: string, body: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${BASE_CSS}</style>`,
    `</head><body>${body}</body></html>`,
  ].join("");
}

function field(key: string, value: unknown): string {
  return `<div class="field"><div class="k">${escapeHtml(key)}</div><div class="v">${escapeHtml(value)}</div></div>`;
}

export interface MedicalCertificate {
  clinicName: string;
  clinicAddress?: string;
  certificateNo: string;
  issuedAt: string;
  patientName: string;
  patientAge?: string;
  patientSex?: string;
  /** The clinical reason, as recorded by the clinician. */
  diagnosis?: string;
  /** Free-text body of the certificate. */
  body: string;
  /** Days the patient is unfit for work, when it is a fit-to-work note. */
  unfitForDays?: number;
  clinicianName: string;
  clinicianLicenseNo?: string;
  /** True when a clinician signature image has been embedded by the caller. */
  signedElectronically?: boolean;
}

/**
 * Medical certificate / fit-to-work note.
 *
 * A certificate is a legal document: it is numbered, states the issuing
 * clinician's licence, and is never amended in place - a corrected
 * certificate is a new document with its own number.
 */
export function renderCertificateHtml(doc: MedicalCertificate): string {
  const body = [
    "<header>",
    `<div class="clinic">${escapeHtml(doc.clinicName)}</div>`,
    doc.clinicAddress ? `<div class="muted">${escapeHtml(doc.clinicAddress)}</div>` : "",
    `<div class="doc-no">Certificate No. ${escapeHtml(doc.certificateNo)}</div>`,
    "</header>",
    '<div class="grid">',
    field("Patient", doc.patientName),
    field("Date issued", doc.issuedAt),
    doc.patientAge ? field("Age", doc.patientAge) : "",
    doc.patientSex ? field("Sex", doc.patientSex) : "",
    "</div>",
    doc.diagnosis
      ? `<h2>Diagnosis</h2><div>${escapeHtml(doc.diagnosis)}</div>`
      : "",
    "<h2>Certificate</h2>",
    `<div style="white-space: pre-wrap">${escapeHtml(doc.body)}</div>`,
    typeof doc.unfitForDays === "number"
      ? `<p><strong>This patient is unfit for work for ${doc.unfitForDays} day(s) from the date of issue.</strong></p>`
      : "",
    '<div class="sig">',
    `<div class="sig-line">${escapeHtml(doc.clinicianName)}${
      doc.clinicianLicenseNo ? ` &middot; Lic. No. ${escapeHtml(doc.clinicianLicenseNo)}` : ""
    }</div>`,
    doc.signedElectronically
      ? '<div class="muted">Electronically signed. Signature authenticity is evidenced by the document SHA-256 recorded on issue.</div>'
      : "",
    "</div>",
    `<footer>${escapeHtml(doc.clinicName)} &middot; Certificate ${escapeHtml(
      doc.certificateNo,
    )} &middot; This document is void if altered.</footer>`,
  ]
    .filter(Boolean)
    .join("");

  return shell(`Certificate ${doc.certificateNo}`, body);
}

export interface LabReport {
  clinicName: string;
  reportNo: string;
  orderNo: string;
  version: number;
  status: "PRELIMINARY" | "RELEASED" | "CORRECTED";
  patientName: string;
  patientAge?: string;
  patientSex?: string;
  collectedAt?: string;
  receivedAt?: string;
  releasedAt?: string;
  orderingClinician?: string;
  verifiedBy?: string;
  /** Present on an amendment; states why the earlier version was replaced. */
  amendmentReason?: string;
  results: Array<{
    test: string;
    analyte: string;
    value: string;
    unit?: string;
    referenceRange?: string;
    flag?: "H" | "L" | "HH" | "LL" | "CRITICAL" | null;
    method?: string;
  }>;
  interpretation?: string;
  /** Shown when the test requires explicit authorisation to view. */
  confidentialityNotice?: string;
}

/** Map an abnormal flag to the bold marker printed beside the value. */
function flagMark(flag: string | null | undefined): string {
  switch (flag) {
    case "HH":
    case "LL":
    case "CRITICAL":
      return " <strong>&#9679;</strong>";
    case "H":
      return " <strong>H</strong>";
    case "L":
      return " <strong>L</strong>";
    default:
      return "";
  }
}

/**
 * Laboratory result report.
 *
 * `version` and `status` are printed prominently: a corrected report must be
 * distinguishable from the original at a glance, and the history is retained
 * server-side so the prior version stays retrievable.
 */
export function renderLabReportHtml(doc: LabReport): string {
  const rows = doc.results
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.test)}</td>
        <td>${escapeHtml(r.analyte)}</td>
        <td class="num">${escapeHtml(r.value)}${flagMark(r.flag)}</td>
        <td>${escapeHtml(r.unit ?? "")}</td>
        <td>${escapeHtml(r.referenceRange ?? "")}</td>
      </tr>`,
    )
    .join("");

  const body = [
    "<header>",
    `<div class="clinic">${escapeHtml(doc.clinicName)}</div>`,
    `<div class="doc-no">Report ${escapeHtml(doc.reportNo)} &middot; Version ${doc.version}</div>`,
    `</header>`,
    `<p><strong>Status: ${escapeHtml(doc.status)}</strong>${
      doc.status === "CORRECTED" ? " &mdash; this version supersedes all earlier versions" : ""
    }</p>`,
    doc.amendmentReason
      ? `<p><strong>Reason for amendment:</strong> ${escapeHtml(doc.amendmentReason)}</p>`
      : "",
    '<div class="grid">',
    field("Patient", doc.patientName),
    field("Order", doc.orderNo),
    doc.patientAge ? field("Age", doc.patientAge) : "",
    doc.patientSex ? field("Sex", doc.patientSex) : "",
    doc.collectedAt ? field("Collected", doc.collectedAt) : "",
    doc.receivedAt ? field("Received", doc.receivedAt) : "",
    doc.releasedAt ? field("Released", doc.releasedAt) : "",
    doc.orderingClinician ? field("Ordering clinician", doc.orderingClinician) : "",
    "</div>",
    doc.confidentialityNotice
      ? `<p style="border:1pt solid #111;padding:2mm"><strong>CONFIDENTIAL.</strong> ${escapeHtml(
          doc.confidentialityNotice,
        )}</p>`
      : "",
    "<h2>Results</h2>",
    "<table><thead><tr><th>Test</th><th>Analyte</th><th class='num'>Value</th><th>Unit</th><th>Reference</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
    doc.interpretation ? `<h2>Interpretation</h2><div>${escapeHtml(doc.interpretation)}</div>` : "",
    doc.verifiedBy
      ? `<div class="sig"><div class="sig-line">${escapeHtml(
          doc.verifiedBy,
        )} &middot; Verified</div></div>`
      : "",
    `<footer>${escapeHtml(doc.clinicName)} &middot; Report ${escapeHtml(doc.reportNo)} v${doc.version}`,
    doc.status === "RELEASED" || doc.status === "CORRECTED"
      ? " &middot; Electronically verified; integrity evidenced by the recorded SHA-256"
      : " &middot; NOT FOR CLINICAL USE",
    "</footer>",
  ]
    .filter(Boolean)
    .join("");

  return shell(`Lab report ${doc.reportNo}`, body);
}

export interface ReceiptDocument {
  clinicName: string;
  clinicAddress?: string;
  receiptNo: string;
  /** Present on a reprint; the underlying payment is unchanged. */
  reprintedFrom?: string;
  issuedAt: string;
  cashierName: string;
  patientName?: string;
  lines: Array<{ description: string; qty: number; unitPrice: number; total: number }>;
  subtotal: number;
  discount?: { label: string; amount: number; /** Required when a discount needs ID capture. */
    idCaptured?: boolean } | null;
  total: number;
  amountTendered?: number;
  changeGiven?: number;
  /** Payer as selected for the encounter (private cash, HMO, PhilHealth, corporate). */
  payer?: string;
  footer?: string;
}

/**
 * Official receipt.
 *
 * Q-17: the patient-facing receipt shows the professional fee and deductible
 * items only. Internal fields - practitioner revenue-share rates, PF
 * percentages - are never passed into this template and so cannot print, and
 * the template deliberately has no field that could carry them.
 */
export function renderReceiptHtml(doc: ReceiptDocument): string {
  const rows = doc.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.description)}</td>
        <td class="num">${escapeHtml(l.qty)}</td>
        <td class="num">${money(l.unitPrice)}</td>
        <td class="num">${money(l.total)}</td>
      </tr>`,
    )
    .join("");

  const body = [
    "<header>",
    `<div class="clinic">${escapeHtml(doc.clinicName)}</div>`,
    doc.clinicAddress ? `<div class="muted">${escapeHtml(doc.clinicAddress)}</div>` : "",
    `<div class="doc-no">Official Receipt ${escapeHtml(doc.receiptNo)}</div>`,
    "</header>",
    doc.reprintedFrom
      ? `<p style="border:1pt solid #111;padding:2mm"><strong>REPRINT</strong> of receipt ${escapeHtml(
          doc.reprintedFrom,
        )}. This is a duplicate for record-keeping; the original remains valid.</p>`
      : "",
    '<div class="grid">',
    field("Issued", doc.issuedAt),
    field("Cashier", doc.cashierName),
    doc.patientName ? field("Patient", doc.patientName) : "",
    doc.payer ? field("Payer", doc.payer) : "",
    "</div>",
    "<table><thead><tr><th>Item</th><th class='num'>Qty</th><th class='num'>Price</th><th class='num'>Amount</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
    '<div class="totals">',
    `<div><span>Subtotal</span><span>${money(doc.subtotal)}</span></div>`,
    doc.discount && doc.discount.amount
      ? `<div><span>${escapeHtml(doc.discount.label)}${
          doc.discount.idCaptured ? " (ID captured)" : ""
        }</span><span>-${money(doc.discount.amount)}</span></div>`
      : "",
    `<div class="grand"><span>Total</span><span>${money(doc.total)}</span></div>`,
    doc.amountTendered !== undefined
      ? `<div><span>Cash tendered</span><span>${money(doc.amountTendered)}</span></div>`
      : "",
    doc.changeGiven !== undefined
      ? `<div><span>Change</span><span>${money(doc.changeGiven)}</span></div>`
      : "",
    "</div>",
    doc.footer ? `<p class="muted" style="margin-top:5mm">${escapeHtml(doc.footer)}</p>` : "",
    `<footer>${escapeHtml(doc.clinicName)} &middot; Receipt ${escapeHtml(
      doc.receiptNo,
    )} &middot; Total ${money(doc.total)}</footer>`,
  ]
    .filter(Boolean)
    .join("");

  return shell(`Receipt ${doc.receiptNo}`, body);
}

export interface PrescriptionItemDocument {
  genericName: string;
  brandName?: string;
  strength?: string;
  dosageForm?: string;
  route?: string;
  frequency?: string;
  duration?: string;
  quantity: string | number;
  sig?: string;
  indication?: string;
  isControlled?: boolean;
}

export interface PrescriptionDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  dohAccreditationNo?: string;

  rxNo: string;
  issuedAt: string;

  patientName: string;
  patientAge?: string | number;
  patientSex?: string;
  patientDob?: string;
  patientAddress?: string;
  patientMrn?: string;
  allergies?: Array<{ substance: string; severity?: string }>;
  weightKg?: string | number;

  prescriberName: string;
  prescriberTitle?: string;
  specialty?: string;
  prcLicenseNo?: string;
  ptrNo?: string;
  s2LicenseNo?: string;

  specialInstruction?: string;
  items: PrescriptionItemDocument[];

  s2SerialNo?: string;
  s2QuantityInWords?: string;
  verificationHash?: string;
}

/**
 * Official Medical Prescription (Rx Pad) Template
 * Compliant with Philippine Generics Act of 1988 (RA 6675) & Dangerous Drugs Act (RA 9165).
 */
export function renderPrescriptionHtml(doc: PrescriptionDocument): string {
  const hasControlled = doc.items.some((i) => i.isControlled) || Boolean(doc.s2SerialNo);
  const allergyList = doc.allergies && doc.allergies.length > 0
    ? doc.allergies.map((a) => `${escapeHtml(a.substance)}${a.severity ? ` (${escapeHtml(a.severity)})` : ''}`).join(', ')
    : null;

  const itemRows = doc.items.map((item, index) => {
    const sigText = item.sig || [item.route, item.frequency, item.duration ? `for ${item.duration}` : ''].filter(Boolean).join(' ');
    return `
      <div style="margin-bottom: 5mm; padding-bottom: 4mm; border-bottom: 0.5pt dashed #cbd5e1;">
        <table style="width: 100%; border: none; margin: 0;">
          <tr>
            <td style="border: none; padding: 0; vertical-align: top; width: 24px;">
              <span style="display: inline-block; background: #e0f2fe; color: #0369a1; font-weight: 700; font-size: 8.5pt; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%;">${index + 1}</span>
            </td>
            <td style="border: none; padding: 0; vertical-align: top;">
              <div style="font-size: 11pt; font-weight: 800; color: #0f172a; letter-spacing: 0.3pt; text-transform: uppercase;">
                ${escapeHtml(item.genericName.toUpperCase())}
                ${item.brandName ? `<span style="font-weight: 600; text-transform: none; color: #475569; font-size: 9.5pt;"> (${escapeHtml(item.brandName)})</span>` : ''}
              </div>
              <div style="font-size: 9.5pt; color: #334155; margin-top: 1mm;">
                ${[item.strength, item.dosageForm].filter(Boolean).map(escapeHtml).join(' &middot; ')}
              </div>
              <div style="font-size: 10pt; color: #1e293b; margin-top: 2mm; background: #f8fafc; padding: 1.5mm 3mm; border-left: 2pt solid #0284c7; border-radius: 2px;">
                <strong>Sig:</strong> ${escapeHtml(sigText || 'As directed by physician')}
              </div>
              ${item.indication ? `<div style="font-size: 8.5pt; color: #64748b; margin-top: 1mm;"><em>Indication: ${escapeHtml(item.indication)}</em></div>` : ''}
            </td>
            <td style="border: none; padding: 0; vertical-align: top; text-align: right; width: 85px;">
              <span style="font-size: 12pt; font-weight: 800; color: #0f172a;"># ${escapeHtml(item.quantity)}</span>
            </td>
          </tr>
        </table>
      </div>
    `;
  }).join('');

  const body = `
    <!-- Letterhead -->
    <header style="border-bottom: 2pt solid #0284c7; padding-bottom: 3mm; margin-bottom: 4mm;">
      <table style="width: 100%; border: none; margin: 0;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: top;">
            <div style="font-size: 15pt; font-weight: 800; color: #0f2942; letter-spacing: -0.3pt;">
              ${escapeHtml(doc.clinicName)}
            </div>
            ${doc.branchName ? `<div style="font-size: 9pt; font-weight: 600; color: #0284c7; text-transform: uppercase; letter-spacing: 0.5pt;">${escapeHtml(doc.branchName)}</div>` : ''}
            <div style="font-size: 8.5pt; color: #64748b; margin-top: 1mm;">
              ${[doc.clinicAddress, doc.clinicPhone, doc.clinicEmail].filter(Boolean).map(escapeHtml).join(' &middot; ')}
            </div>
            ${doc.dohAccreditationNo ? `<div style="font-size: 8pt; color: #94a3b8;">DOH Accreditation / LTO No. ${escapeHtml(doc.dohAccreditationNo)}</div>` : ''}
          </td>
          <td style="border: none; padding: 0; vertical-align: top; text-align: right; width: 140px;">
            <div style="display: inline-block; background: #0f2942; color: #fff; font-size: 9pt; font-weight: 700; padding: 1.5mm 3.5mm; border-radius: 4px; letter-spacing: 0.5pt;">
              PRESCRIPTION (RX)
            </div>
            <div style="font-family: Consolas, monospace; font-size: 9.5pt; font-weight: 700; color: #0f172a; margin-top: 2mm;">
              Rx No. ${escapeHtml(doc.rxNo)}
            </div>
            <div style="font-size: 8.5pt; color: #64748b;">
              Date: ${escapeHtml(doc.issuedAt)}
            </div>
          </td>
        </tr>
      </table>
    </header>

    <!-- Physician Header -->
    <div style="margin-bottom: 3.5mm; padding-bottom: 2mm; border-bottom: 0.5pt solid #e2e8f0;">
      <div style="font-size: 11pt; font-weight: 700; color: #0f172a;">
        ${escapeHtml(doc.prescriberName)}
        ${doc.prescriberTitle ? `<span style="font-weight: 400; color: #64748b; font-size: 9.5pt;"> &middot; ${escapeHtml(doc.prescriberTitle)}</span>` : ''}
      </div>
      <div style="font-size: 8.5pt; color: #475569; margin-top: 0.5mm;">
        ${doc.specialty ? `<span style="font-weight: 600; color: #0369a1;">${escapeHtml(doc.specialty)}</span> &middot; ` : ''}
        PRC Lic. No. <strong>${escapeHtml(doc.prcLicenseNo || 'N/A')}</strong>
        ${doc.ptrNo ? ` &middot; PTR No. <strong>${escapeHtml(doc.ptrNo)}</strong>` : ''}
        ${doc.s2LicenseNo ? ` &middot; S2 Lic. No. <strong>${escapeHtml(doc.s2LicenseNo)}</strong>` : ''}
      </div>
    </div>

    <!-- Patient Demographics Band -->
    <div style="background: #f8fafc; border: 1pt solid #cbd5e1; border-radius: 4px; padding: 2.5mm 3.5mm; margin-bottom: 3.5mm;">
      <table style="width: 100%; border: none; margin: 0;">
        <tr>
          <td style="border: none; padding: 0.8mm 2mm 0.8mm 0; font-size: 9pt; width: 50%;">
            <span style="color: #64748b; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.3pt;">Patient Name:</span>
            <div style="font-size: 10.5pt; font-weight: 700; color: #0f172a;">${escapeHtml(doc.patientName)}</div>
          </td>
          <td style="border: none; padding: 0.8mm 2mm; font-size: 9pt; width: 25%;">
            <span style="color: #64748b; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.3pt;">Age / Sex:</span>
            <div style="font-size: 10pt; color: #1e293b;">${escapeHtml(doc.patientAge ? `${doc.patientAge} yo` : 'N/A')} / ${escapeHtml(doc.patientSex || 'N/A')}</div>
          </td>
          <td style="border: none; padding: 0.8mm 0; font-size: 9pt; width: 25%; text-align: right;">
            <span style="color: #64748b; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.3pt;">DOB / MRN:</span>
            <div style="font-size: 9.5pt; color: #1e293b;">${escapeHtml(doc.patientDob || 'N/A')}${doc.patientMrn ? ` &middot; ${escapeHtml(doc.patientMrn)}` : ''}</div>
          </td>
        </tr>
        ${doc.patientAddress ? `
        <tr>
          <td colspan="3" style="border: none; padding: 0.8mm 0 0; font-size: 8.5pt; color: #475569;">
            <span style="color: #64748b; text-transform: uppercase; font-size: 8pt;">Address:</span> ${escapeHtml(doc.patientAddress)}
          </td>
        </tr>` : ''}
      </table>
    </div>

    <!-- Allergy Strip -->
    ${allergyList ? `
      <div style="background: #fff1f2; border: 1pt solid #f43f5e; color: #9f1239; border-radius: 4px; padding: 1.8mm 3mm; margin-bottom: 4mm; font-size: 8.5pt;">
        <strong>⚠️ DRUG ALLERGY WARNING:</strong> Patient has recorded allergic reaction to: <strong>${allergyList}</strong>.
      </div>
    ` : `
      <div style="background: #f0fdf4; border: 1pt solid #86efac; color: #166534; border-radius: 4px; padding: 1.2mm 3mm; margin-bottom: 4mm; font-size: 8pt;">
        ✓ <strong>No Known Drug Allergies (NKDA)</strong> recorded on chart.
      </div>
    `}

    <!-- Rx Insignia -->
    <div style="font-size: 30pt; font-family: 'Times New Roman', Georgia, serif; font-weight: bold; color: #1e3a8a; line-height: 1; margin: 1mm 0 3mm;">
      ℞
    </div>

    <!-- Medication Items -->
    <div style="min-height: 48mm;">
      ${itemRows}
    </div>

    <!-- S2 Controlled Drug Warning (Dangerous Drugs Act RA 9165) -->
    ${hasControlled ? `
      <div style="margin: 4mm 0; border: 1.5pt solid #f59e0b; background: #fffbeb; border-radius: 4px; padding: 2.5mm 3.5mm;">
        <div style="font-size: 8.5pt; font-weight: 800; color: #b45309; text-transform: uppercase; letter-spacing: 0.4pt;">
          ⚠️ DANGEROUS DRUGS BOARD / PDEA CONTROLLED SUBSTANCE PRESCRIPTION (RA 9165)
        </div>
        <div style="font-size: 8.5pt; color: #78350f; margin-top: 1mm;">
          S2 Lic. No: <strong>${escapeHtml(doc.s2LicenseNo || 'REQUIRED')}</strong> &middot;
          Special Rx Serial No: <strong>${escapeHtml(doc.s2SerialNo || doc.rxNo)}</strong>
          ${doc.s2QuantityInWords ? `<br>Quantity in words: <strong>${escapeHtml(doc.s2QuantityInWords)}</strong>` : ''}
          <div style="font-size: 7.5pt; color: #92400e; margin-top: 1mm;">
            Valid strictly for thirty (30) days from issuance. Retention of original copy by dispensing pharmacy is required by law.
          </div>
        </div>
      </div>
    ` : ''}

    <!-- Physician's Care Instructions & Advice -->
    ${doc.specialInstruction ? `
      <div style="background: #f1f5f9; border-left: 3pt solid #475569; padding: 2mm 3.5mm; border-radius: 2px; margin-top: 3mm; font-size: 9pt; color: #334155;">
        <strong>Physician's Instructions:</strong> ${escapeHtml(doc.specialInstruction)}
      </div>
    ` : ''}

    <!-- Signature Block -->
    <div style="margin-top: 8mm;">
      <table style="width: 100%; border: none;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: bottom; width: 55%;">
            <div style="font-size: 7.5pt; color: #64748b; line-height: 1.35;">
              <strong>LEGAL COMPLIANCE:</strong> Issued under the Philippine Generics Act of 1988 (RA 6675).<br>
              Pharmacist: In case of doubtful dosage or generic substitution inquiries, please contact the prescriber.<br>
              ${doc.verificationHash ? `<span style="font-family: Consolas, monospace; font-size: 7pt; color: #94a3b8;">SHA-256 Digest: ${escapeHtml(doc.verificationHash.slice(0, 32))}...</span>` : ''}
            </div>
          </td>
          <td style="border: none; padding: 0; vertical-align: bottom; text-align: right; width: 45%;">
            <div style="display: inline-block; text-align: center; width: 68mm;">
              <div style="border-top: 1pt solid #0f172a; margin-top: 12mm; padding-top: 1.5mm;">
                <div style="font-size: 10.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase;">
                  ${escapeHtml(doc.prescriberName)}
                </div>
                <div style="font-size: 8.5pt; color: #475569;">
                  PRC Lic. No. <strong>${escapeHtml(doc.prcLicenseNo || 'N/A')}</strong>
                  ${doc.ptrNo ? ` &middot; PTR No. <strong>${escapeHtml(doc.ptrNo)}</strong>` : ''}
                </div>
                ${doc.s2LicenseNo ? `<div style="font-size: 8pt; color: #b45309;">S2 Lic. No. <strong>${escapeHtml(doc.s2LicenseNo)}</strong></div>` : ''}
              </div>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Official Document Footer -->
    <footer style="margin-top: 6mm; border-top: 0.5pt solid #cbd5e1; padding-top: 1.5mm; font-size: 7.5pt; color: #64748b; display: flex; justify-content: space-between;">
      <span>${escapeHtml(doc.clinicName)} &middot; Prescription ${escapeHtml(doc.rxNo)}</span>
      <span>Electronic Medical Record &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell(`Prescription ${doc.rxNo}`, body);
}

export interface LabRequisitionItem {
  testCode: string;
  testName: string;
  category?: string;
  specimenType?: string;
  collectionTube?: string;
  fastingRequired?: boolean;
  fastingHours?: number;
  instructions?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'STAT';
  clinicalIndication?: string;
}

export interface LabRequisitionDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  dohLtoNo?: string;

  orderNo: string;
  issuedAt: string;
  priority: 'ROUTINE' | 'URGENT' | 'STAT';

  patientName: string;
  patientAge?: string | number;
  patientSex?: string;
  patientDob?: string;
  patientMrn?: string;

  clinicalImpression?: string;
  orderingPhysician: string;
  physicianPrcNo?: string;

  tests: LabRequisitionItem[];
  patientPrepNotes?: string;
  verificationHash?: string;
}

/**
 * Official Laboratory Diagnostic Examination Requisition Slip
 */
export function renderLabRequisitionHtml(doc: LabRequisitionDocument): string {
  const priorityColor = doc.priority === 'STAT' ? '#dc2626' : doc.priority === 'URGENT' ? '#ea580c' : '#0284c7';
  const priorityBg = doc.priority === 'STAT' ? '#fee2e2' : doc.priority === 'URGENT' ? '#ffedd5' : '#e0f2fe';

  const rows = doc.tests.map((test, index) => {
    return `
      <tr>
        <td style="width: 25px; text-align: center; font-weight: 700; color: #64748b;">${index + 1}</td>
        <td>
          <div style="font-weight: 700; color: #0f172a; font-size: 10pt;">${escapeHtml(test.testName)}</div>
          <div style="font-size: 8.5pt; color: #64748b; font-family: Consolas, monospace;">Code: ${escapeHtml(test.testCode)}</div>
          ${test.clinicalIndication ? `<div style="font-size: 8pt; color: #475569; margin-top: 0.5mm;"><em>Indication: ${escapeHtml(test.clinicalIndication)}</em></div>` : ''}
        </td>
        <td>
          <div style="font-weight: 600; color: #334155; font-size: 9pt;">${escapeHtml(test.specimenType || 'Specimen as required')}</div>
          ${test.collectionTube ? `<div style="font-size: 8pt; color: #0284c7;">Tube: ${escapeHtml(test.collectionTube)}</div>` : ''}
        </td>
        <td style="font-size: 8.5pt; color: ${test.fastingRequired ? '#b45309' : '#475569'};">
          ${test.fastingRequired ? `<strong>Fasting Required:</strong> ${test.fastingHours ? `${test.fastingHours} hrs` : 'Overnight'}` : 'No fasting required'}
          ${test.instructions ? `<div style="font-size: 7.5pt; color: #64748b;">${escapeHtml(test.instructions)}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  const body = `
    <!-- Letterhead -->
    <header style="border-bottom: 2pt solid #0284c7; padding-bottom: 3mm; margin-bottom: 4mm;">
      <table style="width: 100%; border: none; margin: 0;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: top;">
            <div style="font-size: 15pt; font-weight: 800; color: #0f2942;">
              ${escapeHtml(doc.clinicName)}
            </div>
            <div style="font-size: 9pt; font-weight: 600; color: #0284c7; text-transform: uppercase;">
              DEPARTMENT OF PATHOLOGY & CLINICAL LABORATORY SERVICES
            </div>
            <div style="font-size: 8.5pt; color: #64748b; margin-top: 1mm;">
              ${[doc.clinicAddress, doc.clinicPhone].filter(Boolean).map(escapeHtml).join(' &middot; ')}
            </div>
            ${doc.dohLtoNo ? `<div style="font-size: 8pt; color: #94a3b8;">DOH Clinical Lab LTO No. ${escapeHtml(doc.dohLtoNo)} &middot; Tertiary Category</div>` : ''}
          </td>
          <td style="border: none; padding: 0; vertical-align: top; text-align: right; width: 150px;">
            <div style="display: inline-block; background: ${priorityBg}; color: ${priorityColor}; border: 1pt solid ${priorityColor}; font-size: 9pt; font-weight: 800; padding: 1.5mm 3.5mm; border-radius: 4px; letter-spacing: 0.5pt;">
              ${doc.priority === 'STAT' ? '⚡ STAT / IMMEDIATE' : doc.priority === 'URGENT' ? 'URGENT' : 'ROUTINE'}
            </div>
            <div style="font-family: Consolas, monospace; font-size: 9.5pt; font-weight: 700; color: #0f172a; margin-top: 2mm;">
              Requisition #${escapeHtml(doc.orderNo)}
            </div>
            <div style="font-size: 8.5pt; color: #64748b;">
              Date: ${escapeHtml(doc.issuedAt)}
            </div>
          </td>
        </tr>
      </table>
    </header>

    <!-- Patient Details -->
    <div style="background: #f8fafc; border: 1pt solid #cbd5e1; border-radius: 4px; padding: 2.5mm 3.5mm; margin-bottom: 3.5mm;">
      <table style="width: 100%; border: none; margin: 0;">
        <tr>
          <td style="border: none; padding: 0.8mm 2mm 0.8mm 0; font-size: 9pt; width: 45%;">
            <span style="color: #64748b; text-transform: uppercase; font-size: 8pt;">Patient:</span>
            <div style="font-size: 10.5pt; font-weight: 700; color: #0f172a;">${escapeHtml(doc.patientName)}</div>
          </td>
          <td style="border: none; padding: 0.8mm 2mm; font-size: 9pt; width: 25%;">
            <span style="color: #64748b; text-transform: uppercase; font-size: 8pt;">Age / Sex:</span>
            <div style="font-size: 10pt; color: #1e293b;">${escapeHtml(doc.patientAge ? `${doc.patientAge} yo` : 'N/A')} / ${escapeHtml(doc.patientSex || 'N/A')}</div>
          </td>
          <td style="border: none; padding: 0.8mm 0; font-size: 9pt; width: 30%; text-align: right;">
            <span style="color: #64748b; text-transform: uppercase; font-size: 8pt;">MRN / DOB:</span>
            <div style="font-size: 9.5pt; color: #1e293b;">${escapeHtml(doc.patientMrn || 'N/A')} &middot; ${escapeHtml(doc.patientDob || 'N/A')}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Clinical Impression / Medical Justification -->
    <div style="margin-bottom: 4mm; padding: 2mm 3.5mm; border-left: 3pt solid #0284c7; background: #f0f9ff; border-radius: 2px;">
      <span style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #0369a1; letter-spacing: 0.4pt;">Clinical Impression / ICD-10 Diagnosis:</span>
      <div style="font-size: 10pt; font-weight: 600; color: #0c4a6e; margin-top: 0.5mm;">
        ${escapeHtml(doc.clinicalImpression || 'Diagnostic evaluation and clinical monitoring')}
      </div>
    </div>

    <!-- Requisition Items Table -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 4mm;">
      <thead>
        <tr style="background: #f1f5f9; border-bottom: 1.5pt solid #cbd5e1;">
          <th style="padding: 2mm; font-size: 8.5pt; text-transform: uppercase; color: #475569; width: 25px;">#</th>
          <th style="padding: 2mm; font-size: 8.5pt; text-transform: uppercase; color: #475569;">Diagnostic Examination / Test Panel</th>
          <th style="padding: 2mm; font-size: 8.5pt; text-transform: uppercase; color: #475569; width: 140px;">Specimen / Container</th>
          <th style="padding: 2mm; font-size: 8.5pt; text-transform: uppercase; color: #475569; width: 140px;">Preparation & Fasting</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <!-- Phlebotomist Checklist & Accessioning Block -->
    <div style="border: 1pt solid #cbd5e1; border-radius: 4px; padding: 2.5mm 3.5mm; background: #fff; margin-bottom: 5mm;">
      <div style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #475569; letter-spacing: 0.3pt; margin-bottom: 2mm;">
        Phlebotomy &amp; Specimen Accessioning Section (Laboratory Staff Only):
      </div>
      <table style="width: 100%; border: none;">
        <tr>
          <td style="border: none; padding: 0; font-size: 8.5pt; color: #334155; width: 33%;">
            Date & Time Extracted: ____________________
          </td>
          <td style="border: none; padding: 0; font-size: 8.5pt; color: #334155; width: 33%;">
            Phlebotomist Name / Lic: __________________
          </td>
          <td style="border: none; padding: 0; font-size: 8.5pt; color: #334155; width: 34%; text-align: right;">
            Accession Barcode: [ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ]
          </td>
        </tr>
      </table>
    </div>

    <!-- Requesting Physician Signature Block -->
    <div style="margin-top: 6mm;">
      <table style="width: 100%; border: none;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: bottom; width: 60%;">
            <div style="font-size: 7.5pt; color: #64748b;">
              <strong>NOTICE TO PATIENT:</strong> Present this requisition slip at the Laboratory Reception desk.<br>
              Ensure all fasting instructions are strictly observed to avoid erroneous test parameters.
            </div>
          </td>
          <td style="border: none; padding: 0; vertical-align: bottom; text-align: right; width: 40%;">
            <div style="display: inline-block; text-align: center; width: 65mm;">
              <div style="border-top: 1pt solid #0f172a; margin-top: 12mm; padding-top: 1.5mm;">
                <div style="font-size: 10.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase;">
                  ${escapeHtml(doc.orderingPhysician)}
                </div>
                <div style="font-size: 8.5pt; color: #475569;">
                  Requesting Physician &middot; PRC Lic. No. <strong>${escapeHtml(doc.physicianPrcNo || 'N/A')}</strong>
                </div>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <footer style="margin-top: 6mm; border-top: 0.5pt solid #cbd5e1; padding-top: 1.5mm; font-size: 7.5pt; color: #64748b; display: flex; justify-content: space-between;">
      <span>${escapeHtml(doc.clinicName)} &middot; Laboratory Requisition #${escapeHtml(doc.orderNo)}</span>
      <span>Electronic Health Record &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell(`Lab Requisition ${doc.orderNo}`, body);
}

export interface EncounterOrdersDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;

  visitNo: string;
  issuedAt: string;

  patientName: string;
  patientAge?: string | number;
  patientSex?: string;
  patientDob?: string;
  patientMrn?: string;
  allergies?: Array<{ substance: string; severity?: string }>;

  clinicalImpression?: string;
  planNotes?: string;

  prescriberName: string;
  prcLicenseNo?: string;
  ptrNo?: string;
  s2LicenseNo?: string;

  prescriptions: PrescriptionItemDocument[];
  labRequests: LabRequisitionItem[];

  advice?: string;
  verificationHash?: string;
}

/**
 * Official Combined Encounter Orders & Clinical Summary Sheet
 */
export function renderEncounterOrdersHtml(doc: EncounterOrdersDocument): string {
  const rxList = doc.prescriptions.map((rx, idx) => `
    <li style="margin-bottom: 2.5mm;">
      <strong>${idx + 1}. ${escapeHtml(rx.genericName)}</strong>
      ${rx.brandName ? ` (${escapeHtml(rx.brandName)})` : ''}
      ${rx.strength ? ` &mdash; ${escapeHtml(rx.strength)}` : ''}
      ${rx.dosageForm ? ` (${escapeHtml(rx.dosageForm)})` : ''} &middot; <strong>Qty: #${escapeHtml(rx.quantity)}</strong><br>
      <span style="color: #334155; font-size: 9pt;">Sig: ${escapeHtml(rx.sig || [rx.route, rx.frequency, rx.duration].filter(Boolean).join(' '))}</span>
    </li>
  `).join('');

  const labList = doc.labRequests.map((lab, idx) => `
    <li style="margin-bottom: 2mm;">
      <strong>${idx + 1}. ${escapeHtml(lab.testName)}</strong> (${escapeHtml(lab.testCode)}) &mdash;
      <span style="color: #475569;">Specimen: ${escapeHtml(lab.specimenType || 'Routine')}</span>
      ${lab.fastingRequired ? ` &middot; <span style="color: #b45309; font-weight: 600;">Fasting Required (${lab.fastingHours || 8}h)</span>` : ''}
    </li>
  `).join('');

  const body = `
    <!-- Header -->
    <header style="border-bottom: 2pt solid #0284c7; padding-bottom: 3mm; margin-bottom: 4mm;">
      <table style="width: 100%; border: none; margin: 0;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: top;">
            <div style="font-size: 15pt; font-weight: 800; color: #0f2942;">
              ${escapeHtml(doc.clinicName)}
            </div>
            <div style="font-size: 9pt; font-weight: 600; color: #0284c7; text-transform: uppercase;">
              CLINICAL CONSULTATION ORDERS &amp; MANAGEMENT PLAN
            </div>
            <div style="font-size: 8.5pt; color: #64748b;">
              ${[doc.branchName, doc.clinicAddress, doc.clinicPhone].filter(Boolean).map(escapeHtml).join(' &middot; ')}
            </div>
          </td>
          <td style="border: none; padding: 0; vertical-align: top; text-align: right; width: 140px;">
            <div style="font-family: Consolas, monospace; font-size: 10pt; font-weight: 700; color: #0f172a;">
              Visit #${escapeHtml(doc.visitNo)}
            </div>
            <div style="font-size: 8.5pt; color: #64748b;">
              Date: ${escapeHtml(doc.issuedAt)}
            </div>
          </td>
        </tr>
      </table>
    </header>

    <!-- Patient Bar -->
    <div style="background: #f8fafc; border: 1pt solid #cbd5e1; border-radius: 4px; padding: 2.5mm 3.5mm; margin-bottom: 4mm;">
      <table style="width: 100%; border: none;">
        <tr>
          <td style="border: none; padding: 0; font-size: 9.5pt;">
            Patient: <strong>${escapeHtml(doc.patientName)}</strong> &middot;
            ${doc.patientAge ? `${escapeHtml(doc.patientAge)} yo / ` : ''}${escapeHtml(doc.patientSex || 'N/A')} &middot;
            MRN: ${escapeHtml(doc.patientMrn || 'N/A')}
          </td>
          <td style="border: none; padding: 0; text-align: right; font-size: 8.5pt; color: #64748b;">
            Physician: <strong>${escapeHtml(doc.prescriberName)}</strong>
          </td>
        </tr>
      </table>
    </div>

    <!-- Clinical Impression -->
    ${doc.clinicalImpression ? `
      <div style="margin-bottom: 4mm; padding: 2mm 3.5mm; border-left: 3pt solid #0284c7; background: #f0f9ff; border-radius: 2px;">
        <span style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #0369a1;">Clinical Impression & Working Diagnoses:</span>
        <div style="font-size: 10pt; font-weight: 600; color: #0c4a6e; margin-top: 0.5mm;">
          ${escapeHtml(doc.clinicalImpression)}
        </div>
      </div>
    ` : ''}

    <!-- 1. Prescribed Medications -->
    <div style="margin-bottom: 5mm;">
      <div style="font-size: 10.5pt; font-weight: 800; color: #0f2942; border-bottom: 1pt solid #cbd5e1; padding-bottom: 1mm; margin-bottom: 2.5mm; text-transform: uppercase;">
        1. Prescribed Medications & Pharmacy Orders (Rx)
      </div>
      ${doc.prescriptions.length > 0 ? `
        <ul style="margin: 0; padding-left: 20px; font-size: 9.5pt; line-height: 1.4;">
          ${rxList}
        </ul>
      ` : '<div style="font-size: 9pt; color: #64748b; font-style: italic;">No outpatient medications prescribed during this encounter.</div>'}
    </div>

    <!-- 2. Diagnostic Requisitions -->
    <div style="margin-bottom: 5mm;">
      <div style="font-size: 10.5pt; font-weight: 800; color: #0f2942; border-bottom: 1pt solid #cbd5e1; padding-bottom: 1mm; margin-bottom: 2.5mm; text-transform: uppercase;">
        2. Laboratory & Diagnostic Requisitions
      </div>
      ${doc.labRequests.length > 0 ? `
        <ul style="margin: 0; padding-left: 20px; font-size: 9.5pt; line-height: 1.4;">
          ${labList}
        </ul>
      ` : '<div style="font-size: 9pt; color: #64748b; font-style: italic;">No diagnostic laboratory examinations requested.</div>'}
    </div>

    <!-- 3. Plan & Advice -->
    ${doc.advice || doc.planNotes ? `
      <div style="margin-bottom: 5mm;">
        <div style="font-size: 10.5pt; font-weight: 800; color: #0f2942; border-bottom: 1pt solid #cbd5e1; padding-bottom: 1mm; margin-bottom: 2.5mm; text-transform: uppercase;">
          3. Patient Care Advice & Return Instructions
        </div>
        <div style="font-size: 9.5pt; color: #334155; line-height: 1.45; background: #f8fafc; padding: 2.5mm 3.5mm; border-radius: 4px; border: 0.5pt solid #cbd5e1;">
          ${escapeHtml(doc.advice || doc.planNotes)}
        </div>
      </div>
    ` : ''}

    <!-- Signature -->
    <div style="margin-top: 8mm;">
      <table style="width: 100%; border: none;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: bottom; width: 60%;">
            <div style="font-size: 7.5pt; color: #64748b;">
              This clinical summary is issued for patient reference and continuity of care.
            </div>
          </td>
          <td style="border: none; padding: 0; vertical-align: bottom; text-align: right; width: 40%;">
            <div style="display: inline-block; text-align: center; width: 65mm;">
              <div style="border-top: 1pt solid #0f172a; margin-top: 12mm; padding-top: 1.5mm;">
                <div style="font-size: 10.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase;">
                  ${escapeHtml(doc.prescriberName)}
                </div>
                <div style="font-size: 8.5pt; color: #475569;">
                  Attending Physician &middot; PRC Lic. No. <strong>${escapeHtml(doc.prcLicenseNo || 'N/A')}</strong>
                </div>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <footer style="margin-top: 6mm; border-top: 0.5pt solid #cbd5e1; padding-top: 1.5mm; font-size: 7.5pt; color: #64748b; display: flex; justify-content: space-between;">
      <span>${escapeHtml(doc.clinicName)} &middot; Consultation Orders ${escapeHtml(doc.visitNo)}</span>
      <span>EMR Document &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell(`Encounter Orders ${doc.visitNo}`, body);
}

