import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL_APP: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // ---- Auth (Phase 1.2, architecture §10) ----
  // HS256 signing key. Required (min 32 chars) in production; the dev default
  // exists so `pnpm dev` works with zero env setup.
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(600), // 10 min (arch §10)
  REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  MFA_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  STEP_UP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  TRUSTED_DEVICE_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 30),

  // Argon2id (OWASP m=19 MiB, t=2, p=1). Overridable per deployment.
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  // Lockout with exponential backoff (arch §10): count >= LOCKOUT_MAX_FAILED
  // locks for base·2^(count−max) seconds, capped at LOCKOUT_MAX_SECONDS.
  LOCKOUT_MAX_FAILED: z.coerce.number().int().positive().default(5),
  LOCKOUT_BASE_SECONDS: z.coerce.number().int().positive().default(30),
  LOCKOUT_MAX_SECONDS: z.coerce.number().int().positive().default(900),

  // Password policy (arch §10: min length 12).
  PASSWORD_MIN_LENGTH: z.coerce.number().int().positive().default(12),

  // Dev/test affordance: /auth/password/forgot may echo the reset token in
  // the response (no mail transport exists yet — JOB-02 arrives in Phase 9).
  // Hard-refused in production. stringbool so "false" means false.
  DEV_EXPOSE_RESET_TOKEN: z.stringbool().default(true),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | undefined;

const DEV_FALLBACK_SECRET = "dev-only-jwt-secret-change-me-0123456789abcdef";

export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const config = ConfigSchema.parse(env);

  if (config.NODE_ENV === "production") {
    if (!env.JWT_SECRET) {
      throw new Error("JWT_SECRET is required in production");
    }
    if (config.DEV_EXPOSE_RESET_TOKEN) {
      throw new Error("DEV_EXPOSE_RESET_TOKEN must be false in production");
    }
  }

  return { ...config, JWT_SECRET: config.JWT_SECRET ?? DEV_FALLBACK_SECRET };
}
