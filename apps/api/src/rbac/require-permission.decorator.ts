import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSION_KEY = "requiredPermission";

/**
 * Declare the permission a route needs (specification §2.3 naming
 * `<module>.<resource>.<action>`). Evaluated by PermissionGuard — the LAST
 * guard in the APP_GUARD chain (architecture §11.3):
 * auth → tenant → step-up → module (1.6) → permission.
 *
 * ```ts
 * @RequirePermission("admin.role.read")
 * @Get("roles")
 * list() {}
 * ```
 */
export const RequirePermission = (permission: string): MethodDecorator =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
