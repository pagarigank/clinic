import { Module as NestModule } from '@nestjs/common';
import { BreakglassController } from './breakglass.controller.js';
import { BreakglassService } from './breakglass.service.js';
import { ProvisioningController } from './provisioning.controller.js';
import { ProvisioningService } from './provisioning.service.js';
import { TokenService } from '../auth/crypto/tokens.js';
import { MfaService } from '../auth/mfa.service.js';

@NestModule({
  providers: [BreakglassService, ProvisioningService, TokenService, MfaService],
  controllers: [BreakglassController, ProvisioningController],
  exports: [BreakglassService, ProvisioningService],
})
export class PlatformModule {}
