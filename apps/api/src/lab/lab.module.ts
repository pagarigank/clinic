import { Module } from '@nestjs/common';
import { LabController } from './lab.controller.js';
import { LabService } from './lab.service.js';
import { SupplyModule } from '../supply/supply.module.js';

@Module({
  imports: [SupplyModule],
  controllers: [LabController],
  providers: [LabService],
  exports: [LabService],
})
export class LabModule {}
