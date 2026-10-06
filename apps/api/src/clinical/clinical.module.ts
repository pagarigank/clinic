import { Module } from '@nestjs/common';
import { ClinicalController } from './clinical.controller.js';
import { PublicBookingController } from './public-booking.controller.js';
import { ClinicalService } from './clinical.service.js';

@Module({
  controllers: [ClinicalController, PublicBookingController],
  providers: [ClinicalService],
  exports: [ClinicalService],
})
export class ClinicalModule {}
