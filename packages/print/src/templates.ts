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
  clinicPhone?: string;
  clinicEmail?: string;
  branchName?: string;
  dohAccreditationNo?: string;
  certificateNo: string;
  issuedAt: string;
  encounterDate?: string;
  patientName: string;
  patientAge?: string;
  patientSex?: string;
  patientAddress?: string;
  patientCivilStatus?: string;
  patientDob?: string;
  /** The clinical reason / ICD-10 diagnosis, as recorded by the clinician. */
  diagnosis?: string;
  diagnosisDescription?: string;
  icd10Codes?: string[];
  vitalSigns?: string;
  clinicalFindings?: string;
  /** Certificate classification: FIT_TO_WORK | SICK_LEAVE | CLEARANCE | CONSULTATION */
  certType?: string;
  validFrom?: string;
  validTo?: string;
  recommendations?: string;
  /** Free-text body of the certificate. */
  body: string;
  /** Days the patient is unfit for work, when it is a fit-to-work note. */
  unfitForDays?: number;
  clinicianName: string;
  clinicianTitle?: string;
  clinicianSpecialty?: string;
  clinicianLicenseNo?: string;
  ptrNo?: string;
  s2LicenseNo?: string;
  philhealthAccreditationNo?: string;
  /** True when a clinician signature image has been embedded by the caller. */
  signedElectronically?: boolean;
  verificationHash?: string;
}

/**
 * Medical certificate / fit-to-work note.
 *
 * A certificate is a legal document: it is numbered, states the issuing
 * clinician's licence, and is never amended in place - a corrected
 * certificate is a new document with its own number.
 */
export function renderCertificateHtml(doc: MedicalCertificate): string {
  const headerHtml = [
    '<header style="border-bottom: 2pt solid #0f2942; padding-bottom: 4mm; margin-bottom: 5mm;">',
    '  <table style="width: 100%; border: none; margin: 0;">',
    '    <tr>',
    '      <td style="border: none; padding: 0; vertical-align: top;">',
    `        <div class="clinic" style="font-size: 16pt; font-weight: 800; color: #0f2942; letter-spacing: -0.2pt; text-transform: uppercase;">${escapeHtml(doc.clinicName)}</div>`,
    doc.branchName ? `        <div style="font-size: 9.5pt; font-weight: 600; color: #0284c7; text-transform: uppercase; letter-spacing: 0.4pt; margin-top: 1mm;">${escapeHtml(doc.branchName)}</div>` : '',
    doc.clinicAddress ? `        <div class="muted" style="font-size: 8.5pt; color: #64748b; margin-top: 1mm;">${escapeHtml(doc.clinicAddress)}${doc.clinicPhone ? ` &middot; Tel: ${escapeHtml(doc.clinicPhone)}` : ''}${doc.clinicEmail ? ` &middot; ${escapeHtml(doc.clinicEmail)}` : ''}</div>` : '',
    '      </td>',
    '      <td style="border: none; padding: 0; vertical-align: top; text-align: right; width: 170px;">',
    '        <div style="display: inline-block; background: #0f2942; color: #fff; font-size: 9pt; font-weight: 700; padding: 1.5mm 3.5mm; border-radius: 4px; letter-spacing: 0.5pt;">',
    '          OFFICIAL DOCUMENT',
    '        </div>',
    `        <div class="doc-no" style="font-family: Consolas, monospace; font-size: 9.5pt; font-weight: 700; color: #0f172a; margin-top: 2mm;">Certificate No. ${escapeHtml(doc.certificateNo)}</div>`,
    `        <div style="font-size: 8.5pt; color: #64748b;">Date: ${escapeHtml(doc.issuedAt)}</div>`,
    '      </td>',
    '    </tr>',
    '  </table>',
    '</header>',
  ].filter(Boolean).join('\n');

  const titleSection = `
    <div style="text-align: center; margin: 4mm 0 6mm;">
      <h1 style="font-size: 15pt; font-weight: 900; letter-spacing: 1.5pt; color: #0f172a; text-transform: uppercase; margin: 0; padding-bottom: 1.5mm; display: inline-block; border-bottom: 1.5pt solid #0f172a;">
        MEDICAL CERTIFICATE
      </h1>
      ${doc.certType && doc.certType !== 'OTHER' ? `
        <div style="font-size: 9pt; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 0.8pt; margin-top: 1.5mm;">
          ${escapeHtml(doc.certType.replace(/_/g, ' '))}
        </div>
      ` : ''}
    </div>
  `;

  const demographicsGrid = [
    '<div class="grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 2mm 6mm; margin-bottom: 5mm; background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 4px; padding: 3mm 4mm;">',
    field("Patient", doc.patientName),
    field("Date issued", doc.issuedAt),
    doc.patientAge ? field("Age", doc.patientAge) : "",
    doc.patientSex ? field("Sex", doc.patientSex) : "",
    doc.patientAddress ? field("Address", doc.patientAddress) : "",
    doc.encounterDate ? field("Examination Date", doc.encounterDate) : "",
    "</div>",
  ].filter(Boolean).join('\n');

  const salutation = `
    <div style="font-size: 10pt; font-weight: 700; color: #0f172a; margin-bottom: 3.5mm; text-transform: uppercase; letter-spacing: 0.4pt;">
      TO WHOM IT MAY CONCERN:
    </div>
  `;

  const diagnosisSection = doc.diagnosis ? [
    '<div style="margin-bottom: 4mm;">',
    '  <h2>Diagnosis</h2>',
    `  <div style="font-size: 10pt; font-weight: 600; color: #0f172a; background: #fff; border-left: 3pt solid #0284c7; padding: 2mm 3.5mm; border-top: 0.5pt solid #e2e8f0; border-right: 0.5pt solid #e2e8f0; border-bottom: 0.5pt solid #e2e8f0; border-radius: 0 4px 4px 0;">${escapeHtml(doc.diagnosis)}</div>`,
    doc.vitalSigns ? `  <div style="font-size: 8.5pt; color: #64748b; margin-top: 1.5mm;"><strong>Vital signs at examination:</strong> ${escapeHtml(doc.vitalSigns)}</div>` : '',
    doc.clinicalFindings && doc.clinicalFindings !== doc.diagnosis ? `  <div style="font-size: 9pt; color: #334155; margin-top: 1.5mm;"><strong>Clinical findings:</strong> ${escapeHtml(doc.clinicalFindings)}</div>` : '',
    '</div>',
  ].filter(Boolean).join('\n') : '';

  const certificateBodySection = [
    '<div style="margin-bottom: 5mm;">',
    '  <h2>Certificate</h2>',
    `  <div style="white-space: pre-wrap; font-size: 10pt; line-height: 1.6; color: #1e293b; text-align: justify;">${escapeHtml(doc.body)}</div>`,
    typeof doc.unfitForDays === "number"
      ? `  <p style="margin-top: 3.5mm; padding: 2.5mm 3.5mm; background: #fef2f2; border-left: 3pt solid #ef4444; border-radius: 0 4px 4px 0; color: #991b1b; font-size: 9.5pt;"><strong>This patient is unfit for work for ${doc.unfitForDays} day(s) from the date of issue.</strong></p>`
      : "",
    doc.validFrom && doc.validTo && !doc.body.includes(doc.validFrom) ? `  <div style="font-size: 9pt; color: #475569; margin-top: 2mm;"><strong>Validity:</strong> ${escapeHtml(doc.validFrom)} to ${escapeHtml(doc.validTo)}</div>` : '',
    '</div>',
  ].filter(Boolean).join('\n');

  const physicianBlock = [
    '<div class="sig" style="margin-top: 8mm; display: flex; justify-content: flex-end;">',
    '  <div style="width: 75mm; text-align: center;">',
    `    <div class="sig-line" style="border-top: 1pt solid #0f172a; padding-top: 1.5mm; font-size: 10pt; font-weight: 700; color: #0f172a;">${escapeHtml(doc.clinicianName)}${doc.clinicianLicenseNo ? ` &middot; Lic. No. ${escapeHtml(doc.clinicianLicenseNo)}` : ""}</div>`,
    doc.clinicianTitle || doc.clinicianSpecialty ? `    <div style="font-size: 8.5pt; color: #475569; margin-top: 0.5mm;">${escapeHtml([doc.clinicianTitle, doc.clinicianSpecialty].filter(Boolean).join(' &middot; '))}</div>` : '',
    doc.ptrNo ? `    <div style="font-size: 8pt; color: #64748b;">PTR No. ${escapeHtml(doc.ptrNo)}</div>` : '',
    doc.s2LicenseNo ? `    <div style="font-size: 8pt; color: #64748b;">S2 License No. ${escapeHtml(doc.s2LicenseNo)}</div>` : '',
    doc.philhealthAccreditationNo ? `    <div style="font-size: 8pt; color: #64748b;">PhilHealth Accr. No. ${escapeHtml(doc.philhealthAccreditationNo)}</div>` : '',
    doc.signedElectronically
      ? '    <div class="muted" style="margin-top: 2mm; font-size: 7.5pt; color: #64748b; font-style: italic;">Electronically signed. Signature authenticity is evidenced by the document SHA-256 recorded on issue.</div>'
      : "",
    '  </div>',
    '</div>',
  ].filter(Boolean).join('\n');

  const legalDisclaimer = `
    <div style="margin-top: 8mm; text-align: center; font-size: 7.5pt; color: #64748b; font-style: italic; border-top: 0.5pt dashed #cbd5e1; padding-top: 2.5mm;">
      NOTE: This medical certificate is issued upon patient request for whatever legal purpose it may serve, except for medico-legal cases.
      Valid only with attending physician's signature and clinic dry seal.
    </div>
  `;

  const footer = `<footer>${escapeHtml(doc.clinicName)} &middot; Certificate ${escapeHtml(doc.certificateNo)} &middot; This document is void if altered.</footer>`;

  const body = [
    headerHtml,
    titleSection,
    salutation,
    demographicsGrid,
    diagnosisSection,
    certificateBodySection,
    physicianBlock,
    legalDisclaimer,
    footer,
  ].filter(Boolean).join('\n');

  return shell(`Certificate ${doc.certificateNo}`, body);
}

export interface LabReport {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  dohAccreditationNo?: string;
  philhealthAccreditationNo?: string;
  reportNo: string;
  orderNo: string;
  version: number;
  status: "PRELIMINARY" | "RELEASED" | "CORRECTED";
  patientName: string;
  patientAge?: string;
  patientSex?: string;
  patientDob?: string;
  patientMrn?: string;
  patientAddress?: string;
  collectedAt?: string;
  receivedAt?: string;
  releasedAt?: string;
  orderingClinician?: string;
  specimenType?: string;
  accessionNo?: string;
  verifiedBy?: string;
  pathologistName?: string;
  pathologistTitle?: string;
  pathologistLicenseNo?: string;
  medtechName?: string;
  medtechTitle?: string;
  medtechLicenseNo?: string;
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
  verificationHash?: string;
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
        <td style="font-weight: 600;">${escapeHtml(r.test)}</td>
        <td>${escapeHtml(r.analyte)}</td>
        <td class="num" style="font-weight: 700; ${r.flag === 'HH' || r.flag === 'LL' || r.flag === 'CRITICAL' ? 'color: #b91c1c;' : r.flag === 'H' || r.flag === 'L' ? 'color: #c2410c;' : ''}">${escapeHtml(r.value)}${flagMark(r.flag)}</td>
        <td>${escapeHtml(r.unit ?? "")}</td>
        <td>${escapeHtml(r.referenceRange ?? "")}</td>
      </tr>`,
    )
    .join("");

  const headerTable = doc.clinicAddress || doc.branchName || doc.dohAccreditationNo
    ? `<header style="border-bottom: 2pt solid #0f2942; padding-bottom: 3.5mm; margin-bottom: 4mm;">
        <table style="width: 100%; border: none; margin: 0;">
          <tr>
            <td style="border: none; padding: 0; vertical-align: top;">
              <div class="clinic" style="font-size: 15pt; font-weight: 800; color: #0f2942; letter-spacing: -0.2pt; text-transform: uppercase;">${escapeHtml(doc.clinicName)}</div>
              ${doc.branchName ? `<div style="font-size: 9.5pt; font-weight: 600; color: #0284c7; text-transform: uppercase; letter-spacing: 0.4pt; margin-top: 1mm;">${escapeHtml(doc.branchName)}</div>` : ''}
              ${doc.clinicAddress ? `<div class="muted" style="font-size: 8.5pt; color: #64748b; margin-top: 1mm;">${escapeHtml(doc.clinicAddress)}${doc.clinicPhone ? ` &middot; Tel: ${escapeHtml(doc.clinicPhone)}` : ''}${doc.clinicEmail ? ` &middot; ${escapeHtml(doc.clinicEmail)}` : ''}</div>` : ''}
              ${doc.dohAccreditationNo ? `<div style="font-size: 8pt; color: #94a3b8; margin-top: 0.5mm;">DOH Accreditation / LTO No. ${escapeHtml(doc.dohAccreditationNo)}</div>` : ''}
            </td>
            <td style="border: none; padding: 0; vertical-align: top; text-align: right; width: 170px;">
              <div style="display: inline-block; background: #0f2942; color: #fff; font-size: 8.5pt; font-weight: 700; padding: 1.5mm 3.5mm; border-radius: 4px; letter-spacing: 0.5pt;">
                ${doc.status === "PRELIMINARY" ? "PRELIMINARY REPORT" : "OFFICIAL LAB REPORT"}
              </div>
              <div class="doc-no" style="font-size: 9.5pt; color: #0f2942; margin-top: 2mm;">Report ${escapeHtml(doc.reportNo)} &middot; Version ${doc.version}</div>
            </td>
          </tr>
        </table>
      </header>`
    : `<header>
        <div class="clinic">${escapeHtml(doc.clinicName)}</div>
        <div class="doc-no">Report ${escapeHtml(doc.reportNo)} &middot; Version ${doc.version}</div>
      </header>`;

  const body = [
    headerTable,
    `<p><strong>Status: ${escapeHtml(doc.status)}</strong>${
      doc.status === "CORRECTED" ? " &mdash; this version supersedes all earlier versions" : ""
    }</p>`,
    doc.amendmentReason
      ? `<p><strong>Reason for amendment:</strong> ${escapeHtml(doc.amendmentReason)}</p>`
      : "",
    '<div class="grid" style="background: #f8fafc; padding: 2.5mm 3.5mm; border: 0.5pt solid #e2e8f0; border-radius: 4px; margin-bottom: 3.5mm;">',
    field("Patient", doc.patientName),
    field("Order", doc.orderNo),
    doc.patientAge ? field("Age", doc.patientAge) : "",
    doc.patientSex ? field("Sex", doc.patientSex) : "",
    doc.patientDob ? field("Date of Birth", doc.patientDob) : "",
    doc.patientMrn ? field("MRN", doc.patientMrn) : "",
    doc.specimenType ? field("Specimen", doc.specimenType) : "",
    doc.collectedAt ? field("Collected", doc.collectedAt) : "",
    doc.receivedAt ? field("Received", doc.receivedAt) : "",
    doc.releasedAt ? field("Released", doc.releasedAt) : "",
    doc.orderingClinician ? field("Ordering clinician", doc.orderingClinician) : "",
    "</div>",
    doc.confidentialityNotice
      ? `<p style="border:1pt solid #b91c1c;background:#fef2f2;color:#991b1b;padding:2mm;border-radius:3px;"><strong>CONFIDENTIAL.</strong> ${escapeHtml(
          doc.confidentialityNotice,
        )}</p>`
      : "",
    "<h2 style='color:#0f2942;border-bottom:1pt solid #cbd5e1;padding-bottom:1mm;margin-top:4mm;'>Diagnostic Examination Results</h2>",
    "<table><thead><tr><th>Test</th><th>Analyte</th><th class='num'>Value</th><th>Unit</th><th>Reference</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
    doc.interpretation ? `<h2 style='color:#0f2942;margin-top:4mm;'>Interpretation</h2><div style="background:#f8fafc;padding:2.5mm 3.5mm;border-left:2pt solid #0284c7;border-radius:2px;">${escapeHtml(doc.interpretation)}</div>` : "",
    doc.medtechName || doc.pathologistName
      ? `<div style="margin-top: 10mm; display: flex; justify-content: space-between; gap: 20mm;">
          <div style="flex: 1; text-align: center;">
            <div style="border-top: 0.75pt solid #334155; padding-top: 1.5mm; font-weight: 700; font-size: 9.5pt; color: #0f172a;">
              ${escapeHtml(doc.medtechName || "Registered Medical Technologist")}
            </div>
            <div class="muted" style="font-size: 8.5pt;">${escapeHtml(doc.medtechTitle || "Medical Technologist (RMT)")}</div>
            ${doc.medtechLicenseNo ? `<div class="muted" style="font-size: 8pt;">PRC License No. ${escapeHtml(doc.medtechLicenseNo)}</div>` : ""}
          </div>
          <div style="flex: 1; text-align: center;">
            <div style="border-top: 0.75pt solid #334155; padding-top: 1.5mm; font-weight: 700; font-size: 9.5pt; color: #0f172a;">
              ${escapeHtml(doc.pathologistName || doc.verifiedBy || "Clinical Pathologist")}
            </div>
            <div class="muted" style="font-size: 8.5pt;">${escapeHtml(doc.pathologistTitle || "Pathologist, FPSP")}</div>
            ${doc.pathologistLicenseNo ? `<div class="muted" style="font-size: 8pt;">PRC License No. ${escapeHtml(doc.pathologistLicenseNo)}</div>` : ""}
          </div>
        </div>`
      : doc.verifiedBy
      ? `<div class="sig"><div class="sig-line">${escapeHtml(
          doc.verifiedBy,
        )} &middot; Verified</div></div>`
      : "",
    `<footer>${escapeHtml(doc.clinicName)} &middot; Report ${escapeHtml(doc.reportNo)} v${doc.version}${
      doc.status === "RELEASED" || doc.status === "CORRECTED"
        ? " &middot; Electronically verified; integrity evidenced by the recorded SHA-256"
        : " &middot; NOT FOR CLINICAL USE"
    }${doc.verificationHash ? ` &middot; Hash: ${escapeHtml(doc.verificationHash.slice(0, 16))}…` : ""}</footer>`,
  ]
    .filter(Boolean)
    .join("");

  return shell(`Lab report ${doc.reportNo}`, body);
}

export interface ReceiptDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  tin?: string;
  dohAccreditationNo?: string;
  philhealthAccreditationNo?: string;
  receiptNo: string;
  /** Present on a reprint; the underlying payment is unchanged. */
  reprintedFrom?: string;
  issuedAt: string;
  cashierName: string;
  patientName?: string;
  patientId?: string;
  invoiceNo?: string;
  paymentMethod?: string;
  reference?: string;
  balanceDue?: number;
  lines: Array<{ description: string; qty: number; unitPrice: number; total: number; isProfessionalFee?: boolean }>;
  subtotal: number;
  discount?: { label: string; amount: number; /** Required when a discount needs ID capture. */
    idCaptured?: boolean } | null;
  total: number;
  amountTendered?: number;
  changeGiven?: number;
  /** Payer as selected for the encounter (private cash, HMO, PhilHealth, corporate). */
  payer?: string;
  footer?: string;
  verificationHash?: string;
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
    doc.branchName ? `<div style="font-size:9.5pt;font-weight:600;color:#0284c7;text-transform:uppercase;letter-spacing:0.3pt;margin-top:0.5mm;">${escapeHtml(doc.branchName)}</div>` : "",
    doc.clinicAddress || doc.clinicPhone || doc.clinicEmail
      ? `<div class="muted">${escapeHtml(doc.clinicAddress || "")}${
          doc.clinicPhone ? ` &middot; Tel: ${escapeHtml(doc.clinicPhone)}` : ""
        }${doc.clinicEmail ? ` &middot; ${escapeHtml(doc.clinicEmail)}` : ""}</div>`
      : "",
    doc.tin || doc.dohAccreditationNo || doc.philhealthAccreditationNo
      ? `<div class="muted" style="font-size:8pt;margin-top:0.5mm;">${
          doc.tin ? `TIN: ${escapeHtml(doc.tin)}` : ""
        }${doc.tin && doc.dohAccreditationNo ? " &middot; " : ""}${
          doc.dohAccreditationNo ? `DOH Lic: ${escapeHtml(doc.dohAccreditationNo)}` : ""
        }${doc.philhealthAccreditationNo ? ` &middot; PhilHealth: ${escapeHtml(doc.philhealthAccreditationNo)}` : ""}</div>`
      : "",
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
    doc.invoiceNo ? field("Invoice No", doc.invoiceNo) : "",
    doc.paymentMethod ? field("Payment Method", doc.paymentMethod) : "",
    doc.reference ? field("Ref / Auth", doc.reference) : "",
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
    doc.balanceDue !== undefined && Number(doc.balanceDue) > 0
      ? `<div style="color:#b91c1c;font-weight:600;"><span>Remaining Balance</span><span>${money(doc.balanceDue)}</span></div>`
      : "",
    "</div>",
    doc.footer ? `<p class="muted" style="margin-top:5mm">${escapeHtml(doc.footer)}</p>` : "",
    `<footer>${escapeHtml(doc.clinicName)} &middot; Receipt ${escapeHtml(
      doc.receiptNo,
    )} &middot; Total ${money(doc.total)}${
      doc.verificationHash ? ` &middot; Hash: ${escapeHtml(doc.verificationHash.slice(0, 16))}…` : ""
    }</footer>`,
  ]
    .filter(Boolean)
    .join("");

  return shell(`Receipt ${doc.receiptNo}`, body);
}

export interface InvoiceLineItem {
  description: string;
  qty: number | string;
  unitPrice: number | string;
  discountAmount?: number | string;
  netAmount: number | string;
  isProfessionalFee?: boolean;
}

export interface InvoiceDiscountItem {
  name: string;
  percentage?: number | string;
  amount: number | string;
  idType?: string;
  idNumber?: string;
  legalBasis?: string;
}

export interface InvoicePaymentItem {
  paymentNo: string;
  receivedAt: string;
  methodName: string;
  reference?: string;
  amount: number | string;
}

export interface InvoiceDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  tin?: string;
  dohAccreditationNo?: string;
  philhealthAccreditationNo?: string;

  invoiceNo: string;
  issuedAt: string;
  dueDate?: string;
  status: string;

  patientName?: string;
  patientNumber?: string;
  patientDob?: string;
  patientGender?: string;
  patientAddress?: string;
  payerType?: string;

  billingOfficer?: string;
  notes?: string;

  lines: InvoiceLineItem[];
  discounts?: InvoiceDiscountItem[];
  payments?: InvoicePaymentItem[];

  subtotal: number | string;
  discountTotal: number | string;
  taxTotal?: number | string;
  total: number | string;
  paidAmount: number | string;
  balance: number | string;

  verificationHash?: string;
}

/**
 * Official billing invoice / Statement of Account.
 *
 * Q-17: professional fee charges are itemized cleanly with statutory discounts
 * (Senior RA 9994 / PWD RA 10754). Internal practitioner revenue shares and
 * profit percentages never appear on patient-facing documents.
 */
export function renderInvoiceHtml(doc: InvoiceDocument): string {
  const lineRows = (doc.lines || []).map((l) => {
    return `<tr>
      <td>
        <div style="font-weight: 600; color: #0f172a;">${escapeHtml(l.description)}</div>
        ${l.isProfessionalFee ? '<span style="display:inline-block; font-size:7.5pt; font-weight:700; color:#0284c7; background:#e0f2fe; padding:0.5mm 1.5mm; border-radius:2px; margin-top:0.5mm;">PROFESSIONAL FEE (Q-17)</span>' : ''}
      </td>
      <td class="num">${escapeHtml(l.qty)}</td>
      <td class="num">${money(l.unitPrice)}</td>
      ${l.discountAmount && Number(l.discountAmount) > 0 ? `<td class="num" style="color:#dc2626;">-${money(l.discountAmount)}</td>` : '<td class="num" style="color:#64748b;">—</td>'}
      <td class="num" style="font-weight:600;">${money(l.netAmount)}</td>
    </tr>`;
  }).join("");

  const discountRows = (doc.discounts && doc.discounts.length > 0)
    ? doc.discounts.map((d) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 1mm 0; border-bottom: 0.5pt dashed #cbd5e1; font-size: 9pt;">
        <div>
          <strong style="color: #b91c1c;">${escapeHtml(d.name)}</strong>
          ${d.percentage ? `<span class="muted"> (${escapeHtml(d.percentage)}%)</span>` : ''}
          ${d.legalBasis ? `<div class="muted" style="font-size: 8pt;">Basis: ${escapeHtml(d.legalBasis)}</div>` : ''}
          ${d.idType || d.idNumber ? `<div class="muted" style="font-size: 8pt;">ID: ${escapeHtml(d.idType || '')} ${escapeHtml(d.idNumber || '')}</div>` : ''}
        </div>
        <div style="font-weight: 700; color: #b91c1c;">-${money(d.amount)}</div>
      </div>
    `).join("")
    : "";

  const paymentRows = (doc.payments && doc.payments.length > 0)
    ? doc.payments.map((p) => `
      <tr>
        <td class="doc-no">${escapeHtml(p.paymentNo)}</td>
        <td>${escapeHtml(String(p.receivedAt).slice(0, 10))}</td>
        <td>${escapeHtml(p.methodName)}${p.reference ? ` (${escapeHtml(p.reference)})` : ''}</td>
        <td class="num" style="color: #15803d; font-weight: 600;">${money(p.amount)}</td>
      </tr>
    `).join("")
    : "";

  const statusTone = doc.status === 'PAID' ? '#15803d' : doc.status === 'VOID' ? '#dc2626' : '#d97706';

  const body = [
    '<header style="border-bottom: 2pt solid #0f2942; padding-bottom: 4mm; margin-bottom: 5mm;">',
    '  <table style="width: 100%; border: none; margin: 0;">',
    '    <tr>',
    '      <td style="border: none; padding: 0; vertical-align: top;">',
    `        <div class="clinic" style="font-size: 16pt; font-weight: 800; color: #0f2942; letter-spacing: -0.2pt; text-transform: uppercase;">${escapeHtml(doc.clinicName)}</div>`,
    doc.branchName ? `        <div style="font-size: 9.5pt; font-weight: 600; color: #0284c7; text-transform: uppercase; letter-spacing: 0.4pt; margin-top: 1mm;">${escapeHtml(doc.branchName)}</div>` : '',
    doc.clinicAddress ? `        <div class="muted" style="font-size: 8.5pt; color: #64748b; margin-top: 1mm;">${escapeHtml(doc.clinicAddress)}${doc.clinicPhone ? ` &middot; Tel: ${escapeHtml(doc.clinicPhone)}` : ''}${doc.clinicEmail ? ` &middot; ${escapeHtml(doc.clinicEmail)}` : ''}</div>` : '',
    (doc.tin || doc.dohAccreditationNo || doc.philhealthAccreditationNo) ? `        <div class="muted" style="font-size: 8pt; color: #64748b; margin-top: 0.5mm;">${doc.tin ? `TIN: ${escapeHtml(doc.tin)}` : ''}${doc.tin && doc.dohAccreditationNo ? ' &middot; ' : ''}${doc.dohAccreditationNo ? `DOH Lic: ${escapeHtml(doc.dohAccreditationNo)}` : ''}${doc.philhealthAccreditationNo ? ` &middot; PhilHealth: ${escapeHtml(doc.philhealthAccreditationNo)}` : ''}</div>` : '',
    '      </td>',
    '      <td style="border: none; padding: 0; vertical-align: top; text-align: right; width: 220px;">',
    '        <div style="display: inline-block; background: #0f2942; color: #fff; font-size: 9pt; font-weight: 700; padding: 1.5mm 3.5mm; border-radius: 4px; letter-spacing: 0.5pt;">',
    '          OFFICIAL BILLING INVOICE',
    '        </div>',
    `        <div class="doc-no" style="font-family: Consolas, monospace; font-size: 11pt; font-weight: 800; color: #0f172a; margin-top: 2mm;">Invoice No. ${escapeHtml(doc.invoiceNo)}</div>`,
    `        <div style="font-size: 8.5pt; color: #64748b; margin-top: 0.5mm;">Date: ${escapeHtml(doc.issuedAt ? String(doc.issuedAt).slice(0, 10) : '')}</div>`,
    doc.dueDate ? `        <div style="font-size: 8.5pt; color: #64748b;">Due Date: ${escapeHtml(String(doc.dueDate).slice(0, 10))}</div>` : '',
    `        <div style="margin-top: 1.5mm;"><span style="display: inline-block; font-size: 8pt; font-weight: 800; color: ${statusTone}; border: 1pt solid ${statusTone}; padding: 0.5mm 2.5mm; border-radius: 3px; text-transform: uppercase;">${escapeHtml(doc.status)}</span></div>`,
    '      </td>',
    '    </tr>',
    '  </table>',
    '</header>',
    '<div class="grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 2mm 6mm; margin-bottom: 5mm; background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 4px; padding: 3mm 4mm;">',
    field("Patient / Customer", doc.patientName || "Walk-in Patient"),
    field("Patient ID / MRN", doc.patientNumber || "—"),
    doc.patientDob ? field("Date of Birth", String(doc.patientDob).slice(0, 10)) : "",
    doc.payerType ? field("Billing Category / Payer", doc.payerType.replace(/_/g, ' ')) : "",
    doc.billingOfficer ? field("Billing Officer", doc.billingOfficer) : "",
    "</div>",
    '<h2 style="font-size: 10pt; font-weight: 700; text-transform: uppercase; color: #334155; margin: 4mm 0 1.5mm; letter-spacing: 0.3pt;">Itemized Charges &amp; Services</h2>',
    '<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Discount</th><th class="num">Net Amount</th></tr></thead>',
    `<tbody>${lineRows}</tbody></table>`,
    discountRows ? `
      <div style="margin-top: 4mm; background: #fff5f5; border: 0.5pt solid #fecaca; border-radius: 4px; padding: 2.5mm 3.5mm;">
        <div style="font-size: 8.5pt; font-weight: 700; text-transform: uppercase; color: #991b1b; margin-bottom: 1.5mm; letter-spacing: 0.3pt;">Statutory &amp; Authorized Discounts</div>
        ${discountRows}
      </div>
    ` : '',
    paymentRows ? `
      <div style="margin-top: 4mm;">
        <h2 style="font-size: 9.5pt; font-weight: 700; text-transform: uppercase; color: #334155; margin: 0 0 1.5mm; letter-spacing: 0.3pt;">Payments &amp; Settlements Applied</h2>
        <table><thead><tr><th>Official Receipt / Ref</th><th>Date</th><th>Method</th><th class="num">Amount Paid</th></tr></thead>
        <tbody>${paymentRows}</tbody></table>
      </div>
    ` : '',
    '<div class="totals" style="margin-top: 5mm; margin-left: auto; width: 80mm; background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 4px; padding: 3mm 4mm;">',
    `<div><span style="color:#64748b;">Gross Subtotal</span><span style="font-weight:600;">${money(doc.subtotal)}</span></div>`,
    Number(doc.discountTotal || 0) > 0 ? `<div style="color:#dc2626;"><span>Total Discounts</span><span>-${money(doc.discountTotal)}</span></div>` : '',
    Number(doc.taxTotal || 0) > 0 ? `<div><span style="color:#64748b;">VAT / Sales Tax</span><span>${money(doc.taxTotal ?? 0)}</span></div>` : '',
    `<div style="border-top:0.5pt solid #cbd5e1; margin-top:1.5mm; padding-top:1.5mm; font-weight:700;"><span>Total Billed</span><span>${money(doc.total)}</span></div>`,
    Number(doc.paidAmount || 0) > 0 ? `<div style="color:#15803d;"><span>Total Paid / Credited</span><span>-${money(doc.paidAmount)}</span></div>` : '',
    `<div class="grand" style="border-top:1.5pt solid #0f2942; margin-top:2mm; padding-top:2mm; font-size:12pt; font-weight:800; color:#0f2942;"><span>Balance Due</span><span>${money(doc.balance)}</span></div>`,
    '</div>',
    doc.notes ? `<div style="margin-top:4mm; font-size:8.5pt; color:#475569; background:#f1f5f9; padding:2.5mm 3.5mm; border-radius:4px;"><strong>Notes / Terms:</strong> ${escapeHtml(doc.notes)}</div>` : '',
    '<div style="margin-top: 8mm; display: flex; justify-content: space-between;">',
    '  <div style="width: 65mm;">',
    '    <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8.5pt; color: #334155; text-align: center;">',
    `      Prepared By: <strong>${escapeHtml(doc.billingOfficer || 'Authorized Billing Officer')}</strong>`,
    '      <div style="font-size: 7.5pt; color: #64748b;">Billing &amp; Accounts Section</div>',
    '    </div>',
    '  </div>',
    '  <div style="width: 65mm;">',
    '    <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8.5pt; color: #334155; text-align: center;">',
    '      Patient / Representative Signature',
    '      <div style="font-size: 7.5pt; color: #64748b;">Conforme / Received Copy</div>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div style="margin-top: 6mm; padding: 2mm 3mm; background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 4px; font-size: 7.5pt; color: #64748b; text-align: center;">',
    '  This document serves as an Official Statement of Account / Billing Invoice. An Official Receipt (OR) will be issued upon receipt of cash, check, or online settlement in compliance with BIR regulations.',
    '</div>',
    `<footer>${escapeHtml(doc.clinicName)} &middot; Invoice ${escapeHtml(doc.invoiceNo)} &middot; Total ${money(doc.total)}${doc.verificationHash ? ` &middot; Hash: ${escapeHtml(doc.verificationHash.slice(0, 16))}…` : ''}</footer>`,
  ].filter(Boolean).join("\n");

  return shell(`Invoice ${doc.invoiceNo}`, body);
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

  diagnosis?: string;
  diagnosisDescription?: string;
  clinicalImpression?: string;
  specialInstruction?: string;
  clinicalNotes?: string;
  clinicalMemo?: string;
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

    <!-- Clinical Diagnosis / Impression -->
    ${(doc.diagnosis || doc.clinicalImpression || doc.diagnosisDescription) ? `
      <div style="background: #f0fdf4; border: 1pt solid #86efac; border-left: 3pt solid #16a34a; border-radius: 4px; padding: 2.2mm 3.5mm; margin-bottom: 3.5mm;">
        <span style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #15803d; letter-spacing: 0.3pt;">Clinical Diagnosis / Impression:</span>
        <div style="font-size: 10pt; font-weight: 700; color: #14532d; margin-top: 0.5mm;">
          ${escapeHtml(doc.diagnosis || doc.clinicalImpression || doc.diagnosisDescription || '')}
        </div>
        ${doc.diagnosisDescription && doc.diagnosisDescription !== doc.diagnosis && !doc.diagnosis?.includes(doc.diagnosisDescription) ? `
          <div style="font-size: 9pt; color: #166534; margin-top: 0.8mm; line-height: 1.35;">
            <strong style="color: #15803d; font-size: 8pt; text-transform: uppercase;">Diagnosis Description:</strong> ${escapeHtml(doc.diagnosisDescription)}
          </div>
        ` : ''}
      </div>
    ` : ''}

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
      <div style="background: #f8fafc; border: 1pt solid #cbd5e1; border-left: 3pt solid #0284c7; padding: 2.5mm 3.5mm; border-radius: 4px; margin-top: 3.5mm; font-size: 9pt; color: #1e293b;">
        <div style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #0284c7; letter-spacing: 0.3pt; margin-bottom: 0.8mm;">
          Physician's Instructions &amp; Notes:
        </div>
        <div style="font-size: 9.5pt; color: #334155; line-height: 1.4;">
          ${escapeHtml(doc.specialInstruction)}
        </div>
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

    <!-- Clinical Notes / Physician's Memo (Just before footer) -->
    ${(doc.clinicalNotes || doc.clinicalMemo) ? `
      <div style="margin-top: 5mm; margin-bottom: 2mm; background: #f8fafc; border: 1pt solid #cbd5e1; border-left: 3.5pt solid #0284c7; padding: 2.5mm 3.5mm; border-radius: 4px;">
        <div style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #0284c7; letter-spacing: 0.4pt; margin-bottom: 1mm;">
          Clinical Notes / Physician's Memo:
        </div>
        <div style="font-size: 9.5pt; color: #1e293b; line-height: 1.45; white-space: pre-wrap;">
          ${escapeHtml(doc.clinicalNotes || doc.clinicalMemo || '')}
        </div>
      </div>
    ` : ''}

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
  diagnosisDescription?: string;
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
        ${escapeHtml(doc.clinicalImpression || doc.diagnosisDescription || 'Diagnostic evaluation and clinical monitoring')}
      </div>
      ${doc.diagnosisDescription && doc.diagnosisDescription !== doc.clinicalImpression && !doc.clinicalImpression?.includes(doc.diagnosisDescription) ? `
        <div style="font-size: 9pt; color: #0369a1; margin-top: 0.8mm;">
          <strong>Diagnosis Description:</strong> ${escapeHtml(doc.diagnosisDescription)}
        </div>
      ` : ''}
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
  diagnosisDescription?: string;
  planNotes?: string;

  prescriberName: string;
  prcLicenseNo?: string;
  ptrNo?: string;
  s2LicenseNo?: string;

  prescriptions: PrescriptionItemDocument[];
  labRequests: LabRequisitionItem[];

  advice?: string;
  clinicalNotes?: string;
  clinicalMemo?: string;
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
    ${(doc.clinicalImpression || doc.diagnosisDescription) ? `
      <div style="margin-bottom: 4mm; padding: 2mm 3.5mm; border-left: 3pt solid #0284c7; background: #f0f9ff; border-radius: 2px;">
        <span style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #0369a1;">Clinical Impression & Working Diagnoses:</span>
        <div style="font-size: 10pt; font-weight: 600; color: #0c4a6e; margin-top: 0.5mm;">
          ${escapeHtml(doc.clinicalImpression || doc.diagnosisDescription || '')}
        </div>
        ${doc.diagnosisDescription && doc.diagnosisDescription !== doc.clinicalImpression && !doc.clinicalImpression?.includes(doc.diagnosisDescription) ? `
          <div style="font-size: 9pt; color: #0369a1; margin-top: 0.8mm;">
            <strong>Diagnosis Description:</strong> ${escapeHtml(doc.diagnosisDescription)}
          </div>
        ` : ''}
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

    <!-- Clinical Notes / Physician's Memo (Just before footer) -->
    ${(doc.clinicalNotes || doc.clinicalMemo) ? `
      <div style="margin-top: 5mm; margin-bottom: 2mm; background: #f8fafc; border: 1pt solid #cbd5e1; border-left: 3.5pt solid #0284c7; padding: 2.5mm 3.5mm; border-radius: 4px;">
        <div style="font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #0284c7; letter-spacing: 0.4pt; margin-bottom: 1mm;">
          Clinical Notes / Physician's Memo:
        </div>
        <div style="font-size: 9.5pt; color: #1e293b; line-height: 1.45; white-space: pre-wrap;">
          ${escapeHtml(doc.clinicalNotes || doc.clinicalMemo || '')}
        </div>
      </div>
    ` : ''}

    <!-- Footer -->
    <footer style="margin-top: 6mm; border-top: 0.5pt solid #cbd5e1; padding-top: 1.5mm; font-size: 7.5pt; color: #64748b; display: flex; justify-content: space-between;">
      <span>${escapeHtml(doc.clinicName)} &middot; Consultation Orders ${escapeHtml(doc.visitNo)}</span>
      <span>EMR Document &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell(`Encounter Orders ${doc.visitNo}`, body);
}

/** Qty formatted to at most three decimals, thousands-separated. */
function qty(value: number | string): string {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n)
    ? n.toLocaleString("en-PH", { maximumFractionDigits: 3 })
    : "0";
}

export interface RxQueueDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  /** The status filter the list was taken under, e.g. ISSUED. */
  status: string;
  generatedAt: string;
  generatedBy?: string;
  rows: Array<{
    rxNo: string;
    patientName: string;
    patientHrn?: string | null;
    patientDob?: string | null;
    prescriberName: string;
    visitNo?: string | null;
    itemCount: number;
    isControlled: boolean;
    issuedAt?: string | null;
    validUntil?: string | null;
    status: string;
  }>;
}

/**
 * Pharmacy prescription verification queue list.
 *
 * An operational worklist rather than a signed instrument: it exists so the
 * pharmacy can file a dated snapshot of what was awaiting verification.
 */
export function renderRxQueueHtml(doc: RxQueueDocument): string {
  const rows =
    doc.rows.length === 0
      ? `<tr><td colspan="8" style="text-align:center; color:#64748b; font-style:italic; padding:6mm 0;">No prescriptions match this filter.</td></tr>`
      : doc.rows
          .map((r, idx) => {
            const classCell = r.isControlled
              ? `<span style="color:#b91c1c; font-weight:700;">CONTROLLED (S2)</span>`
              : `<span style="color:#64748b;">Regular</span>`;
            const patient = [
              escapeHtml(r.patientName),
              r.patientHrn ? `<span style="color:#64748b;"> &middot; ${escapeHtml(r.patientHrn)}</span>` : "",
            ].join("");
            return `
              <tr>
                <td class="num">${idx + 1}</td>
                <td><span class="doc-no">${escapeHtml(r.rxNo)}</span></td>
                <td>${patient}</td>
                <td>${escapeHtml(r.prescriberName)}</td>
                <td>${escapeHtml(r.visitNo ?? "—")}</td>
                <td class="num">${escapeHtml(r.itemCount)}</td>
                <td>${classCell}</td>
                <td>${escapeHtml(r.issuedAt ?? "—")}</td>
              </tr>`;
          })
          .join("");

  const body = `
    <header>
      <table style="width:100%; border:none; margin:0;">
        <tr>
          <td style="border:none; padding:0; vertical-align:top;">
            <div class="clinic">${escapeHtml(doc.clinicName)}</div>
            <h1 style="margin-top:1mm;">PRESCRIPTION VERIFICATION QUEUE</h1>
            <div class="muted">
              ${[doc.branchName, doc.clinicAddress].filter(Boolean).map(escapeHtml).join(" &middot; ")}
            </div>
          </td>
          <td style="border:none; padding:0; vertical-align:top; text-align:right;">
            <div class="field"><div class="k">Queue Status</div><div class="v doc-no">${escapeHtml(doc.status)}</div></div>
            <div class="muted">Entries: ${escapeHtml(doc.rows.length)}</div>
          </td>
        </tr>
      </table>
    </header>

    <div class="grid" style="margin-bottom:4mm;">
      ${field("Generated", doc.generatedAt)}
      ${field("Generated by", doc.generatedBy ?? "—")}
    </div>

    <table>
      <thead>
        <tr>
          <th class="num" style="width:8mm;">#</th>
          <th>Rx No</th>
          <th>Patient</th>
          <th>Prescriber</th>
          <th>Visit</th>
          <th class="num">Items</th>
          <th>Classification</th>
          <th>Issued</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Rx Queue (${escapeHtml(doc.status)})</span>
      <span>EMR Document &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell(`Rx Queue ${doc.status}`, body);
}

export interface ConsumptionListDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  locationName?: string;
  fromDate?: string;
  toDate?: string;
  generatedAt: string;
  generatedBy?: string;
  notes?: string;
  rows: Array<{
    loggedAt: string;
    itemCode?: string | null;
    itemName: string;
    qty: number | string;
    uom?: string | null;
    locationName?: string | null;
    refType?: string | null;
    refId?: string | null;
    notes?: string | null;
    loggedBy?: string | null;
  }>;
}

/**
 * Supply consumption / issuance list.
 *
 * Mirrors the append-only `consumption_logs` rows for a period so the store
 * can file a signed-off printed register.
 */
export function renderConsumptionListHtml(doc: ConsumptionListDocument): string {
  const total = doc.rows.reduce((sum, r) => {
    const n = typeof r.qty === "number" ? r.qty : Number.parseFloat(String(r.qty));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const rows =
    doc.rows.length === 0
      ? `<tr><td colspan="8" style="text-align:center; color:#64748b; font-style:italic; padding:6mm 0;">No consumption recorded for this period.</td></tr>`
      : doc.rows
          .map((r, idx) => `
              <tr>
                <td class="num">${idx + 1}</td>
                <td>${escapeHtml(r.loggedAt)}</td>
                <td>
                  ${r.itemCode ? `<span class="doc-no">${escapeHtml(r.itemCode)}</span> ` : ""}${escapeHtml(r.itemName)}
                </td>
                <td class="num">${escapeHtml(qty(r.qty))}</td>
                <td>${escapeHtml(r.uom ?? "—")}</td>
                <td>${escapeHtml(r.locationName ?? "—")}</td>
                <td>${escapeHtml(r.refType ?? "—")}${r.refId ? ` <span class="muted">${escapeHtml(r.refId)}</span>` : ""}</td>
                <td>${escapeHtml(r.notes ?? "")}</td>
              </tr>`)
          .join("");

  const period =
    doc.fromDate || doc.toDate
      ? `${escapeHtml(doc.fromDate ?? "—")} to ${escapeHtml(doc.toDate ?? "—")}`
      : "All dates";

  const body = `
    <header>
      <table style="width:100%; border:none; margin:0;">
        <tr>
          <td style="border:none; padding:0; vertical-align:top;">
            <div class="clinic">${escapeHtml(doc.clinicName)}</div>
            <h1 style="margin-top:1mm;">SUPPLY CONSUMPTION / ISSUANCE LIST</h1>
            <div class="muted">
              ${[doc.branchName, doc.locationName].filter(Boolean).map(escapeHtml).join(" &middot; ")}
            </div>
            ${doc.clinicAddress ? `<div class="muted" style="font-size:8pt; margin-top:0.5mm;">${escapeHtml(doc.clinicAddress)}${doc.clinicPhone ? ` &middot; Tel: ${escapeHtml(doc.clinicPhone)}` : ""}${doc.clinicEmail ? ` &middot; ${escapeHtml(doc.clinicEmail)}` : ""}</div>` : ""}
          </td>
          <td style="border:none; padding:0; vertical-align:top; text-align:right;">
            <div class="field"><div class="k">Period</div><div class="v">${period}</div></div>
            <div class="muted">Lines: ${escapeHtml(doc.rows.length)}</div>
          </td>
        </tr>
      </table>
    </header>

    <div class="grid" style="margin-bottom:4mm;">
      ${field("Location", doc.locationName ?? "All locations")}
      ${field("Generated", doc.generatedAt)}
    </div>

    <table>
      <thead>
        <tr>
          <th class="num" style="width:8mm;">#</th>
          <th>Date</th>
          <th>Item</th>
          <th class="num">Qty</th>
          <th>Unit</th>
          <th>Location</th>
          <th>Purpose</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${
      doc.rows.length > 0
        ? `<div class="totals">
             <div><span>Total lines</span><span>${escapeHtml(doc.rows.length)}</span></div>
             <div class="grand"><span>Total issued</span><span>${escapeHtml(qty(total))}</span></div>
           </div>`
        : ""
    }

    ${doc.notes ? `<div style="margin-top:3mm; font-size:8.5pt; color:#475569; background:#f8fafc; padding:2mm 3mm; border-radius:3px;"><strong>Notes / Remarks:</strong> ${escapeHtml(doc.notes)}</div>` : ""}

    ${
      doc.generatedBy
        ? `<div class="sig"><div class="sig-line">Prepared by ${escapeHtml(doc.generatedBy)}</div></div>`
        : ""
    }

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Consumption / Issuance List</span>
      <span>EMR Document &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell("Consumption Issuance List", body);
}

// ── Goods Receipt Note (GRN) & Supply Receiving ────────────────────────────

export interface GrnLineItemDocument {
  itemCode?: string | null;
  itemName: string;
  lotNo: string;
  expiryDate: string;
  qtyReceived: number | string;
  qtyAccepted?: number | string | null;
  qtyRejected?: number | string | null;
  uom: string;
  unitCost?: number | string | null;
  totalCost?: number | string | null;
  inspectionResult?: string | null;
  rejectionReason?: string | null;
  overrideReason?: string | null;
}

export interface GrnDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  grnNo: string;
  receivedAt: string;
  supplierName: string;
  locationName: string;
  deliveryNoteNo?: string | null;
  poNo?: string | null;
  receivedBy?: string | null;
  verifiedBy?: string | null;
  status: string;
  temperatureCelsius?: number | string | null;
  temperatureOk?: boolean;
  inspectionNotes?: string | null;
  lines: GrnLineItemDocument[];
  totalAmount?: number | string | null;
  notes?: string | null;
  verificationHash?: string | null;
}

/**
 * Official Goods Receipt Note (GRN) vector printout.
 *
 * Provides legal warehouse receiving documentation with lot tracking,
 * expiration dates, quality inspection status, unit valuation, and dual signoff.
 */
export function renderGrnHtml(doc: GrnDocument): string {
  const totalQty = doc.lines.reduce((sum, l) => {
    const n = typeof l.qtyReceived === "number" ? l.qtyReceived : Number.parseFloat(String(l.qtyReceived));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const calculatedTotalAmount = doc.lines.reduce((sum, l) => {
    if (l.totalCost != null) {
      const tc = typeof l.totalCost === "number" ? l.totalCost : Number.parseFloat(String(l.totalCost));
      return sum + (Number.isFinite(tc) ? tc : 0);
    }
    const q = typeof l.qtyReceived === "number" ? l.qtyReceived : Number.parseFloat(String(l.qtyReceived));
    const u = typeof l.unitCost === "number" ? l.unitCost : Number.parseFloat(String(l.unitCost ?? 0));
    return sum + (Number.isFinite(q) && Number.isFinite(u) ? q * u : 0);
  }, 0);

  const finalAmount = doc.totalAmount != null ? doc.totalAmount : calculatedTotalAmount;

  const rows =
    doc.lines.length === 0
      ? `<tr><td colspan="8" style="text-align:center; color:#64748b; font-style:italic; padding:6mm 0;">No items on this goods receipt note.</td></tr>`
      : doc.lines
          .map((l, idx) => {
            const cost = l.unitCost != null ? Number(l.unitCost) : null;
            const lineTotal =
              l.totalCost != null
                ? Number(l.totalCost)
                : cost != null
                ? Number(l.qtyReceived) * cost
                : null;
            const pass = l.inspectionResult === "PASS";
            const badgeColor = pass ? "#166534" : "#9a3412";
            const badgeBg = pass ? "#dcfce7" : "#ffedd5";

            return `<tr>
              <td class="num">${idx + 1}</td>
              <td>
                ${l.itemCode ? `<span class="doc-no" style="font-size:8pt;">${escapeHtml(l.itemCode)}</span> ` : ""}<strong style="color:#0f172a;">${escapeHtml(l.itemName)}</strong>
                ${l.overrideReason ? `<div style="font-size:7.5pt; color:#b45309; margin-top:0.5mm;">Override: ${escapeHtml(l.overrideReason)}</div>` : ""}
                ${l.rejectionReason ? `<div style="font-size:7.5pt; color:#dc2626; margin-top:0.5mm;">Reason: ${escapeHtml(l.rejectionReason)}</div>` : ""}
              </td>
              <td><code>${escapeHtml(l.lotNo)}</code></td>
              <td>${escapeHtml(l.expiryDate ? String(l.expiryDate).slice(0, 10) : "—")}</td>
              <td class="num" style="font-weight:600;">${escapeHtml(qty(l.qtyReceived))} ${escapeHtml(l.uom)}</td>
              <td class="num">${cost != null ? money(cost) : "—"}</td>
              <td class="num" style="font-weight:600;">${lineTotal != null ? money(lineTotal) : "—"}</td>
              <td style="text-align:center;">
                <span style="display:inline-block; font-size:7.5pt; font-weight:700; color:${badgeColor}; background:${badgeBg}; padding:0.5mm 2mm; border-radius:3px;">
                  ${escapeHtml(l.inspectionResult || "RECEIVED")}
                </span>
              </td>
            </tr>`;
          })
          .join("");

  const statusTone = doc.status === "POSTED" ? "#15803d" : doc.status === "VOID" ? "#dc2626" : "#0284c7";

  const body = `
    <header style="border-bottom: 2pt solid #0f2942; padding-bottom: 4mm; margin-bottom: 4mm;">
      <table style="width:100%; border:none; margin:0;">
        <tr>
          <td style="border:none; padding:0; vertical-align:top;">
            <div class="clinic" style="font-size: 15pt; font-weight: 800; color: #0f2942; letter-spacing: -0.2pt; text-transform: uppercase;">${escapeHtml(doc.clinicName)}</div>
            ${doc.branchName ? `<div style="font-size: 9.5pt; font-weight: 600; color: #0284c7; text-transform: uppercase; margin-top: 1mm;">${escapeHtml(doc.branchName)}</div>` : ""}
            ${doc.clinicAddress ? `<div class="muted" style="font-size: 8.5pt; color: #64748b; margin-top: 0.5mm;">${escapeHtml(doc.clinicAddress)}${doc.clinicPhone ? ` &middot; Tel: ${escapeHtml(doc.clinicPhone)}` : ""}${doc.clinicEmail ? ` &middot; ${escapeHtml(doc.clinicEmail)}` : ""}</div>` : ""}
          </td>
          <td style="border:none; padding:0; vertical-align:top; text-align:right; width:220px;">
            <div style="display: inline-block; background: #0f2942; color: #fff; font-size: 9pt; font-weight: 700; padding: 1.5mm 3.5mm; border-radius: 4px; letter-spacing: 0.5pt;">
              GOODS RECEIPT NOTE (GRN)
            </div>
            <div class="doc-no" style="font-family: Consolas, monospace; font-size: 11pt; font-weight: 800; color: #0f172a; margin-top: 2mm;">${escapeHtml(doc.grnNo)}</div>
            <div style="font-size: 8.5pt; color: #64748b; margin-top: 0.5mm;">Date: ${escapeHtml(doc.receivedAt ? String(doc.receivedAt).slice(0, 10) : "")}</div>
            <div style="margin-top: 1.5mm;"><span style="display: inline-block; font-size: 8pt; font-weight: 800; color: ${statusTone}; border: 1pt solid ${statusTone}; padding: 0.5mm 2.5mm; border-radius: 3px; text-transform: uppercase;">${escapeHtml(doc.status)}</span></div>
          </td>
        </tr>
      </table>
    </header>

    <div class="grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm 5mm; margin-bottom: 4mm; background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 4px; padding: 3mm 4mm;">
      ${field("Supplier", doc.supplierName)}
      ${field("Receiving Store", doc.locationName)}
      ${field("Delivery Note / DR #", doc.deliveryNoteNo || "—")}
      ${field("Purchase Order #", doc.poNo || "—")}
      ${field("Received By", doc.receivedBy || "Warehouse Staff")}
      ${field("Cold Chain / Temp", doc.temperatureCelsius != null ? `${escapeHtml(doc.temperatureCelsius)} °C (${doc.temperatureOk === false ? "DEFECTIVE" : "PASSED"})` : "Ambient (Controlled)")}
    </div>

    ${doc.inspectionNotes ? `<div style="margin-bottom:3mm; font-size:8.5pt; color:#334155; background:#f1f5f9; padding:2mm 3mm; border-radius:3px;"><strong>Receiving Inspection Notes:</strong> ${escapeHtml(doc.inspectionNotes)}</div>` : ""}

    <table>
      <thead>
        <tr>
          <th class="num" style="width:7mm;">#</th>
          <th>Item Description</th>
          <th>Lot / Batch #</th>
          <th>Expiry</th>
          <th class="num">Qty</th>
          <th class="num">Unit Cost</th>
          <th class="num">Total Cost</th>
          <th style="text-align:center;">Inspection</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals" style="margin-top: 4mm; margin-left: auto; width: 75mm; background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 4px; padding: 2.5mm 3.5mm;">
      <div><span style="color:#64748b;">Total Line Items</span><span>${escapeHtml(doc.lines.length)}</span></div>
      <div><span style="color:#64748b;">Total Units Received</span><span>${escapeHtml(qty(totalQty))}</span></div>
      <div class="grand" style="border-top:1.5pt solid #0f2942; margin-top:2mm; padding-top:2mm; font-size:11pt; font-weight:800; color:#0f2942;"><span>Total Valuation</span><span>${money(finalAmount)}</span></div>
    </div>

    ${doc.notes ? `<div style="margin-top:3mm; font-size:8.5pt; color:#475569; background:#f8fafc; padding:2mm 3mm; border-radius:3px;"><strong>Remarks:</strong> ${escapeHtml(doc.notes)}</div>` : ""}

    <div style="margin-top: 8mm; display: flex; justify-content: space-between;">
      <div style="width: 65mm;">
        <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8.5pt; color: #334155; text-align: center;">
          Received By: <strong>${escapeHtml(doc.receivedBy || "Receiving Officer")}</strong>
          <div style="font-size: 7.5pt; color: #64748b;">Central Supply &amp; Materials Management</div>
        </div>
      </div>
      <div style="width: 65mm;">
        <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8.5pt; color: #334155; text-align: center;">
          Inspected &amp; Verified By: <strong>${escapeHtml(doc.verifiedBy || "Quality / QA Officer")}</strong>
          <div style="font-size: 7.5pt; color: #64748b;">Pharmacist-in-Charge / Store Supervisor</div>
        </div>
      </div>
    </div>

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Goods Receipt Note &middot; ${escapeHtml(doc.grnNo)}${doc.verificationHash ? ` &middot; Hash: ${escapeHtml(doc.verificationHash.slice(0, 16))}…` : ""}</span>
      <span>EMR Document &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell(`Goods Receipt Note ${doc.grnNo}`, body);
}

// ── Department Requisitions & Store Transfers ──────────────────────────────

export interface RequisitionLineItemDocument {
  itemCode?: string | null;
  itemName: string;
  qtyRequested: number | string;
  qtyIssued?: number | string | null;
  qtyReceived?: number | string | null;
  uom: string;
  notes?: string | null;
}

export interface RequisitionDocument {
  clinicName: string;
  branchName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  reqNo: string;
  createdAt: string;
  fromLocation: string;
  toLocation: string;
  requestedBy?: string | null;
  approvedBy?: string | null;
  issuedBy?: string | null;
  receivedBy?: string | null;
  status: string;
  neededBy?: string | null;
  notes?: string | null;
  lines: RequisitionLineItemDocument[];
  verificationHash?: string | null;
}

export function renderRequisitionHtml(doc: RequisitionDocument): string {
  const rows =
    doc.lines.length === 0
      ? `<tr><td colspan="6" style="text-align:center; color:#64748b; font-style:italic; padding:6mm 0;">No items on this requisition slip.</td></tr>`
      : doc.lines
          .map(
            (l, idx) => `<tr>
        <td class="num">${idx + 1}</td>
        <td>
          ${l.itemCode ? `<span class="doc-no" style="font-size:8pt;">${escapeHtml(l.itemCode)}</span> ` : ""}<strong style="color:#0f172a;">${escapeHtml(l.itemName)}</strong>
          ${l.notes ? `<div style="font-size:7.5pt; color:#64748b; margin-top:0.5mm;">${escapeHtml(l.notes)}</div>` : ""}
        </td>
        <td class="num" style="font-weight:600;">${escapeHtml(qty(l.qtyRequested))} ${escapeHtml(l.uom)}</td>
        <td class="num">${l.qtyIssued != null ? `${escapeHtml(qty(l.qtyIssued))} ${escapeHtml(l.uom)}` : "—"}</td>
        <td class="num">${l.qtyReceived != null ? `${escapeHtml(qty(l.qtyReceived))} ${escapeHtml(l.uom)}` : "—"}</td>
        <td style="font-size:8pt; color:#64748b;">${l.notes ? escapeHtml(l.notes) : "—"}</td>
      </tr>`
          )
          .join("");

  const statusTone = doc.status === "ACKNOWLEDGED" ? "#15803d" : doc.status === "DISCREPANCY" ? "#dc2626" : "#0284c7";

  const body = `
    <header style="border-bottom: 2pt solid #0f2942; padding-bottom: 4mm; margin-bottom: 4mm;">
      <table style="width:100%; border:none; margin:0;">
        <tr>
          <td style="border:none; padding:0; vertical-align:top;">
            <div class="clinic" style="font-size: 15pt; font-weight: 800; color: #0f2942; letter-spacing: -0.2pt; text-transform: uppercase;">${escapeHtml(doc.clinicName)}</div>
            ${doc.branchName ? `<div style="font-size: 9.5pt; font-weight: 600; color: #0284c7; text-transform: uppercase; margin-top: 1mm;">${escapeHtml(doc.branchName)}</div>` : ""}
            ${doc.clinicAddress ? `<div class="muted" style="font-size: 8.5pt; color: #64748b; margin-top: 0.5mm;">${escapeHtml(doc.clinicAddress)}${doc.clinicPhone ? ` &middot; Tel: ${escapeHtml(doc.clinicPhone)}` : ""}</div>` : ""}
          </td>
          <td style="border:none; padding:0; vertical-align:top; text-align:right; width:220px;">
            <div style="display: inline-block; background: #0f2942; color: #fff; font-size: 9pt; font-weight: 700; padding: 1.5mm 3.5mm; border-radius: 4px; letter-spacing: 0.5pt;">
              DEPARTMENT REQUISITION SLIP
            </div>
            <div class="doc-no" style="font-family: Consolas, monospace; font-size: 11pt; font-weight: 800; color: #0f172a; margin-top: 2mm;">${escapeHtml(doc.reqNo)}</div>
            <div style="font-size: 8.5pt; color: #64748b; margin-top: 0.5mm;">Date: ${escapeHtml(doc.createdAt ? String(doc.createdAt).slice(0, 10) : "")}</div>
            <div style="margin-top: 1.5mm;"><span style="display: inline-block; font-size: 8pt; font-weight: 800; color: ${statusTone}; border: 1pt solid ${statusTone}; padding: 0.5mm 2.5mm; border-radius: 3px; text-transform: uppercase;">${escapeHtml(doc.status)}</span></div>
          </td>
        </tr>
      </table>
    </header>

    <div class="grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 2mm 5mm; margin-bottom: 4mm; background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 4px; padding: 3mm 4mm;">
      ${field("Requesting Department", doc.fromLocation)}
      ${field("Supplying Store", doc.toLocation)}
      ${field("Requested By", doc.requestedBy || "Department Staff")}
      ${field("Required By Date", doc.neededBy ? String(doc.neededBy).slice(0, 10) : "Immediate / Routine")}
    </div>

    <table>
      <thead>
        <tr>
          <th class="num" style="width:7mm;">#</th>
          <th>Item Description</th>
          <th class="num">Requested</th>
          <th class="num">Issued</th>
          <th class="num">Received</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${doc.notes ? `<div style="margin-top:3mm; font-size:8.5pt; color:#475569; background:#f8fafc; padding:2mm 3mm; border-radius:3px;"><strong>Notes / Justification:</strong> ${escapeHtml(doc.notes)}</div>` : ""}

    <div style="margin-top: 8mm; display: flex; justify-content: space-between;">
      <div style="width: 50mm;">
        <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8pt; color: #334155; text-align: center;">
          Requested By: <strong>${escapeHtml(doc.requestedBy || "Department Staff")}</strong>
        </div>
      </div>
      <div style="width: 50mm;">
        <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8pt; color: #334155; text-align: center;">
          Approved By: <strong>${escapeHtml(doc.approvedBy || "Supervisor")}</strong>
        </div>
      </div>
      <div style="width: 50mm;">
        <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8pt; color: #334155; text-align: center;">
          Issued By: <strong>${escapeHtml(doc.issuedBy || "Storekeeper")}</strong>
        </div>
      </div>
      <div style="width: 50mm;">
        <div style="border-top: 0.5pt solid #475569; padding-top: 1.5mm; font-size: 8pt; color: #334155; text-align: center;">
          Received By: <strong>${escapeHtml(doc.receivedBy || "Conforme")}</strong>
        </div>
      </div>
    </div>

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Requisition Slip &middot; ${escapeHtml(doc.reqNo)}</span>
      <span>EMR Document &middot; Page 1 of 1</span>
    </footer>
  `;

  return shell(`Requisition Slip ${doc.reqNo}`, body);
}


// ── Pharmacy dispense label (Rx bottle / bag label) ─────────────────────────

/**
 * Content of one printed dispense label, mirroring `getDispenseLabel`'s
 * `labels[]` rows so the API can reuse the exact values it already returns
 * (the same data also renders as ZPL for thermal printers — this template is
 * the A4/A5 sheet counterpart for ordinary printers).
 */
export interface DispenseLabelItem {
  drugName: string;
  genericName?: string;
  strength?: string;
  dosageForm?: string;
  directionsForUse: string;
  quantity: number | string;
  batchNo?: string;
  expiryDate?: string;
}

export interface DispenseLabelDocument {
  clinicName: string;
  branchName?: string;
  dispenseNo: string;
  dispensedAt: string;
  patientName: string;
  patientHrn?: string;
  patientDob?: string;
  pharmacistName?: string;
  specialRxSerial?: string;
  items: DispenseLabelItem[];
}

/**
 * Rx container labels (PHM-T3): one bordered label box per dispensed item,
 * sized to cut-and-fold onto a bottle or bag. Printed as part of the official
 * PDF pipeline (deterministic bytes + SHA-256), never a browser print of the
 * workbench screen.
 */
export function renderDispenseLabelHtml(doc: DispenseLabelDocument): string {
  const labelBoxes = doc.items
    .map((item) => {
      const meta = [
        item.strength,
        item.dosageForm,
      ]
        .filter(Boolean)
        .map((v) => escapeHtml(v))
        .join(" &middot; ");
      return `
      <div class="rx-label-box">
        <div class="rx-label-clinic">${escapeHtml(doc.clinicName)}${doc.branchName ? ` &mdash; ${escapeHtml(doc.branchName)}` : ""}</div>
        <div class="rx-label-patient">
          ${escapeHtml(doc.patientName)}${doc.patientHrn ? ` &middot; HRN ${escapeHtml(doc.patientHrn)}` : ""}
        </div>
        <div class="rx-label-drug">
          <strong>${escapeHtml(item.drugName)}</strong>${meta ? `<span class="rx-label-meta">${meta}</span>` : ""}
          ${item.genericName ? `<div class="rx-label-generic">Generic: ${escapeHtml(item.genericName)}</div>` : ""}
        </div>
        <div class="rx-label-sig">${escapeHtml(item.directionsForUse)}</div>
        <div class="rx-label-meta-row">
          <span>Qty: <strong>${escapeHtml(item.quantity)}</strong></span>
          ${item.batchNo ? `<span>Lot: ${escapeHtml(item.batchNo)}</span>` : ""}
          ${item.expiryDate ? `<span>Exp: ${escapeHtml(item.expiryDate)}</span>` : ""}
        </div>
        <div class="rx-label-footer">
          ${escapeHtml(doc.dispenseNo)} &middot; ${escapeHtml(doc.dispensedAt)}
          ${doc.pharmacistName ? ` &middot; RPh: ${escapeHtml(doc.pharmacistName)}` : ""}
        </div>
        ${doc.specialRxSerial ? `<div class="rx-label-s2">S2 Serial: ${escapeHtml(doc.specialRxSerial)}</div>` : ""}
      </div>`;
    })
    .join("");

  const body = `
    <header>
      <div class="clinic">${escapeHtml(doc.clinicName)}${doc.branchName ? ` &mdash; ${escapeHtml(doc.branchName)}` : ""}</div>
      <div class="doc-no">Dispense No. ${escapeHtml(doc.dispenseNo)}</div>
      <div class="muted">Medication container labels &middot; dispensed ${escapeHtml(doc.dispensedAt)}</div>
    </header>
    <div class="grid">
      ${field("Patient", doc.patientName)}
      ${doc.patientHrn ? field("HRN", doc.patientHrn) : ""}
      ${doc.patientDob ? field("Date of birth", doc.patientDob) : ""}
      ${doc.pharmacistName ? field("Dispensed by", doc.pharmacistName) : ""}
    </div>
    ${labelBoxes}
    ${
      doc.specialRxSerial
        ? `<p class="muted">Dangerous drug dispensed under S2 serial ${escapeHtml(
            doc.specialRxSerial,
          )} (RA 9165). Attach the corresponding register entry.</p>`
        : ""
    }
    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Dispense ${escapeHtml(doc.dispenseNo)}</span>
      <span>Keep all medicines out of reach of children.</span>
    </footer>
  `;

  const LABEL_CSS = `
    .rx-label-box {
      border: 1.2pt solid #111; border-radius: 2mm;
      padding: 3mm 4mm; margin: 3mm 0; break-inside: avoid;
    }
    .rx-label-clinic { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4pt; }
    .rx-label-patient { font-size: 10pt; margin-top: 1mm; }
    .rx-label-drug { margin-top: 1.5mm; font-size: 11pt; }
    .rx-label-meta { color: #444; font-size: 9pt; margin-left: 2mm; }
    .rx-label-generic { font-size: 8.5pt; color: #555; }
    .rx-label-sig {
      margin-top: 1.5mm; font-size: 10.5pt; font-weight: 600;
      border-top: 0.5pt dotted #999; border-bottom: 0.5pt dotted #999; padding: 1.5mm 0;
    }
    .rx-label-meta-row {
      display: flex; gap: 6mm; margin-top: 1.5mm; font-size: 9pt;
      font-variant-numeric: tabular-nums;
    }
    .rx-label-footer { margin-top: 1.5mm; font-size: 8pt; color: #555; }
    .rx-label-s2 { margin-top: 1mm; font-size: 8.5pt; color: #b45309; font-weight: 700; }
  `.trim();

  return shellForLabel(`Dispense ${doc.dispenseNo}`, LABEL_CSS, body);
}

/** Same document shell as `shell()` but with template-specific extra CSS. */
function shellForLabel(title: string, extraCss: string, body: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${BASE_CSS}${extraCss}</style>`,
    `</head><body>${body}</body></html>`,
  ].join("");
}

// ── Dangerous Drugs Book (RA 9165, AC-7, RPT-PHM-03) ────────────────────────

/** One line of the Dangerous Drugs Book, as entered in the append-only register. */
export interface DangerousDrugsBookRow {
  /** Transaction date and time, as recorded on the register entry. */
  occurredAt: string;
  entryType: "RECEIPT" | "DISPENSE" | "ADJUSTMENT" | "DISPOSAL";
  drugName: string;
  strength?: string | null;
  dosageForm?: string | null;
  batchNo?: string | null;
  expiryDate?: string | null;
  qtyIn: number;
  qtyOut: number;
  /** Book balance carried forward after this entry. */
  runningBalance: number;
  patientName?: string | null;
  patientHrn?: string | null;
  rxNo?: string | null;
  /** S2 yellow-slip serial for a controlled prescription. */
  specialRxSerial?: string | null;
  /** Prescriber's S2 licence number, required by RA 9165 for Schedule II. */
  prescriberS2No?: string | null;
  pharmacistName: string;
  /** The witness is mandatory for a controlled entry; the name is never optional. */
  witnessName: string;
  witnessSignature?: string | null;
  notes?: string | null;
}

export interface DangerousDrugsBookDocument {
  clinicName: string;
  branchName?: string;
  /** Filter the book was produced under, stated so the filing copy is unambiguous. */
  drugFilter?: string;
  fromDate?: string;
  toDate?: string;
  generatedAt: string;
  generatedBy?: string;
  /** Book balance at the close of the printed period, per drug. */
  closingBalances: Array<{
    drugName: string;
    runningBalance: number;
  }>;
  rows: DangerousDrugsBookRow[];
}

/**
 * Dangerous Drugs Book for the controlled register (RA 9165 §13, AC-7).
 *
 * Unlike the operational lists this is a statutory record, so each line keeps
 * the counterparty evidence that makes an entry auditable: the patient and
 * prescription for a dispense, the S2 slip and prescriber licence for a
 * controlled prescription, and the pharmacist plus witness who handled it. A
 * dispense line with no patient or no witness is an incomplete entry, so those
 * cells are rendered as an explicit gap rather than left blank.
 */
export function renderDangerousDrugsBookHtml(doc: DangerousDrugsBookDocument): string {
  const ENTRY_LABEL: Record<DangerousDrugsBookRow["entryType"], string> = {
    RECEIPT: "RECEIPT",
    DISPENSE: "DISPENSE",
    ADJUSTMENT: "ADJUSTMENT",
    DISPOSAL: "DISPOSAL",
  };

  const rows = doc.rows
    .map((r) => {
      const isDispense = r.entryType === "DISPENSE";
      const drugMeta = [r.strength, r.dosageForm].filter(Boolean).map(escapeHtml).join(" · ");
      return `
      <tr class="${isDispense ? "ddb-out" : "ddb-in"}">
        <td class="mono">${escapeHtml(r.occurredAt)}</td>
        <td><span class="ddb-type">${escapeHtml(ENTRY_LABEL[r.entryType] ?? r.entryType)}</span></td>
        <td>
          <strong>${escapeHtml(r.drugName)}</strong>
          ${drugMeta ? `<div class="sub">${drugMeta}</div>` : ""}
          ${r.batchNo ? `<div class="sub">Lot ${escapeHtml(r.batchNo)}${r.expiryDate ? ` · Exp ${escapeHtml(r.expiryDate)}` : ""}</div>` : ""}
        </td>
        <td class="num">${r.qtyIn ? escapeHtml(r.qtyIn) : "—"}</td>
        <td class="num">${r.qtyOut ? escapeHtml(r.qtyOut) : "—"}</td>
        <td class="num"><strong>${escapeHtml(r.runningBalance)}</strong></td>
        <td>
          ${
            isDispense
              ? `${escapeHtml(r.patientName ?? "NOT RECORDED")}${
                  r.patientHrn ? ` <span class="sub">HRN ${escapeHtml(r.patientHrn)}</span>` : ""
                }
                ${
                  r.patientName
                    ? ""
                    : '<div class="gap">No patient recorded for this dispense</div>'
                }`
              : '<span class="muted">—</span>'
          }
        </td>
        <td>
          ${
            isDispense
              ? `${escapeHtml(r.rxNo ?? "—")}
                 ${r.specialRxSerial ? `<div class="sub">S2 ${escapeHtml(r.specialRxSerial)}</div>` : '<div class="gap">No S2 serial</div>'}
                 ${r.prescriberS2No ? `<div class="sub">Licence ${escapeHtml(r.prescriberS2No)}</div>` : ""}`
              : '<span class="muted">—</span>'
          }
        </td>
        <td>
          ${escapeHtml(r.pharmacistName)}
          <div class="sub">Witness: ${escapeHtml(r.witnessName)}</div>
          ${r.witnessSignature ? `<div class="sub">Signed: ${escapeHtml(r.witnessSignature)}</div>` : ""}
          ${r.notes ? `<div class="sub">${escapeHtml(r.notes)}</div>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  const closing = doc.closingBalances
    .map(
      (c) =>
        `<tr><td><strong>${escapeHtml(c.drugName)}</strong></td><td class="num"><strong>${escapeHtml(
          c.runningBalance,
        )}</strong></td></tr>`,
    )
    .join("");

  const DDB_CSS = `
    table.ddb { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    table.ddb th, table.ddb td { border: 0.5pt solid #bbb; padding: 1.4mm 1.2mm; vertical-align: top; text-align: left; }
    table.ddb th { background: #f1f1f1; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.3pt; }
    table.ddb td.num, table.ddb th.num { text-align: right; font-variant-numeric: tabular-nums; }
    table.ddb td.mono { font-family: ui-monospace, monospace; white-space: nowrap; }
    table.ddb tr.ddb-in td:first-child { border-left: 2pt solid #1b6b3a; }
    table.ddb tr.ddb-out td:first-child { border-left: 2pt solid #b45309; }
    table.ddb .sub { color: #555; font-size: 7.5pt; }
    table.ddb .gap { color: #b91c1c; font-size: 7.5pt; font-weight: 700; }
    .ddb-type { font-weight: 700; letter-spacing: 0.3pt; }
    .ddb-closing { width: auto; margin-top: 4mm; font-size: 8.5pt; }
    .ddb-closing th, .ddb-closing td { border: 0.5pt solid #bbb; padding: 1.2mm 2.5mm; text-align: left; }
    .ddb-closing td.num { text-align: right; }
    .ddb-note { font-size: 8pt; color: #444; margin-top: 3mm; }
    thead { display: table-header-group; }
  `.trim();

  const body = `
    <header>
      <div class="clinic">${escapeHtml(doc.clinicName)}${doc.branchName ? ` — ${escapeHtml(doc.branchName)}` : ""}</div>
      <h1>DANGEROUS DRUGS BOOK</h1>
      <div class="doc-no">${escapeHtml(doc.generatedAt)}</div>
    </header>
    <div class="grid">
      ${doc.drugFilter ? field("Drug", doc.drugFilter) : ""}
      ${field("Period from", doc.fromDate ?? "Beginning of register")}
      ${field("Period to", doc.toDate ?? "Current")}
      ${field("Printed", doc.generatedAt)}
      ${doc.generatedBy ? field("Printed by", doc.generatedBy) : ""}
    </div>
    ${
      doc.rows.length === 0
        ? '<p class="muted">No controlled-register entries were recorded for this period.</p>'
        : `<table class="ddb">
            <thead>
              <tr>
                <th>Date / time</th>
                <th>Entry</th>
                <th>Drug</th>
                <th class="num">In</th>
                <th class="num">Out</th>
                <th class="num">Balance</th>
                <th>Patient</th>
                <th>Prescription</th>
                <th>Handled by</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
    }
    ${
      doc.closingBalances.length > 0
        ? `<table class="ddb-closing">
            <thead><tr><th>Drug</th><th class="num">Book balance at close</th></tr></thead>
            <tbody>${closing}</tbody>
          </table>`
        : ""
    }
    <p class="ddb-note">
      Controlled-drug movements are recorded in an append-only register: an entry can
      never be edited or removed, and a correction is made by posting a further entry.
      This book is generated from that register and sealed with a SHA-256 digest, so the
      filed copy can be proven identical to the register it was produced from.
    </p>
    <footer>
      <span>${escapeHtml(doc.clinicName)}</span>
      <span>Dangerous Drugs Book · RA 9165</span>
    </footer>
  `;

  return shellForLabel(`Dangerous Drugs Book ${doc.generatedAt}`, DDB_CSS, body);
}

// ── Financial & Billing Report Templates (M8, specification §11, todo.md §7) ─

export interface PatientStatementInvoiceLine {
  description: string;
  qty: number | string;
  unitPrice: number | string;
  netAmount: number | string;
  isProfessionalFee?: boolean;
}

export interface PatientStatementPayment {
  paymentNo: string;
  amount: number | string;
  receivedAt: string;
  method: string;
}

export interface PatientStatementInvoice {
  invoiceNo: string;
  issuedAt: string;
  dueAt?: string | null;
  status: string;
  total: number | string;
  paidAmount: number | string;
  balance: number | string;
  lines?: PatientStatementInvoiceLine[];
  payments?: PatientStatementPayment[];
}

export interface PatientStatementDocument {
  clinicName: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  generatedAt: string;
  patient: {
    id: string;
    name: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    patientNumber?: string | null;
  };
  summary: {
    totalBilled: number | string;
    totalPaid: number | string;
    totalBalance: number | string;
    aging?: {
      current_0_30: number | string;
      days_31_60: number | string;
      days_61_90: number | string;
      over_90: number | string;
    };
  };
  invoices: PatientStatementInvoice[];
}

/**
 * Patient Statement of Account (SOA).
 * Formal financial statement showing itemized patient invoices, payments, and running balance.
 */
export function renderPatientStatementHtml(doc: PatientStatementDocument): string {
  const invoiceRows = doc.invoices.length === 0
    ? `<tr><td colspan="7" style="text-align:center; color:#64748b; font-style:italic; padding:6mm 0;">No active invoices on record.</td></tr>`
    : doc.invoices.map((inv) => {
        const balanceNum = Number(inv.balance || 0);
        const statusBadge = inv.status === 'PAID'
          ? '<span style="color:#15803d; font-weight:700;">PAID</span>'
          : balanceNum > 0
          ? '<span style="color:#b91c1c; font-weight:700;">UNPAID</span>'
          : `<span style="color:#555;">${escapeHtml(inv.status)}</span>`;

        return `
          <tr>
            <td class="doc-no">${escapeHtml(inv.invoiceNo)}</td>
            <td>${escapeHtml(inv.issuedAt ? String(inv.issuedAt).slice(0, 10) : '—')}</td>
            <td>${escapeHtml(inv.dueAt ? String(inv.dueAt).slice(0, 10) : '—')}</td>
            <td>${statusBadge}</td>
            <td class="num">${money(inv.total)}</td>
            <td class="num" style="color:#15803d;">${money(inv.paidAmount)}</td>
            <td class="num" style="font-weight:700; ${balanceNum > 0 ? 'color:#b91c1c;' : ''}">${money(inv.balance)}</td>
          </tr>
        `;
      }).join('');

  const agingBlock = doc.summary.aging ? `
    <div style="margin-top:4mm; padding:3mm; background:#f8fafc; border:0.5pt solid #cbd5e1; border-radius:1mm;">
      <div style="font-size:8.5pt; font-weight:700; text-transform:uppercase; color:#475569; margin-bottom:1.5mm;">Aging of Accounts Receivable</div>
      <table style="width:100%; border:none; margin:0;">
        <tr>
          <td style="border:none; padding:1mm 2mm;"><span class="muted">0–30 Days (Current):</span> <strong style="color:#15803d;">₱${money(doc.summary.aging.current_0_30)}</strong></td>
          <td style="border:none; padding:1mm 2mm;"><span class="muted">31–60 Days:</span> <strong>₱${money(doc.summary.aging.days_31_60)}</strong></td>
          <td style="border:none; padding:1mm 2mm;"><span class="muted">61–90 Days:</span> <strong style="color:#d97706;">₱${money(doc.summary.aging.days_61_90)}</strong></td>
          <td style="border:none; padding:1mm 2mm;"><span class="muted">Over 90 Days:</span> <strong style="color:#dc2626;">₱${money(doc.summary.aging.over_90)}</strong></td>
        </tr>
      </table>
    </div>
  ` : '';

  const body = `
    <header>
      <table style="width:100%; border:none; margin:0;">
        <tr>
          <td style="border:none; padding:0; vertical-align:top;">
            <div class="clinic">${escapeHtml(doc.clinicName)}</div>
            ${doc.clinicAddress ? `<div class="muted">${escapeHtml(doc.clinicAddress)}</div>` : ''}
            ${doc.clinicPhone ? `<div class="muted">Tel: ${escapeHtml(doc.clinicPhone)}</div>` : ''}
            <h1 style="margin-top:2mm;">STATEMENT OF ACCOUNT</h1>
          </td>
          <td style="border:none; padding:0; vertical-align:top; text-align:right;">
            <div class="field"><div class="k">Statement Date</div><div class="v">${escapeHtml(doc.generatedAt ? String(doc.generatedAt).slice(0, 10) : new Date().toISOString().slice(0, 10))}</div></div>
            <div class="field"><div class="k">Patient ID</div><div class="v doc-no">${escapeHtml(doc.patient.patientNumber || doc.patient.id.slice(0, 8))}</div></div>
          </td>
        </tr>
      </table>
    </header>

    <div class="grid" style="margin-bottom:4mm; border:0.5pt solid #cbd5e1; padding:3mm; background:#fafafa; border-radius:1mm;">
      ${field("Patient Name", doc.patient.name)}
      ${field("Date of Birth", doc.patient.dateOfBirth ? String(doc.patient.dateOfBirth).slice(0, 10) : "—")}
      ${field("Gender / Sex", doc.patient.gender ?? "—")}
      ${field("Account Status", Number(doc.summary.totalBalance || 0) > 0 ? "Outstanding Balance" : "Settled / In Good Standing")}
    </div>

    <table style="margin-bottom:4mm;">
      <thead>
        <tr>
          <th>Invoice #</th>
          <th>Date</th>
          <th>Due Date</th>
          <th>Status</th>
          <th class="num">Total (PHP)</th>
          <th class="num">Paid (PHP)</th>
          <th class="num">Balance (PHP)</th>
        </tr>
      </thead>
      <tbody>${invoiceRows}</tbody>
    </table>

    <div class="totals" style="width:80mm;">
      <div><span>Total Billed</span><span>₱${money(doc.summary.totalBilled)}</span></div>
      <div><span>Total Payments Received</span><span style="color:#15803d;">-₱${money(doc.summary.totalPaid)}</span></div>
      <div class="grand"><span>Total Outstanding Balance</span><span style="color:#b91c1c;">₱${money(doc.summary.totalBalance)}</span></div>
    </div>

    ${agingBlock}

    <div style="margin-top:8mm; font-size:8pt; color:#64748b; line-height:1.4;">
      <p style="margin:0 0 1mm;"><strong>Remittance Notice:</strong> Please present this statement when making payment at the cashier counter or quote your Patient ID for bank / digital payments. For billing inquiries, contact the billing office.</p>
      <p style="margin:0;">This statement is an official computer-generated record from the clinic management system.</p>
    </div>

    <div class="sig" style="margin-top:8mm;">
      <div class="sig-line">Prepared & Verified by Billing Department</div>
    </div>

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Statement of Account &middot; ${escapeHtml(doc.patient.name)}</span>
      <span>Official Medical & Financial Record</span>
    </footer>
  `;

  return shell(`Statement of Account - ${doc.patient.name}`, body);
}

export interface ShiftReportDocument {
  clinicName: string;
  branchName?: string;
  reportType: 'X_REPORT' | 'Z_REPORT';
  title: string;
  timestamp: string;
  shiftNo?: string;
  shiftId: string;
  cashier: string;
  openedAt: string;
  closedAt?: string | null;
  status: string;
  openingCash: number | string;
  countedCash?: number | string | null;
  expectedCash?: number | string | null;
  variance?: number | string | null;
  notes?: string | null;
  metrics?: {
    total_invoiced?: number | string;
    total_discounts?: number | string;
    total_collected?: number | string;
    total_cash?: number | string;
    total_card?: number | string;
    total_ewallet?: number | string;
    total_other?: number | string;
    transaction_count?: number | string;
    void_count?: number | string;
    refund_count?: number | string;
  };
}

/**
 * Cashier Shift Settlement Report (Z-Reading / X-Reading, RPT-BIL-01 / todo.md §7.3).
 */
export function renderShiftReportHtml(doc: ShiftReportDocument): string {
  const m = doc.metrics || {};
  const isZ = doc.reportType === 'Z_REPORT';
  const varNum = Number(doc.variance || 0);

  const varianceDisplay = isZ ? `
    <div style="display:flex; justify-content:space-between; padding:1.5mm 0; border-top:1pt solid #cbd5e1; margin-top:2mm; font-weight:700;">
      <span>Shift Variance:</span>
      <span style="${varNum < 0 ? 'color:#b91c1c;' : varNum > 0 ? 'color:#d97706;' : 'color:#15803d;'}">
        ${varNum === 0 ? '0.00 (BALANCED)' : varNum < 0 ? `-₱${money(Math.abs(varNum))} (SHORTAGE)` : `+₱${money(varNum)} (OVERAGE)`}
      </span>
    </div>
  ` : '';

  const body = `
    <header>
      <div class="clinic">${escapeHtml(doc.clinicName)}${doc.branchName ? ` — ${escapeHtml(doc.branchName)}` : ''}</div>
      <h1 style="margin-top:1mm;">${escapeHtml(doc.title.toUpperCase())}</h1>
      <div class="doc-no">Shift ${escapeHtml(doc.shiftNo || doc.shiftId.slice(0, 8))} &middot; ${escapeHtml(doc.reportType)}</div>
    </header>

    <div class="grid" style="margin-bottom:4mm; border:0.5pt solid #cbd5e1; padding:3mm; background:#fafafa; border-radius:1mm;">
      ${field("Cashier", doc.cashier)}
      ${field("Shift Status", doc.status)}
      ${field("Shift Opened", doc.openedAt ? String(doc.openedAt).slice(0, 19).replace('T', ' ') : '—')}
      ${field("Shift Closed / Generated", doc.closedAt ? String(doc.closedAt).slice(0, 19).replace('T', ' ') : String(doc.timestamp).slice(0, 19).replace('T', ' '))}
    </div>

    <h2>1. Cash Drawer Balancing</h2>
    <div style="max-width:90mm; border:0.5pt solid #bbb; padding:3mm; background:#fff; margin-bottom:5mm;">
      <div style="display:flex; justify-content:space-between; padding:1mm 0;"><span>Opening Float (Cash In):</span><span>₱${money(doc.openingCash)}</span></div>
      <div style="display:flex; justify-content:space-between; padding:1mm 0;"><span>Cash Collections (+):</span><span style="color:#15803d;">₱${money(m.total_cash || 0)}</span></div>
      <div style="display:flex; justify-content:space-between; padding:1mm 0; border-top:0.5pt solid #eee;"><span>Total Expected Drawer Cash:</span><strong style="color:#0f172a;">₱${money(doc.expectedCash ?? (Number(doc.openingCash || 0) + Number(m.total_cash || 0)))}</strong></div>
      ${isZ ? `<div style="display:flex; justify-content:space-between; padding:1mm 0;"><span>Physical Cash Counted:</span><strong>₱${money(doc.countedCash || 0)}</strong></div>` : ''}
      ${varianceDisplay}
    </div>

    <h2>2. Collections Breakdown by Tender</h2>
    <table style="margin-bottom:5mm;">
      <thead>
        <tr>
          <th>Payment Method</th>
          <th class="num">Collected Amount (PHP)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Cash Collections</td><td class="num">₱${money(m.total_cash || 0)}</td></tr>
        <tr><td>Credit / Debit Card (POS Terminal)</td><td class="num">₱${money(m.total_card || 0)}</td></tr>
        <tr><td>Electronic Wallets (GCash / Maya)</td><td class="num">₱${money(m.total_ewallet || 0)}</td></tr>
        <tr><td>Other (Direct Deposit / Cheque / HMO)</td><td class="num">₱${money(m.total_other || 0)}</td></tr>
      </tbody>
      <tfoot>
        <tr style="font-weight:700; background:#f1f5f9;">
          <td>TOTAL NET COLLECTIONS</td>
          <td class="num" style="color:#15803d;">₱${money(m.total_collected || 0)}</td>
        </tr>
      </tfoot>
    </table>

    <h2>3. Activity &amp; Audit Totals</h2>
    <div class="grid" style="margin-bottom:5mm;">
      ${field("Total Invoiced Amount", `₱${money(m.total_invoiced || 0)}`)}
      ${field("Total Discounts Granted", `₱${money(m.total_discounts || 0)}`)}
      ${field("Total Transactions", String(m.transaction_count || 0))}
      ${field("Voided Transactions", String(m.void_count || 0))}
      ${field("Refunds Processed", String(m.refund_count || 0))}
    </div>

    ${doc.notes ? `<div style="margin-bottom:4mm; font-size:9pt;"><span class="muted">Closing Remarks / Variance Note:</span><br><em>${escapeHtml(doc.notes)}</em></div>` : ''}

    <div style="display:flex; justify-content:space-between; margin-top:10mm;">
      <div class="sig-line">Cashier Signature (${escapeHtml(doc.cashier)})</div>
      <div class="sig-line">Audited &amp; Received by (Supervisor)</div>
    </div>

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Cashier Shift Settlement Report</span>
      <span>${escapeHtml(doc.shiftId)} &middot; Deterministic Hash Audit</span>
    </footer>
  `;

  return shell(`${doc.title} - ${doc.shiftNo || doc.shiftId}`, body);
}

export interface ReceivablesAgingRow {
  invoiceNo: string;
  issuedAt: string;
  dueAt?: string | null;
  ageDays: number;
  patientName: string;
  patientNumber?: string;
  branchName?: string;
  payerType?: string;
  total: number | string;
  paidAmount: number | string;
  balance: number | string;
}

export interface ReceivablesAgingDocument {
  clinicName: string;
  branchName?: string;
  asOfDate: string;
  totalReceivables: number | string;
  totalInvoices: number;
  aging: {
    current_0_30: number | string;
    days_31_60: number | string;
    days_61_90: number | string;
    over_90: number | string;
  };
  byPayer?: Record<string, { count: number; balance: number }>;
  items: ReceivablesAgingRow[];
  generatedBy?: string;
}

/**
 * Accounts Receivables & Aging Report (RPT-BIL-03 / todo.md §7.4).
 */
export function renderReceivablesAgingHtml(doc: ReceivablesAgingDocument): string {
  const rows = doc.items.length === 0
    ? `<tr><td colspan="8" style="text-align:center; color:#64748b; font-style:italic; padding:6mm 0;">No outstanding receivables for this period.</td></tr>`
    : doc.items.map((r) => `
        <tr>
          <td class="doc-no">${escapeHtml(r.invoiceNo)}</td>
          <td>${escapeHtml(r.issuedAt ? String(r.issuedAt).slice(0, 10) : '—')}</td>
          <td>${escapeHtml(r.patientName)} <span class="muted">(${escapeHtml(r.patientNumber || '—')})</span></td>
          <td>${escapeHtml(r.payerType || 'PRIVATE_CASH')}</td>
          <td class="num">${escapeHtml(r.ageDays)}d</td>
          <td class="num">${money(r.total)}</td>
          <td class="num">${money(r.paidAmount)}</td>
          <td class="num" style="font-weight:700; color:#b91c1c;">${money(r.balance)}</td>
        </tr>
      `).join('');

  const body = `
    <header>
      <div class="clinic">${escapeHtml(doc.clinicName)}${doc.branchName ? ` — ${escapeHtml(doc.branchName)}` : ''}</div>
      <h1 style="margin-top:1mm;">ACCOUNTS RECEIVABLES &amp; AGING SCHEDULE</h1>
      <div class="muted">Report Reference: RPT-BIL-03 &middot; As of ${escapeHtml(doc.asOfDate ? String(doc.asOfDate).slice(0, 10) : new Date().toISOString().slice(0, 10))}</div>
    </header>

    <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:3mm; margin-bottom:5mm;">
      <div style="border:0.5pt solid #cbd5e1; border-top:2.5pt solid #15803d; padding:2.5mm; background:#fff;">
        <div class="muted">0–30 Days (Current)</div>
        <div style="font-size:13pt; font-weight:700; color:#15803d;">₱${money(doc.aging.current_0_30)}</div>
      </div>
      <div style="border:0.5pt solid #cbd5e1; border-top:2.5pt solid #0284c7; padding:2.5mm; background:#fff;">
        <div class="muted">31–60 Days</div>
        <div style="font-size:13pt; font-weight:700; color:#0284c7;">₱${money(doc.aging.days_31_60)}</div>
      </div>
      <div style="border:0.5pt solid #cbd5e1; border-top:2.5pt solid #d97706; padding:2.5mm; background:#fff;">
        <div class="muted">61–90 Days</div>
        <div style="font-size:13pt; font-weight:700; color:#d97706;">₱${money(doc.aging.days_61_90)}</div>
      </div>
      <div style="border:0.5pt solid #cbd5e1; border-top:2.5pt solid #dc2626; padding:2.5mm; background:#fff;">
        <div class="muted">Over 90 Days</div>
        <div style="font-size:13pt; font-weight:700; color:#dc2626;">₱${money(doc.aging.over_90)}</div>
      </div>
    </div>

    <div class="grid" style="margin-bottom:4mm;">
      ${field("Total Outstanding Receivables", `₱${money(doc.totalReceivables)}`)}
      ${field("Total Open Invoices", String(doc.totalInvoices))}
      ${doc.generatedBy ? field("Generated By", doc.generatedBy) : ''}
    </div>

    <table>
      <thead>
        <tr>
          <th>Invoice #</th>
          <th>Date</th>
          <th>Patient (ID)</th>
          <th>Payer Type</th>
          <th class="num">Age</th>
          <th class="num">Total</th>
          <th class="num">Paid</th>
          <th class="num">Outstanding Balance</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="font-weight:700; background:#f1f5f9;">
          <td colspan="7">TOTAL RECEIVABLES</td>
          <td class="num" style="color:#b91c1c;">₱${money(doc.totalReceivables)}</td>
        </tr>
      </tfoot>
    </table>

    <div style="display:flex; justify-content:space-between; margin-top:10mm;">
      <div class="sig-line">Prepared by (Billing Staff)</div>
      <div class="sig-line">Approved by (Finance / Credit Controller)</div>
    </div>

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Accounts Receivables Schedule (RPT-BIL-03)</span>
      <span>Financial Statement</span>
    </footer>
  `;

  return shell("Accounts Receivables Aging Schedule", body);
}

export interface DailyCloseSummaryRow {
  branch_name: string;
  total_invoiced: number | string;
  total_discounts: number | string;
  total_collected: number | string;
  total_cash: number | string;
  total_card: number | string;
  total_ewallet: number | string;
  total_other: number | string;
  open_shifts_count?: number;
  locked_at?: string | null;
}

export interface DailyCloseSummaryDocument {
  clinicName: string;
  closeDate: string;
  generatedAt: string;
  branchName?: string;
  summaries: DailyCloseSummaryRow[];
  generatedBy?: string;
}

/**
 * Daily Close Consolidated Collections Report (JOB-48 / BIL-T6).
 */
export function renderDailyCloseSummaryHtml(doc: DailyCloseSummaryDocument): string {
  let grossInvoiced = 0;
  let grossDiscounts = 0;
  let grossCollected = 0;
  let grossCash = 0;
  let grossCard = 0;
  let grossEWallet = 0;
  let grossOther = 0;

  const rows = doc.summaries.length === 0
    ? `<tr><td colspan="8" style="text-align:center; color:#64748b; font-style:italic; padding:6mm 0;">No daily close records found for this date.</td></tr>`
    : doc.summaries.map((s) => {
        const inv = Number(s.total_invoiced || 0);
        const disc = Number(s.total_discounts || 0);
        const col = Number(s.total_collected || 0);
        const cash = Number(s.total_cash || 0);
        const card = Number(s.total_card || 0);
        const ew = Number(s.total_ewallet || 0);
        const oth = Number(s.total_other || 0);

        grossInvoiced += inv;
        grossDiscounts += disc;
        grossCollected += col;
        grossCash += cash;
        grossCard += card;
        grossEWallet += ew;
        grossOther += oth;

        return `
          <tr>
            <td><strong>${escapeHtml(s.branch_name)}</strong></td>
            <td class="num">${money(inv)}</td>
            <td class="num">-${money(disc)}</td>
            <td class="num">${money(cash)}</td>
            <td class="num">${money(card)}</td>
            <td class="num">${money(ew)}</td>
            <td class="num">${money(oth)}</td>
            <td class="num" style="font-weight:700; color:#15803d;">₱${money(col)}</td>
          </tr>
        `;
      }).join('');

  const body = `
    <header>
      <div class="clinic">${escapeHtml(doc.clinicName)}${doc.branchName ? ` — ${escapeHtml(doc.branchName)}` : ''}</div>
      <h1 style="margin-top:1mm;">DAILY CLOSE CONSOLIDATED COLLECTIONS</h1>
      <div class="muted">Closing Date: ${escapeHtml(doc.closeDate)} &middot; Generated: ${escapeHtml(String(doc.generatedAt).slice(0, 19).replace('T', ' '))}</div>
    </header>

    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:3mm; margin-bottom:5mm;">
      <div style="border:0.5pt solid #cbd5e1; padding:3mm; background:#fff;">
        <div class="muted">Total Invoiced Gross</div>
        <div style="font-size:14pt; font-weight:700;">₱${money(grossInvoiced)}</div>
      </div>
      <div style="border:0.5pt solid #cbd5e1; padding:3mm; background:#fff;">
        <div class="muted">Statutory &amp; Promo Deductions</div>
        <div style="font-size:14pt; font-weight:700; color:#b91c1c;">-₱${money(grossDiscounts)}</div>
      </div>
      <div style="border:0.5pt solid #cbd5e1; border-top:2.5pt solid #15803d; padding:3mm; background:#fff;">
        <div class="muted">Net Collections Consolidated</div>
        <div style="font-size:14pt; font-weight:700; color:#15803d;">₱${money(grossCollected)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Branch / Unit</th>
          <th class="num">Invoiced</th>
          <th class="num">Discounts</th>
          <th class="num">Cash</th>
          <th class="num">Card</th>
          <th class="num">E-Wallet</th>
          <th class="num">Other</th>
          <th class="num">Total Collected</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="font-weight:700; background:#f1f5f9;">
          <td>CONSOLIDATED TOTAL</td>
          <td class="num">₱${money(grossInvoiced)}</td>
          <td class="num">-₱${money(grossDiscounts)}</td>
          <td class="num">₱${money(grossCash)}</td>
          <td class="num">₱${money(grossCard)}</td>
          <td class="num">₱${money(grossEWallet)}</td>
          <td class="num">₱${money(grossOther)}</td>
          <td class="num" style="color:#15803d;">₱${money(grossCollected)}</td>
        </tr>
      </tfoot>
    </table>

    <div style="display:flex; justify-content:space-between; margin-top:12mm;">
      <div class="sig-line">Prepared by (Head Cashier)</div>
      <div class="sig-line">Reviewed &amp; Locked by (Branch Accountant)</div>
    </div>

    <footer>
      <span>${escapeHtml(doc.clinicName)} &middot; Daily Cashier Collections Summary (JOB-48)</span>
      <span>Certified Financial Close</span>
    </footer>
  `;

  return shell(`Daily Close Summary - ${doc.closeDate}`, body);
}


