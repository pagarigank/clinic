import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL_APP: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= ConfigSchema.parse(process.env);
  return cached;
}
