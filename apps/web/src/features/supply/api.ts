import { apiGet, apiPost, apiPatch } from "../../shared/api/client.js";
import type {
  PostConsumptionRequest,
  CreateItemRequest,
  UpdateItemRequest,
  BulkPriceAdjustRequest,
} from "@clinic/contracts";

export interface SupplyItemRow {
  id: string;
  code: string;
  name: string;
  item_type: string;
  base_uom_id: string;
  uom_code?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  total_on_hand?: number | string;
  is_batch_tracked: boolean;
  is_expiry_tracked: boolean;
  is_hazardous?: boolean;
  standard_cost: number | string;
  price: number | string;
  service_id?: string | null;
  min_shelf_life_days_on_receipt?: number | string;
  is_active?: boolean;
}

export interface SupplyUom {
  id: string;
  code: string;
  name: string;
}

export interface SupplyCategory {
  id: string;
  name: string;
  description?: string | null;
}

export interface SupplyLocation {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  type: string;
}

export interface SupplyStockRow {
  location_id: string;
  batch_id: string;
  qty_on_hand: number | string;
  qty_reserved: number | string;
  location_name: string;
  lot_no: string;
  expiry_date: string;
  unit_cost: number | string;
  batch_status: string;
  item_id: string;
  item_name: string;
  item_code: string;
  total_value: number | string;
}

export const supplyApi = {
  listItems: (params?: { itemType?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.itemType && params.itemType !== "ALL") qs.set("itemType", params.itemType);
    if (params?.search) qs.set("search", params.search);
    const suffix = qs.toString();
    return apiGet<SupplyItemRow[]>(`/supply/items${suffix ? `?${suffix}` : ""}`);
  },

  getItem: (id: string) => apiGet<SupplyItemRow>(`/supply/items/${id}`),

  createItem: (data: CreateItemRequest) =>
    apiPost<SupplyItemRow, CreateItemRequest>("/supply/items", data),

  updateItem: (id: string, data: UpdateItemRequest) =>
    apiPatch<SupplyItemRow, UpdateItemRequest>(`/supply/items/${id}`, data),

  listUoms: () => apiGet<SupplyUom[]>("/supply/uoms"),

  listCategories: () => apiGet<SupplyCategory[]>("/supply/categories"),

  listLocations: (branchId?: string) =>
    apiGet<SupplyLocation[]>(
      `/supply/locations${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`,
    ),

  getStock: (params?: { itemId?: string; locationId?: string; nearExpiryDays?: number }) => {
    const qs = new URLSearchParams();
    if (params?.itemId) qs.set("itemId", params.itemId);
    if (params?.locationId) qs.set("locationId", params.locationId);
    if (params?.nearExpiryDays) qs.set("nearExpiryDays", String(params.nearExpiryDays));
    const suffix = qs.toString();
    return apiGet<SupplyStockRow[]>(`/supply/stock${suffix ? `?${suffix}` : ""}`);
  },

  postConsumption: (data: PostConsumptionRequest) =>
    apiPost<Record<string, unknown>, PostConsumptionRequest>("/supply/consumption", data),

  bulkAdjustPricing: (data: BulkPriceAdjustRequest) =>
    apiPost<{ adjustedCount: number; message: string }>("/admin/pricing/bulk-adjust", data),
};

export type { PostConsumptionRequest, CreateItemRequest, UpdateItemRequest, BulkPriceAdjustRequest };
