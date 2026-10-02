import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller.js';
import { PharmacyService } from './pharmacy.service.js';
import { SupplyModule } from '../supply/supply.module.js';

@Module({
  imports: [SupplyModule],
  controllers: [PharmacyController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
