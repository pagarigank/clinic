/**
 * Structured JSON logging with PHI redaction (todo 0.5; ground rule 5:
 * no PHI in logs). Field deny-list drops known identifiers; unknown nested
 * objects pass through except for redacted keys at any depth.
 */
const REDACT_KEYS = new Set([
  "first_name",
  "last_name",
  "middle_name",
  "birth_date",
  "mobile",
  "email",
  "philhealth_no",
  "diagnosis",
  "note",
  "subjective",
  "objective",
  "assessment",
  "plan",
  "password",
  "password_hash",
  "mfa_secret",
  "authorization",
  "cookie",
]);

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function redact(value: unknown, depth = 0): Json {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function logLine(
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(redact(fields) as Record<string, Json>),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: Record<string, unknown>) => logLine("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => logLine("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => logLine("error", msg, fields),
};
