import { Injectable } from "@nestjs/common";
import { getAppPool } from "@clinic/db";

/**
 * Pre-auth tenant resolution (architecture §5.6 step 1): slug →
 * `tenant_directory`. Runs BEFORE any tenant context exists — the table is
 * deliberately outside RLS (0003) and the login flow then opens its
 * transaction inside the resolved tenant so every identity write
 * (users/sessions/login_attempts) is RLS-scoped from the first query.
 */
export interface DirectoryTenant {
  id: string;
  slug: string;
  status: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "OFFBOARDING" | "OFFBOARDED";
}

/** Extract a tenant slug from the request host (subdomain) if present. */
export function slugFromHost(hostname: string): string | null {
  const host = hostname.split(":")[0]!.toLowerCase();
  const labels = host.split(".").filter(Boolean);
  // demo-a.clinic.test → demo-a ; demo-b.localhost → demo-b (dev loopback);
  // bare localhost / reserved first labels → none.
  const RESERVED = new Set(["www", "api", "app", "admin", "127", "0"]);
  const isLocalhost = host === "localhost" || host.endsWith(".localhost");
  if (isLocalhost) {
    return labels.length >= 2 && !RESERVED.has(labels[0]!) ? labels[0]! : null;
  }
  if (labels.length >= 3 && !RESERVED.has(labels[0]!)) {
    return labels[0]!;
  }
  return null;
}

@Injectable()
export class TenantResolverService {
  async resolveBySlug(slug: string): Promise<DirectoryTenant | null> {
    const result = await getAppPool().query<DirectoryTenant>(
      `SELECT id, slug, status::text AS status FROM tenant_directory WHERE slug = $1`,
      [slug.toLowerCase()],
    );
    return result.rows[0] ?? null;
  }

  async resolveById(id: string): Promise<DirectoryTenant | null> {
    const result = await getAppPool().query<DirectoryTenant>(
      `SELECT id, slug, status::text AS status FROM tenant_directory WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }
}
