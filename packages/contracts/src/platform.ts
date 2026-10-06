import { z } from "zod";

// ── Platform Console & Plans ────────────────────────────────────────────────

export const PlanModuleSchema = z.object({
  id: z.string().uuid().optional(),
  planId: z.string().uuid(),
  module: z.string(),
  limits: z.record(z.string(), z.any()).default({}),
});
export type PlanModule = z.infer<typeof PlanModuleSchema>;

export const ChangeSubscriptionPlanSchema = z.object({
  planId: z.string().uuid(),
  force: z.boolean().default(false),
  reason: z.string().optional(),
});
export type ChangeSubscriptionPlanRequest = z.infer<typeof ChangeSubscriptionPlanSchema>;

export const SystemSettingSchema = z.object({
  key: z.string().min(2).max(100),
  value: z.record(z.string(), z.any()),
});
export type SystemSettingRequest = z.infer<typeof SystemSettingSchema>;

export const PlatformAnnouncementSchema = z.object({
  title: z.string().min(2).max(255),
  body: z.string().min(5),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("INFO"),
  targetPlans: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
});
export type PlatformAnnouncementRequest = z.infer<typeof PlatformAnnouncementSchema>;

export const JobReplaySchema = z.object({
  jobId: z.string().uuid(),
});
export type JobReplayRequest = z.infer<typeof JobReplaySchema>;

// ── Platform console auth (Phase 9, architecture §10) ───────────────────────
// Platform staff authenticate separately from tenants: `platform_users` is a
// global table (no tenant), TOTP is the intended mandatory second factor. The
// `totp` field stays optional here so a freshly-provisioned superadmin with no
// enrolled secret can bootstrap; the service requires it once `totp_secret`
// has been set.

export const PlatformLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().min(6).max(32).optional(),
});
export type PlatformLoginRequest = z.infer<typeof PlatformLoginRequestSchema>;

export const PlatformStepUpRequestSchema = z.object({
  password: z.string().min(1).optional(),
  totp: z.string().min(6).max(32).optional(),
});
export type PlatformStepUpRequest = z.infer<typeof PlatformStepUpRequestSchema>;

export const ModuleEntitlementAuditSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  module: z.string(),
  action: z.enum(["TICK", "ENABLE", "DRAIN", "DISABLE", "TRIAL_START", "TRIAL_EXPIRE"]),
  actorId: z.string().uuid().nullable(),
  reason: z.string(),
  isForced: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ModuleEntitlementAudit = z.infer<typeof ModuleEntitlementAuditSchema>;
