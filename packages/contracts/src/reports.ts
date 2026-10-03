import { z } from "zod";

// ── Report Catalog & Runner ──────────────────────────────────────────────────

export const ReportDefinitionSchema = z.object({
  id: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  permittedFields: z.array(z.string()).default([]),
  defaultPeriod: z.string().default("30d"),
  exportFormats: z.array(z.enum(["CSV", "JSON", "PDF"])).default(["CSV", "JSON", "PDF"]),
  isActive: z.boolean().default(true),
});
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;

export const RunReportSchema = z.object({
  reportId: z.string().optional(),
  parameters: z.record(z.string(), z.any()).default({}),
  format: z.enum(["INLINE", "CSV", "JSON", "PDF"]).default("INLINE"),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});
export type RunReportRequest = z.infer<typeof RunReportSchema>;

export const ReportExportSchema = z.object({
  reportId: z.string().optional(),
  parameters: z.record(z.string(), z.any()).default({}),
  format: z.enum(["CSV", "JSON", "PDF"]).default("CSV"),
});
export type ReportExportRequest = z.infer<typeof ReportExportSchema>;

export const ReportScheduleSchema = z.object({
  reportId: z.string(),
  cronExpression: z.string().min(5),
  parameters: z.record(z.string(), z.any()).default({}),
  recipients: z.array(z.string()).default([]),
  format: z.enum(["CSV", "JSON", "PDF"]).default("CSV"),
  isActive: z.boolean().default(true),
});
export type ReportScheduleRequest = z.infer<typeof ReportScheduleSchema>;
