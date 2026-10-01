import { Module } from "@nestjs/common";
import { PingModule } from "./modules/ping/ping.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MetricsModule } from "./modules/metrics/metrics.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { RbacModule } from "./rbac/rbac.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { TenantModulesModule } from "./tenant-modules/tenant-modules.module.js";

@Module({
  imports: [PingModule, HealthModule, MetricsModule, AuthModule, RbacModule, AuditModule, TenantModulesModule],
})
export class AppModule {}
