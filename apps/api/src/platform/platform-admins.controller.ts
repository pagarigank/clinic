import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import {
  PlatformAdminCreateSchema,
  UserPasswordResetSchema,
  type PlatformAdminCreate,
} from "@clinic/contracts";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { AuthGuard } from "../auth/guards/auth.guard.js";
import { RequireStepUp, type RequestWithAuth } from "../auth/auth-context.js";
import { ModuleAllowlist } from "../rbac/module.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { PlatformAdminsService } from "./platform-admins.service.js";

/**
 * Platform console: tenant administrator lifecycle (specification §18.1,
 * lines 1080–1086). Everything here is platform-scoped and gated per route, so
 * a read-only operator (`platform.admin.read`) can list but not invite or reset.
 *
 * The password/MFA/unlock routes are high-risk and require a fresh step-up
 * token (`X-Step-Up-Token`), matching the tenant-side admin surface
 * (architecture §10).
 */
@ApiTags("Platform")
@ApiBearerAuth()
@Controller("platform")
@UseGuards(AuthGuard)
@ModuleAllowlist()
export class PlatformAdminsController {
  constructor(@Inject(PlatformAdminsService) private readonly admins: PlatformAdminsService) {}

  /** GET /platform/tenants/{id}/admins — cross-tenant administrator list. */
  @Get("tenants/:tenantId/admins")
  @RequirePermission("platform.admin.read")
  @ApiOperation({ summary: "List a tenant's administrators (platform console, metadata only)" })
  async listAdmins(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param("tenantId") tenantId: string,
  ) {
    const auth = request.authContext;
    const admins = await this.admins.listAdmins(tenantId, auth?.platformUserId ?? auth?.userId ?? null);
    return { admins };
  }

  /** POST /platform/tenants/{id}/admins — invite an administrator (INVITED). */
  @Post("tenants/:tenantId/admins")
  @RequirePermission("platform.admin.create")
  @ApiOperation({ summary: "Invite a tenant administrator (born INVITED; sets own password)" })
  async createAdmin(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(PlatformAdminCreateSchema)) body: PlatformAdminCreate,
  ) {
    const auth = request.authContext;
    return this.admins.createAdmin(
      tenantId,
      auth?.platformUserId ?? auth?.userId ?? null,
      body,
    );
  }

  /** POST /platform/tenants/{id}/admins/{uid}/reset-password (step-up). */
  @Post("tenants/:tenantId/admins/:adminId/reset-password")
  @RequirePermission("platform.admin.reset")
  @RequireStepUp()
  @ApiOperation({ summary: "Force-reset a tenant administrator's password (step-up)" })
  async resetAdminPassword(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param("tenantId") tenantId: string,
    @Param("adminId") adminId: string,
    @Body(new ZodValidationPipe(UserPasswordResetSchema)) body: { newPassword: string },
  ) {
    const auth = request.authContext;
    return this.admins.resetAdminPassword(
      tenantId,
      auth?.platformUserId ?? auth?.userId ?? null,
      adminId,
      body,
    );
  }

  /** POST /platform/tenants/{id}/admins/{uid}/reset-mfa (step-up). */
  @Post("tenants/:tenantId/admins/:adminId/reset-mfa")
  @RequirePermission("platform.admin.reset")
  @RequireStepUp()
  @ApiOperation({ summary: "Clear a tenant administrator's MFA enrolment (step-up)" })
  async resetAdminMfa(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param("tenantId") tenantId: string,
    @Param("adminId") adminId: string,
  ) {
    const auth = request.authContext;
    return this.admins.resetAdminMfa(
      tenantId,
      auth?.platformUserId ?? auth?.userId ?? null,
      adminId,
    );
  }

  /** POST /platform/tenants/{id}/users/{uid}/unlock (step-up). */
  @Post("tenants/:tenantId/users/:userId/unlock")
  @RequirePermission("platform.user.read")
  @RequireStepUp()
  @ApiOperation({ summary: "Clear a lockout on one of a tenant's users (step-up)" })
  async unlockUser(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
  ) {
    const auth = request.authContext;
    return this.admins.unlockUser(
      tenantId,
      auth?.platformUserId ?? auth?.userId ?? null,
      userId,
    );
  }
}
