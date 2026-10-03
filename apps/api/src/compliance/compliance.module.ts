import { Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service.js';
import { ComplianceController } from './compliance.controller.js';

@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
