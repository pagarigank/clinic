import { Module } from "@nestjs/common";
import { PingModule } from "./modules/ping/ping.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MetricsModule } from "./modules/metrics/metrics.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { RbacModule } from "./rbac/rbac.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { TenantModulesModule } from "./tenant-modules/tenant-modules.module.js";
import { PlatformModule } from "./platform/platform.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { FilesModule } from "./files/files.module.js";
import { ReferenceModule } from "./reference/reference.module.js";
import { PatientsModule } from "./patients/patients.module.js";
import { TenantConfigModule } from "./tenant-config/tenant-config.module.js";
import { TemplatesModule } from "./templates/templates.module.js";
import { ClinicalModule } from "./clinical/clinical.module.js";
import { SupplyModule } from "./supply/supply.module.js";
import { PharmacyModule } from "./pharmacy/pharmacy.module.js";
import { LabModule } from "./lab/lab.module.js";
import { BillingModule } from "./billing/billing.module.js";

@Module({
  imports: [PingModule, HealthModule, MetricsModule, AuthModule, RbacModule, AuditModule, TenantModulesModule, PlatformModule, AdminModule, FilesModule, ReferenceModule, PatientsModule, TenantConfigModule, TemplatesModule, ClinicalModule, SupplyModule, PharmacyModule, LabModule, BillingModule],
})
export class AppModule {}



