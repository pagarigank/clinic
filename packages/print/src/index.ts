/**
 * `@clinic/print` - the shared document pipeline (todo.md 3.2).
 *
 * One renderer for every numbered or PDF document the platform issues:
 * medical certificates, lab reports, official receipts, Rx labels, and
 * specimen/order barcodes. Both the API (documents requested synchronously)
 * and the worker (JOB-43 lab reports, JOB-50 receipts) depend on this package
 * so a document looks and hashes the same whoever asked for it.
 *
 * ```ts
 * const doc = await renderPdf(renderCertificateHtml(cert), { format: "A4" });
 * // doc.sha256 is the integrity digest of doc.bytes - store and serve these
 * // exact bytes together.
 * ```
 */

export {
  renderPdf,
  normalizePdfDates,
  verifyDocument,
  sha256Of,
  closePrintRenderer,
} from "./pdf.js";
export type { PaperFormat, PdfMargin, PdfOptions, RenderedDocument } from "./pdf.js";

export { renderBarcodeLabel, renderRxLabel, escapeZpl } from "./zpl.js";
export type { BarcodeLabel, RxLabel } from "./zpl.js";

export { renderReceipt as renderThermalReceipt } from "./escpos.js";
export type { Receipt as ThermalReceipt, ReceiptLine } from "./escpos.js";

export {
  escapeHtml,
  renderCertificateHtml,
  renderLabReportHtml,
  renderReceiptHtml,
  renderInvoiceHtml,
  renderPrescriptionHtml,
  renderLabRequisitionHtml,
  renderEncounterOrdersHtml,
  renderRxQueueHtml,
  renderConsumptionListHtml,
  renderGrnHtml,
  renderRequisitionHtml,
  renderDispenseLabelHtml,
  renderDangerousDrugsBookHtml,
  renderPatientStatementHtml,
  renderShiftReportHtml,
  renderReceivablesAgingHtml,
  renderDailyCloseSummaryHtml,
  renderDialysisTreatmentSheetHtml,
  renderFormalReportHtml,
} from "./templates.js";
export type {
  MedicalCertificate,
  LabReport,
  LabReport as LabReportDocument,
  ReceiptDocument,
  InvoiceDocument,
  InvoiceLineItem,
  InvoiceDiscountItem,
  InvoicePaymentItem,
  PrescriptionDocument,
  PrescriptionItemDocument,
  LabRequisitionDocument,
  LabRequisitionItem,
  EncounterOrdersDocument,
  RxQueueDocument,
  ConsumptionListDocument,
  GrnDocument,
  GrnLineItemDocument,
  RequisitionDocument,
  RequisitionLineItemDocument,
  DispenseLabelDocument,
  DangerousDrugsBookDocument,
  DangerousDrugsBookRow,
  PatientStatementDocument,
  PatientStatementInvoice,
  PatientStatementInvoiceLine,
  PatientStatementPayment,
  ShiftReportDocument,
  ReceivablesAgingDocument,
  ReceivablesAgingRow,
  DailyCloseSummaryDocument,
  DailyCloseSummaryRow,
  DialysisTreatmentSheetDocument,
  DialysisFlowsheetRow,
  FormalReportDocument,
  FormalReportColumn,
  FormalReportSummaryCard,
} from "./templates.js";


export { buildReceiptDocument, toThermalReceipt } from "./receipt.js";
export type { ReceiptFacts } from "./receipt.js";

