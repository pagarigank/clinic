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
  const RESERVED = new Set(["www", "api", "app", "admin", "clinic", "platform", "portal", "127", "0"]);
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
    if (!slug) return null;
    const raw = slug.toLowerCase().trim();
    // 1. Direct match
    let result = await getAppPool().query<DirectoryTenant>(
      `SELECT id, slug, status::text AS status FROM tenant_directory WHERE slug = $1`,
      [raw],
    );
    if (result.rows[0]) return result.rows[0];

    // 2. Strip common domain suffixes (e.g. la-salette.emr -> la-salette)
    const stripped = raw.replace(/\.(emr|test|clinic\.ph|clinic|ph|com|local|org|net)$/i, "").trim();
    if (stripped && stripped !== raw) {
      result = await getAppPool().query<DirectoryTenant>(
        `SELECT id, slug, status::text AS status FROM tenant_directory WHERE slug = $1`,
        [stripped],
      );
      if (result.rows[0]) return result.rows[0];
    }

    // 3. Normalize spaces or underscores to hyphens (e.g. "la salette" -> "la-salette")
    const hyphenated = (stripped || raw).replace(/[\s_]+/g, "-");
    if (hyphenated && hyphenated !== raw && hyphenated !== stripped) {
      result = await getAppPool().query<DirectoryTenant>(
        `SELECT id, slug, status::text AS status FROM tenant_directory WHERE slug = $1`,
        [hyphenated],
      );
      if (result.rows[0]) return result.rows[0];
    }

    return null;
  }

  async resolveById(id: string): Promise<DirectoryTenant | null> {
    const result = await getAppPool().query<DirectoryTenant>(
      `SELECT id, slug, status::text AS status FROM tenant_directory WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }
}
