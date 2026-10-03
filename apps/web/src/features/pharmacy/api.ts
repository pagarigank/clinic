import { apiGet, apiPost } from "../../shared/api/client.js";
import type {
  CreateDispenseRequest,
  PostDispenseRequest,
  VoidDispenseRequest,
  DispenseItemInput,
} from "@clinic/contracts";

export interface PharmacyQueueRow {
  id: string;
  rx_no: string;
  status: string;
  is_controlled: boolean;
  valid_until?: string | null;
  issued_at?: string | null;
  notes?: string | null;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  hrn?: string | null;
  birth_date?: string | null;
  prescriber_id: string;
  prescriber_name: string;
  visit_id: string;
  visit_no: string;
  item_count: number;
}

export interface PrescriptionItemRow {
  id: string;
  drug_product_id: string | null;
  generic_name: string;
  brand_name?: string | null;
  strength?: string | null;
  form?: string | null;
  route?: string | null;
  sig_dose: string;
  sig_frequency: string;
  sig_duration?: string | null;
  qty_prescribed: number | string;
  qty_dispensed: number | string;
  dispense_as_written: boolean;
  item_id: string | null;
  rx_required?: boolean | null;
  controlled_schedule?: string | null;
  high_alert?: boolean | null;
  allergy_class?: string | null;
  item_code?: string | null;
  item_name?: string | null;
}

export interface PrescriptionDetail {
  id: string;
  rx_no: string;
  status: string;
  is_controlled: boolean;
  valid_until?: string | null;
  issued_at?: string | null;
  notes?: string | null;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  hrn?: string | null;
  birth_date?: string | null;
  patient_sex?: string | null;
  prescriber_name?: string | null;
  visit_id?: string | null;
  visit_no?: string | null;
  items: PrescriptionItemRow[];
}

export interface PharmacyStockRow {
  location_id: string;
  batch_id: string;
  qty_on_hand: number | string;
  qty_reserved: number | string;
  batch_no: string;
  expiry_date: string;
  batch_status: string;
  unit_cost: number | string;
  item_id: string;
  item_name: string;
  item_code: string;
  location_name: string;
  rx_required?: boolean | null;
  controlled_schedule?: string | null;
  storage?: string | null;
  high_alert?: boolean | null;
}

export interface DispenseItemRow {
  id: string;
  prescription_item_id?: string | null;
  item_id: string;
  batch_id?: string | null;
  qty: number | string;
  unit_price: number | string;
  total_price: number | string;
  item_name?: string;
  item_code?: string;
  batch_no?: string | null;
  expiry_date?: string | null;
  uom_code?: string;
  override_reason?: string | null;
}

export interface DispenseDetail {
  id: string;
  dispense_no: string;
  status: string;
  rx_id?: string | null;
  rx_no?: string | null;
  patient_id: string;
  patient_first_name?: string;
  patient_last_name?: string;
  hrn?: string | null;
  is_controlled: boolean;
  pharmacist_name?: string | null;
  created_at?: string;
  items: DispenseItemRow[];
}

export interface StockLocation {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  type: string;
}

export const pharmacyApi = {
  getQueue: (status = "ISSUED") =>
    apiGet<PharmacyQueueRow[]>(`/pharmacy/queue?status=${encodeURIComponent(status)}`),

  getPrescription: (id: string) =>
    apiGet<PrescriptionDetail>(`/pharmacy/prescriptions/${id}`),

  listLocations: () =>
    apiGet<StockLocation[]>("/pharmacy/locations"),

  getStock: (params?: { itemId?: string; locationId?: string; nearExpiry?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.itemId) qs.set("itemId", params.itemId);
    if (params?.locationId) qs.set("locationId", params.locationId);
    if (params?.nearExpiry) qs.set("nearExpiry", "true");
    const suffix = qs.toString();
    return apiGet<PharmacyStockRow[]>(`/pharmacy/stock${suffix ? `?${suffix}` : ""}`);
  },

  createDispense: (data: CreateDispenseRequest) =>
    apiPost<DispenseDetail, CreateDispenseRequest>("/pharmacy/dispenses", data),

  allocateFefo: (id: string, locationId: string) =>
    apiPost<DispenseDetail>(`/pharmacy/dispenses/${id}/allocate`, { locationId }),

  getDispense: (id: string) =>
    apiGet<DispenseDetail>(`/pharmacy/dispenses/${id}`),

  postDispense: (id: string, data: PostDispenseRequest) =>
    apiPost<DispenseDetail, PostDispenseRequest>(`/pharmacy/dispenses/${id}/post`, data),

  voidDispense: (id: string, data: VoidDispenseRequest) =>
    apiPost<DispenseDetail, VoidDispenseRequest>(`/pharmacy/dispenses/${id}/void`, data),

  getDispenseLabel: (id: string) =>
    apiGet<Record<string, unknown>>(`/pharmacy/dispenses/${id}/label`),
};

export type { CreateDispenseRequest, PostDispenseRequest, DispenseItemInput };
