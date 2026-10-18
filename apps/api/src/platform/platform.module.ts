import { Module as NestModule } from '@nestjs/common';
import { BreakglassController } from './breakglass.controller.js';
import { BreakglassService } from './breakglass.service.js';
import { PlatformAuthController } from './platform-auth.controller.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PlatformAdminsController } from './platform-admins.controller.js';
import { PlatformAdminsService } from './platform-admins.service.js';
import { ProvisioningController } from './provisioning.controller.js';
import { ProvisioningService } from './provisioning.service.js';
import { TokenService } from '../auth/crypto/tokens.js';
import { PasswordService } from '../auth/crypto/password.js';
import { MfaService } from '../auth/mfa.service.js';
import { RbacModule } from '../rbac/rbac.module.js';


@NestModule({
  imports: [RbacModule],
  providers: [
    BreakglassService,
    ProvisioningService,
    PlatformAdminsService,
    PlatformAuthService,
    TokenService,
    PasswordService,
    MfaService,
  ],
  controllers: [
    PlatformAuthController,
    BreakglassController,
    ProvisioningController,
    PlatformAdminsController,
  ],
  exports: [BreakglassService, ProvisioningService],
})
export class PlatformModule {}
