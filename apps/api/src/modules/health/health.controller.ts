import { Controller, Get } from "@nestjs/common";
import { getAppPool } from "@clinic/db";
import { Public } from "../../auth/auth-context.js";

@Controller(["api/v1/health", "api/v1/ready"])
@Public()
export class HealthController {
  @Get()
  async check(): Promise<{ status: string; db: string }> {
    let db = "up";
    try {
      const pool = getAppPool();
      await pool.query("SELECT 1");
    } catch {
      db = "down";
    }
    return { status: db === "up" ? "ok" : "degraded", db };
  }
}
