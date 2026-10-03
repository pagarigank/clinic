import { apiGet, apiPost, apiDelete } from "../../shared/api/client.js";
import type {
  CreateInvoiceRequest,
  ConsumeChargesRequest,
  ApplyDiscountRequest,
  CreatePaymentRequest,
  VoidPaymentRequest,
  ReprintReceiptRequest,
  OpenShiftRequest,
  CloseShiftRequest,
  CreateCreditNoteRequest,
  ApproveCreditNoteRequest,
  DailyCloseRunRequest,
  SaveCashSessionRequest,
} from "@clinic/contracts";

// ── Invoices ─────────────────────────────────────────────────────────────────

export async function fetchInvoices(params?: {
  status?: string;
  patientId?: string;
  branchId?: string;
  limit?: number;
  offset?: number;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.patientId) q.set("patientId", params.patientId);
  if (params?.branchId) q.set("branchId", params.branchId);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return apiGet<{ data: any[]; total: number }>(`/billing/invoices${qs ? `?${qs}` : ""}`);
}

export async function fetchInvoice(id: string) {
  return apiGet<any>(`/billing/invoices/${id}`);
}

export async function createInvoice(body: CreateInvoiceRequest) {
  return apiPost<any>("/billing/invoices", body);
}

export async function voidInvoice(id: string, reason: string) {
  return apiPost<any>(`/billing/invoices/${id}/void`, { reason });
}

export async function consumeCharges(invoiceId: string, body: ConsumeChargesRequest) {
  return apiPost<any>(`/billing/invoices/${invoiceId}/consume-charges`, body);
}

export async function applyDiscount(invoiceId: string, body: ApplyDiscountRequest) {
  return apiPost<any>(`/billing/invoices/${invoiceId}/discounts`, body);
}

export async function revokeDiscount(invoiceId: string, discountAppId: string) {
  return apiDelete<any>(`/billing/invoices/${invoiceId}/discounts/${discountAppId}`);
}

// ── Payments & Receipts ──────────────────────────────────────────────────────

export async function fetchPayments(params?: {
  invoiceId?: string;
  shiftId?: string;
  limit?: number;
  offset?: number;
}) {
  const q = new URLSearchParams();
  if (params?.invoiceId) q.set("invoiceId", params.invoiceId);
  if (params?.shiftId) q.set("shiftId", params.shiftId);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return apiGet<{ data: any[]; total: number }>(`/billing/payments${qs ? `?${qs}` : ""}`);
}

export async function fetchPayment(id: string) {
  return apiGet<any>(`/billing/payments/${id}`);
}

export async function createPayment(body: CreatePaymentRequest) {
  return apiPost<any>("/billing/payments", body);
}

export async function fetchPaymentReceipt(paymentId: string) {
  return apiGet<any>(`/billing/payments/${paymentId}/receipt`);
}

export async function reprintReceipt(paymentId: string, body: ReprintReceiptRequest) {
  return apiPost<any>(`/billing/payments/${paymentId}/reprint`, body);
}

export async function voidPayment(paymentId: string, body: VoidPaymentRequest) {
  return apiPost<any>(`/billing/payments/${paymentId}/void`, body);
}

// ── Cash Sessions ────────────────────────────────────────────────────────────

export async function fetchSessions() {
  return apiGet<{ data: any[] }>("/billing/sessions");
}

export async function saveSession(id: string, body: SaveCashSessionRequest) {
  return apiPost<any>(`/billing/sessions/${id}`, body);
}

// ── Cashier Shifts ───────────────────────────────────────────────────────────

export async function fetchShifts(params?: { branchId?: string; cashierId?: string; status?: string }) {
  const q = new URLSearchParams();
  if (params?.branchId) q.set("branchId", params.branchId);
  if (params?.cashierId) q.set("cashierId", params.cashierId);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return apiGet<{ data: any[] }>(`/billing/shifts${qs ? `?${qs}` : ""}`);
}

export async function fetchActiveShift(cashierId?: string) {
  const q = cashierId ? `?cashierId=${encodeURIComponent(cashierId)}` : "";
  return apiGet<any>(`/billing/shifts/active${q}`);
}

export async function openShift(body: OpenShiftRequest) {
  return apiPost<any>("/billing/shifts/open", body);
}

export async function closeShift(shiftId: string, body: CloseShiftRequest) {
  return apiPost<any>(`/billing/shifts/${shiftId}/close`, body);
}

// ── Credit Notes ─────────────────────────────────────────────────────────────

export async function fetchCreditNotes(params?: { invoiceId?: string; status?: string }) {
  const q = new URLSearchParams();
  if (params?.invoiceId) q.set("invoiceId", params.invoiceId);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return apiGet<{ data: any[] }>(`/billing/credit-notes${qs ? `?${qs}` : ""}`);
}

export async function createCreditNote(body: CreateCreditNoteRequest) {
  return apiPost<any>("/billing/credit-notes", body);
}

export async function approveCreditNote(id: string, body: ApproveCreditNoteRequest) {
  return apiPost<any>(`/billing/credit-notes/${id}/approve`, body);
}

// ── Daily Close & Konsulta Tally ─────────────────────────────────────────────

export async function fetchDailyClose(date?: string, branchId?: string) {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (branchId) q.set("branchId", branchId);
  const qs = q.toString();
  return apiGet<any>(`/billing/daily-close${qs ? `?${qs}` : ""}`);
}

export async function runDailyClose(body: DailyCloseRunRequest) {
  return apiPost<any>("/billing/daily-close", body);
}

export async function fetchKonsultaTally(date?: string, practitionerId?: string) {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (practitionerId) q.set("providerId", practitionerId);
  const qs = q.toString();
  return apiGet<any>(`/billing/reports/konsulta-tally${qs ? `?${qs}` : ""}`);
}

// ── Finance Reports & Patient Statements (todo.md §7.1, §7.4, specification §15.7) ─

export async function fetchPatientStatement(patientId: string) {
  return apiGet<any>(`/billing/patients/${patientId}/statement`);
}

export async function fetchReceivablesReport(params?: { asOfDate?: string; branchId?: string; payerType?: string }) {
  const q = new URLSearchParams();
  if (params?.asOfDate) q.set("asOfDate", params.asOfDate);
  if (params?.branchId) q.set("branchId", params.branchId);
  if (params?.payerType) q.set("payerType", params.payerType);
  const qs = q.toString();
  return apiGet<any>(`/billing/reports/receivables${qs ? `?${qs}` : ""}`);
}

export async function fetchDiscountsReport(params?: { fromDate?: string; toDate?: string; branchId?: string }) {
  const q = new URLSearchParams();
  if (params?.fromDate) q.set("fromDate", params.fromDate);
  if (params?.toDate) q.set("toDate", params.toDate);
  if (params?.branchId) q.set("branchId", params.branchId);
  const qs = q.toString();
  return apiGet<any>(`/billing/reports/discounts${qs ? `?${qs}` : ""}`);
}

export async function fetchVoidsReport(params?: { fromDate?: string; toDate?: string; branchId?: string }) {
  const q = new URLSearchParams();
  if (params?.fromDate) q.set("fromDate", params.fromDate);
  if (params?.toDate) q.set("toDate", params.toDate);
  if (params?.branchId) q.set("branchId", params.branchId);
  const qs = q.toString();
  return apiGet<any>(`/billing/reports/voids${qs ? `?${qs}` : ""}`);
}

export async function fetchShiftXReport(shiftId: string) {
  return apiGet<any>(`/billing/shifts/${shiftId}/x-report`);
}

export async function fetchShiftZReport(shiftId: string) {
  return apiGet<any>(`/billing/shifts/${shiftId}/z-report`);
}

// ── Metadata & Reference Data ────────────────────────────────────────────────

export async function fetchDiscountTypes() {
  return apiGet<{ data: any[] }>("/admin/discount-types");
}

export async function fetchPaymentMethods() {
  return apiGet<{ data: any[] }>("/admin/payment-methods");
}

