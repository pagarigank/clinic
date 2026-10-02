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
