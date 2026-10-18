import { Module } from '@nestjs/common';
import { RenalController } from './renal.controller.js';
import { RenalService } from './renal.service.js';

import { SupplyModule } from '../supply/supply.module.js';

@Module({
  imports: [SupplyModule],
  controllers: [RenalController],
  providers: [RenalService],
  exports: [RenalService],
})
export class RenalModule {}
