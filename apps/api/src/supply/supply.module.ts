import { Module } from '@nestjs/common';
import { SupplyController } from './supply.controller.js';
import { SupplyService } from './supply.service.js';

@Module({
  controllers: [SupplyController],
  providers: [SupplyService],
  exports: [SupplyService],
})
export class SupplyModule {}
