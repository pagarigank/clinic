import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RbacController } from "./rbac.controller.js";
import { RbacService } from "./rbac.service.js";
import { PermissionGuard } from "./permission.guard.js";
import { ModuleGuard } from "./module.guard.js";

/**
 * Phase 1.3 RBAC + 1.6 module entitlement wiring (architecture §11.3).
 *
 * Within this module the provider order IS the guard order, and ModuleGuard is
 * declared before PermissionGuard, so the composed chain is:
 *
 *   AuthGuard → TenantContextGuard → StepUpGuard → ModuleGuard → PermissionGuard
 *
 * Module-before-permission is deliberate: a tenant that has not bought a module
 * gets 403 MODULE_NOT_ENTITLED before any permission lookup or data access
 * (specification AC-23). Reversing the two would leak which permissions exist
 * and would make entitlement a permission-layer concern.
 *
 * Like the auth guards both are registered via the APP_GUARD multi-provider —
 * NOT useGlobalGuards — because an instance-bound global guard is constructed
 * outside the injector and silently loses DI under tsx/esbuild.
 */
@Module({
  controllers: [RbacController],
  providers: [
    RbacService,
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [RbacService],
})
export class RbacModule {}
