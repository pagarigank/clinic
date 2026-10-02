import { Module } from '@nestjs/common';
import { ClinicalController } from './clinical.controller.js';
import { ClinicalService } from './clinical.service.js';

@Module({
  controllers: [ClinicalController],
  providers: [ClinicalService],
  exports: [ClinicalService],
})
export class ClinicalModule {}
