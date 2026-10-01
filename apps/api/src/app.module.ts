import { Module } from "@nestjs/common";
import { PingModule } from "./modules/ping/ping.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MetricsModule } from "./modules/metrics/metrics.module.js";
import { AuthModule } from "./auth/auth.module.js";

@Module({
  imports: [PingModule, HealthModule, MetricsModule, AuthModule],
})
export class AppModule {}
