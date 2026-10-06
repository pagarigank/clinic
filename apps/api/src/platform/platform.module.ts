import { Module as NestModule } from '@nestjs/common';
import { BreakglassController } from './breakglass.controller.js';
import { BreakglassService } from './breakglass.service.js';
import { PlatformAuthController } from './platform-auth.controller.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { ProvisioningController } from './provisioning.controller.js';
import { ProvisioningService } from './provisioning.service.js';
import { TokenService } from '../auth/crypto/tokens.js';
import { PasswordService } from '../auth/crypto/password.js';
import { MfaService } from '../auth/mfa.service.js';

@NestModule({
  providers: [
    BreakglassService,
    ProvisioningService,
    PlatformAuthService,
    TokenService,
    PasswordService,
    MfaService,
  ],
  controllers: [PlatformAuthController, BreakglassController, ProvisioningController],
  exports: [BreakglassService, ProvisioningService],
})
export class PlatformModule {}
