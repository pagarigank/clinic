import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { MfaService } from "./mfa.service.js";
import { TenantResolverService } from "./tenant-resolver.service.js";
import { PasswordService } from "./crypto/password.js";
import { TokenService } from "./crypto/tokens.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { TenantContextGuard } from "./guards/tenant-context.guard.js";
import { StepUpGuard } from "./guards/step-up.guard.js";
import { TenantContextInterceptor } from "./tenant-context.interceptor.js";
import { getConfig } from "../config.js";

/**
 * Phase 1.2 auth wiring. Guard registration order (architecture §11.3):
 * AuthGuard → TenantContextGuard → StepUpGuard, all via the APP_GUARD
 * multi-provider (NOT useGlobalGuards — instance-bound guards built outside
 * the injector silently lose DI, the same trap todo 1.6 flags for
 * @ModuleGuard). The 1.6 module guard and 1.3 permission guard will be
 * appended AFTER these in their own modules to keep the composed order.
 *
 * The single APP_INTERCEPTOR runs after every guard, so by the time it executes
 * the tenant has been resolved and cross-checked (todo 1.1).
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    TenantResolverService,
    PasswordService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: getConfig, useValue: getConfig },
  ],
  exports: [AuthService, MfaService, TenantResolverService, TokenService, PasswordService],
})
export class AuthModule {}
