import { z } from "zod";

// ── User In-App Notifications ────────────────────────────────────────────────

export const NotificationSeveritySchema = z.enum([
  "INFO",
  "SUCCESS",
  "WARNING",
  "CRITICAL",
  "CLINICAL_ALERT",
]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

export const CreateNotificationSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().min(2).max(255),
  body: z.string().min(2),
  severity: NotificationSeveritySchema.default("INFO"),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  deepLink: z.string().optional(),
});
export type CreateNotificationRequest = z.infer<typeof CreateNotificationSchema>;

export const NotificationFiltersSchema = z.object({
  unreadOnly: z.boolean().optional(),
  severity: NotificationSeveritySchema.optional(),
  entityType: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type NotificationFilters = z.infer<typeof NotificationFiltersSchema>;

// ── Notification Preferences & Quiet Hours ───────────────────────────────────

export const NotificationPreferencesSchema = z.object({
  channels: z.object({
    inApp: z.boolean().default(true),
    email: z.boolean().default(true),
    sms: z.boolean().default(false),
  }).default({ inApp: true, email: true, sms: false }),
  quietHoursEnabled: z.boolean().default(false),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).default("22:00:00"),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).default("07:00:00"),
});
export type NotificationPreferencesRequest = z.infer<typeof NotificationPreferencesSchema>;
