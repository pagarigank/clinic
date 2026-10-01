import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  RoleCloneSchema,
  RoleCreateSchema,
  RoleUpdateSchema,
  UserBranchAssignSchema,
  UserRoleAssignSchema,
  zodUuid,
  type EffectivePermissions,
  type PermissionDto,
  type RoleDto,
} from "@clinic/contracts";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { ProblemException } from "../http/problem.exception.js";
import { RequireStepUp, type RequestWithAuth } from "../auth/auth-context.js";
import { RbacService } from "./rbac.service.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { Module, ModuleAllowlist } from "./module.guard.js";

type AuthedRequest = FastifyRequest & RequestWithAuth;

function caller(request: AuthedRequest): { tenantId: string; userId: string; branchId: string | null } {
  const auth = request.authContext;
  if (auth?.kind !== "user" || !auth.tenantId || !auth.userId) {
    throw new ProblemException("FORBIDDEN", { detail: "interactive tenant session required" });
  }
  return { tenantId: auth.tenantId, userId: auth.userId, branchId: auth.branchId };
}

@Controller("api/v1")
// Roles, permission grants and the catalogue are the `admin` module
// (specification §2.3: admin.role.*, admin.user.*). Declared at class level so
// the global ModuleGuard gates every route here with one declaration; a
// forgotten method-level @Module() then inherits `admin` rather than leaking.
@Module("admin")
export class RbacController {
  constructor(@Inject(RbacService) private readonly rbac: RbacService) {}

  // ---- catalogue -----------------------------------------------------------

  @RequirePermission("admin.role.read")
  @Get("admin/permissions")
  permissionMatrix(): Array<{ module: string; permissions: PermissionDto[] }> {
    return this.rbac.permissionMatrix();
  }

  // ---- roles -----------------------------------------------------------------

  @RequirePermission("admin.role.read")
  @Get("admin/roles")
  listRoles(@Req() request: AuthedRequest): Promise<RoleDto[]> {
    const { tenantId, userId } = caller(request);
    return this.rbac.listRoles(tenantId, userId);
  }

  @RequirePermission("admin.role.read")
  @Get("admin/roles/:id")
  getRole(
    @Req() request: AuthedRequest,
    @Param("id", new ZodValidationPipe(zodUuid)) id: string,
  ): Promise<RoleDto> {
    const { tenantId, userId } = caller(request);
    return this.rbac.getRole(tenantId, userId, id);
  }

  @RequirePermission("admin.role.create")
  @Post("admin/roles")
  createRole(
    @Req() request: AuthedRequest,
    @Body(new ZodValidationPipe(RoleCreateSchema)) dto: RoleCreateInput,
  ): Promise<RoleDto> {
    const { tenantId, userId } = caller(request);
    return this.rbac.createRole(tenantId, userId, dto);
  }

  @RequirePermission("admin.role.update")
  @Patch("admin/roles/:id")
  updateRole(
    @Req() request: AuthedRequest,
    @Param("id", new ZodValidationPipe(zodUuid)) id: string,
    @Body(new ZodValidationPipe(RoleUpdateSchema)) dto: RoleUpdateInput,
  ): Promise<RoleDto> {
    const { tenantId, userId } = caller(request);
    return this.rbac.updateRole(tenantId, userId, id, dto.rowVersion, dto);
  }

  @RequirePermission("admin.role.delete")
  @RequireStepUp()
  @Delete("admin/roles/:id")
  deleteRole(
    @Req() request: AuthedRequest,
    @Param("id", new ZodValidationPipe(zodUuid)) id: string,
  ): Promise<void> {
    const { tenantId, userId } = caller(request);
    return this.rbac.deleteRole(tenantId, userId, id);
  }

  @RequirePermission("admin.role.create")
  @Post("admin/roles/:id/clone")
  cloneRole(
    @Req() request: AuthedRequest,
    @Param("id", new ZodValidationPipe(zodUuid)) id: string,
    @Body(new ZodValidationPipe(RoleCloneSchema)) body: RoleCloneInput,
  ): Promise<RoleDto> {
    const { tenantId, userId } = caller(request);
    return this.rbac.cloneRole(tenantId, userId, id, body);
  }

  // ---- user assignment ---------------------------------------------------------

  @RequirePermission("admin.user.update")
  @RequireStepUp()
  @Put("admin/users/:id/roles")
  async assignUserRoles(
    @Req() request: AuthedRequest,
    @Param("id", new ZodValidationPipe(zodUuid)) id: string,
    @Body(new ZodValidationPipe(UserRoleAssignSchema.omit({ userId: true })))
    dto: { roleIds: string[]; branchId?: string | null },
  ): Promise<{ assigned: number }> {
    const { tenantId, userId } = caller(request);
    await this.rbac.assignUserRoles(tenantId, userId, { ...dto, userId: id });
    return { assigned: dto.roleIds.length };
  }

  @RequirePermission("admin.user.read")
  @Get("admin/users/:id/roles")
  async getUserRoles(
    @Req() request: AuthedRequest,
    @Param("id", new ZodValidationPipe(zodUuid)) id: string,
  ): Promise<RoleDto[]> {
    const { tenantId, userId } = caller(request);
    const assignedIds = await this.rbac.roleIdsForUser(tenantId, userId, id);
    const all = await this.rbac.listRoles(tenantId, userId);
    return all.filter((r) => assignedIds.has(r.id));
  }

  @RequirePermission("admin.user.update")
  @RequireStepUp()
  @Put("admin/users/:id/branches")
  async assignUserBranches(
    @Req() request: AuthedRequest,
    @Param("id", new ZodValidationPipe(zodUuid)) id: string,
    @Body(new ZodValidationPipe(UserBranchAssignSchema)) dto: { branchIds: string[]; defaultBranchId?: string | null },
  ): Promise<{ assigned: number }> {
    const { tenantId, userId } = caller(request);
    await this.rbac.assignUserBranches(tenantId, userId, id, dto);
    return { assigned: dto.branchIds.length };
  }

  // ---- caller self-view (no admin permission required) ---------------------------

  // Every user needs their own effective permission set to render the UI,
  // including a user whose tenant has no `admin` module. Gating this on the
  // admin entitlement would lock a receptionist out of their own permissions.
  @ModuleAllowlist()
  @Get("auth/permissions")
  effectivePermissions(@Req() request: AuthedRequest): Promise<EffectivePermissions> {
    const { tenantId, userId, branchId } = caller(request);
    return this.rbac.effectiveForCaller(tenantId, userId, branchId);
  }
}

interface RoleCreateInput {
  code: string;
  name: string;
  permissions?: string[];
}
interface RoleUpdateInput {
  name?: string;
  permissions?: string[];
  rowVersion?: number;
}
interface RoleCloneInput {
  code: string;
  name: string;
}
