import { apiGet, apiPost, apiPatch } from "../../shared/api/client.js";
import type {
  CreateConsentTemplateRequest,
  CreatePatientConsentRequest,
  RevokePatientConsentRequest,
  CreateDsrRequest,
  VerifyDsrIdentityRequest,
  CreateBreachRequest,
  AssessBreachRequest,
  NotifyBreachRequest,
  CloseBreachRequest,
  UpdateRetentionPolicyRequest,
  CreateLegalHoldRequest,
  ReleaseLegalHoldRequest,
  CreateAccessReviewRequest,
  RecordAccessReviewDecisionRequest,
  CreatePidsrCaseRequest,
} from "@clinic/contracts";

// ── 1. Audit Explorer & PHI Access ───────────────────────────────────────────

export async function fetchAuditLogs(params?: {
  actorId?: string;
  action?: string;
  entityType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) {
  const q = new URLSearchParams();
  if (params?.actorId) q.set("actorId", params.actorId);
  if (params?.action) q.set("action", params.action);
  if (params?.entityType) q.set("entityType", params.entityType);
  if (params?.startDate) q.set("startDate", params.startDate);
  if (params?.endDate) q.set("endDate", params.endDate);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return apiGet<{ data: any[]; total: number }>(`/compliance/audit-logs${qs ? `?${qs}` : ""}`);
}

export async function fetchAuditLogDetail(id: string) {
  return apiGet<any>(`/compliance/audit-logs/${id}`);
}

export async function fetchPhiAccessLogs(params?: {
  patientId?: string;
  actorId?: string;
  anomaliesOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  const q = new URLSearchParams();
  if (params?.patientId) q.set("patientId", params.patientId);
  if (params?.actorId) q.set("actorId", params.actorId);
  if (params?.anomaliesOnly) q.set("anomaliesOnly", "true");
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return apiGet<{ data: any[]; total: number }>(`/compliance/phi-access-logs${qs ? `?${qs}` : ""}`);
}

export async function fetchPatientPhiAccess(patientId: string) {
  return apiGet<any[]>(`/compliance/phi-access-logs/patient/${patientId}`);
}

// ── 2. Consent Management ───────────────────────────────────────────────────

export async function fetchConsentTemplates() {
  return apiGet<any[]>("/compliance/consent-templates");
}

export async function createConsentTemplate(body: CreateConsentTemplateRequest) {
  return apiPost<any>("/compliance/consent-templates", body);
}

export async function publishConsentTemplate(id: string) {
  return apiPost<any>(`/compliance/consent-templates/${id}/publish`);
}

export async function fetchPatientConsents(patientId: string) {
  return apiGet<any[]>(`/compliance/patients/${patientId}/consents`);
}

export async function recordPatientConsent(body: CreatePatientConsentRequest) {
  return apiPost<any>("/compliance/patients/consents", body);
}

export async function revokePatientConsent(id: string, body: RevokePatientConsentRequest) {
  return apiPost<any>(`/compliance/patients/consents/${id}/revoke`, body);
}

// ── 3. Data Subject Requests (DSR) & AC-15 Export ───────────────────────────

export async function fetchDsrRequests(params?: {
  status?: string;
  type?: string;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.type) q.set("type", params.type);
  const qs = q.toString();
  return apiGet<any[]>(`/compliance/dsr${qs ? `?${qs}` : ""}`);
}

export async function fetchDsrRequest(id: string) {
  return apiGet<any>(`/compliance/dsr/${id}`);
}

export async function createDsrRequest(body: CreateDsrRequest) {
  return apiPost<any>("/compliance/dsr", body);
}

export async function verifyDsrIdentity(id: string, body: VerifyDsrIdentityRequest) {
  return apiPost<any>(`/compliance/dsr/${id}/verify-identity`, body);
}

export async function completeDsrRequest(id: string, outcomeNote?: string) {
  return apiPost<any>(`/compliance/dsr/${id}/complete`, { outcomeNote: outcomeNote || "Delivered" });
}

export async function rejectDsrRequest(id: string, rejectionReason: string) {
  return apiPost<any>(`/compliance/dsr/${id}/reject`, { rejectionReason });
}

export async function extendDsrDeadline(id: string, extensionDays: number, reason: string) {
  return apiPost<any>(`/compliance/dsr/${id}/extend`, { extensionDays, reason });
}

export async function exportPatientDsrData(id: string) {
  return apiGet<any>(`/compliance/dsr/${id}/export`);
}

// ── 4. Breach Management (Q-2) ──────────────────────────────────────────────

export async function fetchBreachIncidents(params?: {
  status?: string;
  severity?: string;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.severity) q.set("severity", params.severity);
  const qs = q.toString();
  return apiGet<any[]>(`/compliance/breaches${qs ? `?${qs}` : ""}`);
}

export async function fetchBreachIncident(id: string) {
  return apiGet<any>(`/compliance/breaches/${id}`);
}

export async function reportBreach(body: CreateBreachRequest) {
  return apiPost<any>("/compliance/breaches", body);
}

export async function assessBreach(id: string, body: AssessBreachRequest) {
  return apiPost<any>(`/compliance/breaches/${id}/assess`, body);
}

export async function recordBreachNotification(id: string, body: NotifyBreachRequest) {
  return apiPost<any>(`/compliance/breaches/${id}/notify`, body);
}

export async function closeBreach(id: string, body: CloseBreachRequest) {
  return apiPost<any>(`/compliance/breaches/${id}/close`, body);
}

// ── 5. Retention Policies & Legal Holds ──────────────────────────────────────

export async function fetchRetentionPolicies() {
  return apiGet<any[]>("/compliance/retention/policies");
}

export async function updateRetentionPolicy(id: string, body: UpdateRetentionPolicyRequest) {
  return apiPatch<any>(`/compliance/retention/policies/${id}`, body);
}

export async function fetchLegalHolds(params?: { scope?: string; patientId?: string }) {
  const q = new URLSearchParams();
  if (params?.scope) q.set("scope", params.scope);
  if (params?.patientId) q.set("patientId", params.patientId);
  const qs = q.toString();
  return apiGet<any[]>(`/compliance/retention/legal-holds${qs ? `?${qs}` : ""}`);
}

export async function createLegalHold(body: CreateLegalHoldRequest) {
  return apiPost<any>("/compliance/retention/legal-holds", body);
}

export async function releaseLegalHold(id: string, body: ReleaseLegalHoldRequest) {
  return apiPost<any>(`/compliance/retention/legal-holds/${id}/release`, body);
}

export async function fetchRetentionCandidates(status?: string) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  const qs = q.toString();
  return apiGet<any[]>(`/compliance/retention/candidates${qs ? `?${qs}` : ""}`);
}

export async function approveRetentionCandidates(candidateIds: string[]) {
  return apiPost<any>("/compliance/retention/candidates/approve", { candidateIds });
}

export async function holdRetentionCandidates(candidateIds: string[], legalHoldId: string) {
  return apiPost<any>("/compliance/retention/candidates/hold", { candidateIds, legalHoldId });
}

// ── 6. Access Reviews ───────────────────────────────────────────────────────

export async function fetchAccessReviews() {
  return apiGet<any[]>("/compliance/access-reviews");
}

export async function fetchAccessReview(id: string) {
  return apiGet<{ review: any; decisions: any[] }>(`/compliance/access-reviews/${id}`);
}

export async function createAccessReview(campaignName: string) {
  return apiPost<any>("/compliance/access-reviews", { campaignName });
}

export async function recordAccessDecision(reviewId: string, body: RecordAccessReviewDecisionRequest) {
  return apiPost<any>(`/compliance/access-reviews/${reviewId}/decisions`, body);
}

export async function completeAccessReview(reviewId: string) {
  return apiPost<any>(`/compliance/access-reviews/${reviewId}/complete`);
}

// ── 7. PIDSR Notifiable Disease Cases (RA 11332) ───────────────────────────

export async function fetchPidsrCases(params?: {
  status?: string;
  diseaseCode?: string;
  branchId?: string;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.diseaseCode) q.set("diseaseCode", params.diseaseCode);
  if (params?.branchId) q.set("branchId", params.branchId);
  const qs = q.toString();
  return apiGet<any[]>(`/compliance/pidsr${qs ? `?${qs}` : ""}`);
}

export async function fetchPidsrCase(id: string) {
  return apiGet<any>(`/compliance/pidsr/${id}`);
}

export async function createPidsrCase(body: CreatePidsrCaseRequest) {
  return apiPost<any>("/compliance/pidsr", body);
}

export async function updatePidsrCaseStatus(id: string, status: string, notes?: string) {
  return apiPatch<any>(`/compliance/pidsr/${id}/status`, { status, notes });
}
