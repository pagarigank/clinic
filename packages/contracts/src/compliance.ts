import { z } from "zod";

// ── 1. Consent Templates & Patient Consents ─────────────────────────────────

export const CreateConsentTemplateSchema = z.object({
  title: z.string().min(3).max(255),
  body: z.string().min(10),
  purposes: z.array(z.string()).default([]),
  locale: z.string().default("en"),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
});
export type CreateConsentTemplateRequest = z.infer<typeof CreateConsentTemplateSchema>;

export const CreatePatientConsentSchema = z.object({
  patientId: z.string().uuid(),
  templateId: z.string().uuid(),
  signedByName: z.string().min(2).max(255),
  relationship: z.enum(["SELF", "PARENT", "GUARDIAN", "SPOUSE", "AUTHORIZED_REPRESENTATIVE"]).default("SELF"),
  signatureData: z.string().optional(),
});
export type CreatePatientConsentRequest = z.infer<typeof CreatePatientConsentSchema>;

export const RevokePatientConsentSchema = z.object({
  revokedReason: z.string().min(3).max(500),
});
export type RevokePatientConsentRequest = z.infer<typeof RevokePatientConsentSchema>;

// ── 2. Data Subject Requests (DSR) ──────────────────────────────────────────

export const CreateDsrSchema = z.object({
  patientId: z.string().uuid(),
  type: z.enum(["ACCESS", "CORRECTION", "ERASURE", "OBJECTION", "PORTABILITY"]),
  identityNotes: z.string().optional(),
  dueDays: z.number().int().min(1).max(90).default(30), // Default SLA 30 days
});
export type CreateDsrRequest = z.infer<typeof CreateDsrSchema>;

export const VerifyDsrIdentitySchema = z.object({
  identityNotes: z.string().min(3),
});
export type VerifyDsrIdentityRequest = z.infer<typeof VerifyDsrIdentitySchema>;

export const CompleteDsrSchema = z.object({
  outcomeNote: z.string().min(3),
});
export type CompleteDsrRequest = z.infer<typeof CompleteDsrSchema>;

export const RejectDsrSchema = z.object({
  rejectionReason: z.string().min(3),
});
export type RejectDsrRequest = z.infer<typeof RejectDsrSchema>;

export const ExtendDsrSchema = z.object({
  extensionDays: z.number().int().min(1).max(60),
  reason: z.string().min(3),
});
export type ExtendDsrRequest = z.infer<typeof ExtendDsrSchema>;

// ── 3. Breach Incidents ─────────────────────────────────────────────────────

export const CreateBreachSchema = z.object({
  description: z.string().min(10),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  dataClasses: z.array(z.string()).default([]),
  affectedCount: z.number().int().min(0).default(0),
  deadlineHours: z.number().int().min(1).max(720).default(72), // Default 72 hours (Q-2)
});
export type CreateBreachRequest = z.infer<typeof CreateBreachSchema>;

export const AssessBreachSchema = z.object({
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  affectedCount: z.number().int().min(0),
  dataClasses: z.array(z.string()),
  correctiveActions: z.string().optional(),
});
export type AssessBreachRequest = z.infer<typeof AssessBreachSchema>;

export const NotifyBreachSchema = z.object({
  notifiedRegulator: z.boolean().default(false),
  notifiedSubjects: z.boolean().default(false),
  notes: z.string().optional(),
});
export type NotifyBreachRequest = z.infer<typeof NotifyBreachSchema>;

export const CloseBreachSchema = z.object({
  correctiveActions: z.string().min(5),
  lessonsLearned: z.string().min(5),
});
export type CloseBreachRequest = z.infer<typeof CloseBreachSchema>;

// ── 4. Retention Policies & Legal Holds ─────────────────────────────────────

export const CreateRetentionPolicySchema = z.object({
  recordClass: z.enum([
    "CLINICAL_VISITS",
    "CLINICAL_NOTES",
    "LAB_ORDERS",
    "LAB_RESULTS",
    "PRESCRIPTIONS",
    "INVOICES",
    "PAYMENTS",
    "AUDIT_LOGS",
  ]),
  retentionYears: z.number().int().min(1).max(50),
  action: z.enum(["ARCHIVE", "ANONYMIZE", "DELETE"]).default("ARCHIVE"),
  legalBasis: z.string().min(3),
});
export type CreateRetentionPolicyRequest = z.infer<typeof CreateRetentionPolicySchema>;

export const UpdateRetentionPolicySchema = z.object({
  retentionYears: z.number().int().min(1).max(50).optional(),
  action: z.enum(["ARCHIVE", "ANONYMIZE", "DELETE"]).optional(),
  legalBasis: z.string().min(3).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateRetentionPolicyRequest = z.infer<typeof UpdateRetentionPolicySchema>;

export const CreateLegalHoldSchema = z.object({
  scope: z.enum(["PATIENT", "RECORD_CLASS", "ENTIRE_TENANT"]),
  patientId: z.string().uuid().optional(),
  recordClass: z.string().optional(),
  reason: z.string().min(5),
});
export type CreateLegalHoldRequest = z.infer<typeof CreateLegalHoldSchema>;

export const ReleaseLegalHoldSchema = z.object({
  releaseReason: z.string().min(5),
});
export type ReleaseLegalHoldRequest = z.infer<typeof ReleaseLegalHoldSchema>;

export const ApproveRetentionCandidatesSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1),
});
export type ApproveRetentionCandidatesRequest = z.infer<typeof ApproveRetentionCandidatesSchema>;

export const HoldRetentionCandidatesSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1),
  legalHoldId: z.string().uuid(),
});
export type HoldRetentionCandidatesRequest = z.infer<typeof HoldRetentionCandidatesSchema>;

// ── 5. Access Reviews ───────────────────────────────────────────────────────

export const CreateAccessReviewSchema = z.object({
  campaignName: z.string().min(3).max(255),
});
export type CreateAccessReviewRequest = z.infer<typeof CreateAccessReviewSchema>;

export const RecordAccessReviewDecisionSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  decision: z.enum(["MAINTAIN", "REVOKE", "MODIFY"]),
  notes: z.string().optional(),
});
export type RecordAccessReviewDecisionRequest = z.infer<typeof RecordAccessReviewDecisionSchema>;

// ── 6. PIDSR Notifiable Disease Cases ───────────────────────────────────────

export const CreatePidsrCaseSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  diseaseCode: z.string().min(2),
  diseaseName: z.string().min(2),
  icd10Code: z.string().min(2),
  dateOfOnset: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  classification: z.enum(["SUSPECTED", "PROBABLE", "CONFIRMED"]).default("SUSPECTED"),
  cifData: z.record(z.string(), z.any()).default({}),
});
export type CreatePidsrCaseRequest = z.infer<typeof CreatePidsrCaseSchema>;

export const UpdatePidsrCaseSchema = z.object({
  classification: z.enum(["SUSPECTED", "PROBABLE", "CONFIRMED"]).optional(),
  cifData: z.record(z.string(), z.any()).optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW", "REPORTED", "ARCHIVED"]).optional(),
});
export type UpdatePidsrCaseRequest = z.infer<typeof UpdatePidsrCaseSchema>;
