import { Module } from '@nestjs/common';
import { TenantModulesService } from './tenant-modules.service.js';
import { PlatformModulesController } from './platform-modules.controller.js';
import { AdminModulesController } from './admin-modules.controller.js';

@Module({
  controllers: [PlatformModulesController, AdminModulesController],
  providers: [TenantModulesService],
  exports: [TenantModulesService],
})
export class TenantModulesModule {}
