import { withTenant } from '@clinic/db';

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Resolve the billable unit price for a catalog service (specification §5.1).
 *
 * Precedence: the most recent effective-dated `price_lists` row, then
 * `service_catalog.default_price`. Returns 0 when the service has no price.
 *
 * This is the only place a charge price may come from — callers must never
 * trust a client-supplied price (todo §49: no client-side money computation).
 */
export async function resolveServicePrice(tx: Tx, tenantId: string, serviceId: string): Promise<number> {
  const override = await tx.query(
    `SELECT amount
       FROM price_lists
      WHERE tenant_id = $1 AND service_id = $2
        AND effective_from <= CURRENT_DATE
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [tenantId, serviceId],
  );
  if (override.rows[0]) return Number(override.rows[0].amount);

  const base = await tx.query(
    `SELECT default_price FROM service_catalog WHERE tenant_id = $1 AND id = $2`,
    [tenantId, serviceId],
  );
  return base.rows[0] ? Number(base.rows[0].default_price) : 0;
}
