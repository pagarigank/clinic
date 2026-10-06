import { apiGet, apiPost } from "../../shared/api/client.js";

/**
 * Central supply department-requisition API.
 *
 * Field names here mirror the server's snake_case payload. The Requisitions page
 * previously invented rows client-side (a random `REQ-2026-####`, `Date.now()` ids,
 * and status changes applied to local React state only), so it looked like a working
 * requisition flow while nothing was ever written and no approval could follow.
 */

export interface SupplyRequisition {
  id: string;
  req_no: string;
  branch_id: string;
  type: string;
  status: string;
  needed_by: string | null;
  from_location_id: string;
  from_location_name: string;
  to_location_id: string;
  to_location_name: string;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  /** Present only on rows this session created; the list endpoint does not join items. */
  items?: RequisitionItem[];
}

export interface RequisitionItem {
  item_id: string;
  item_name: string;
  qty_requested: number;
  qty_issued: number;
  qty_received: number;
}

export interface CreateRequisitionLine {
  itemId: string;
  qtyRequested: number;
  uomId: string;
}

export async function listRequisitions(): Promise<SupplyRequisition[]> {
  const res = await apiGet<SupplyRequisition[] | { data: SupplyRequisition[] }>(
    "/supply/requisitions",
  );
  return Array.isArray(res) ? res : (res?.data ?? []);
}

export async function createRequisition(body: {
  branchId: string;
  fromLocationId: string;
  toLocationId: string;
  type?: "ADHOC" | "PAR" | "STAT";
  neededBy?: string;
  items: CreateRequisitionLine[];
}): Promise<SupplyRequisition> {
  return apiPost<SupplyRequisition>("/supply/requisitions", body);
}

/**
 * The create endpoint persists the requisition already in DRAFT, so a freshly created
 * requisition is submitted straight away — that is the state the approval queue reads.
 */
export async function submitRequisition(id: string): Promise<SupplyRequisition> {
  return apiPost<SupplyRequisition>(`/supply/requisitions/${id}/submit`, {});
}

export async function approveRequisition(id: string): Promise<SupplyRequisition> {
  return apiPost<SupplyRequisition>(`/supply/requisitions/${id}/approve`, {});
}
