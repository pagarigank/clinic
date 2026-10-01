import { Module } from "@nestjs/common";
import { PingModule } from "./modules/ping/ping.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MetricsModule } from "./modules/metrics/metrics.module.js";

@Module({
  imports: [PingModule, HealthModule, MetricsModule],
})
export class AppModule {}
