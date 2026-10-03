import { apiGet, apiPost, apiPatch, apiDelete } from "../../shared/api/client.js";
import type {
  CreateLabOrderRequest,
  CollectSpecimenRequest,
  ReceiveSpecimenRequest,
  EnterLabResultsRequest,
  AmendLabResultRequest,
  AckCriticalNotificationRequest,
  ReleaseLabReportRequest,
  CreateLabQcRunRequest,
  CreateLabTestRequest,
  BulkPriceAdjustRequest,
} from "@clinic/contracts";

export interface LabSection {
  id: string;
  code: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface LabSpecimenType {
  id: string;
  code: string;
  name: string;
  default_container: string;
  tube_top_color?: string;
  is_active: boolean;
}

export interface LabAnalyte {
  id: string;
  test_id: string;
  code: string;
  name: string;
  default_unit: string;
  precision_digits: number;
  is_calculated: boolean;
  calculation_formula?: string;
  sort_order: number;
  is_active: boolean;
  reference_range?: {
    normal_min?: number;
    normal_max?: number;
    critical_low?: number;
    critical_high?: number;
    text_range?: string;
  };
}

export interface LabTest {
  id: string;
  section_id: string;
  specimen_type_id: string;
  code: string;
  name: string;
  loinc_code?: string;
  tat_minutes: number;
  is_stat_allowed: boolean;
  is_confidential: boolean;
  fasting_required: boolean;
  fasting_hours?: number;
  instructions?: string;
  is_panel: boolean;
  requires_pathologist_review: boolean;
  is_active: boolean;
  price?: number;
  section_name?: string;
  specimen_type_name?: string;
  analytes?: LabAnalyte[];
  panelTests?: Array<{ child_test_id: string; code: string; name: string }>;
}

export interface LabInstrument {
  id: string;
  branch_id: string;
  section_id: string;
  code: string;
  name: string;
  model?: string;
  serial_no?: string;
  calibration_due_at?: string;
  last_calibrated_at?: string;
  is_active: boolean;
  section_name?: string;
  branch_name?: string;
}

export interface WorklistItem {
  order_item_id: string;
  order_id: string;
  order_no: string;
  priority: "ROUTINE" | "URGENT" | "STAT";
  item_status: "ORDERED" | "COLLECTED" | "RECEIVED" | "IN_PROGRESS" | "RESULTED" | "VERIFIED" | "RELEASED" | "CANCELLED" | "REJECTED";
  test_id: string;
  test_code: string;
  test_name: string;
  is_panel: boolean;
  requires_pathologist_review: boolean;
  tat_minutes: number;
  is_confidential: boolean;
  patient_id: string;
  mrn?: string;
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  accession_no?: string;
  specimen_type_id?: string;
  specimen_condition?: string;
  specimen_type_name?: string;
  tube_top_color?: string;
  ordered_at: string;
  collected_at?: string;
  received_at?: string;
  result_entered_at?: string;
  result_verified_at?: string;
}

export interface LabResultValue {
  id: string;
  tenant_id: string;
  order_item_id: string;
  analyte_id: string;
  analyte_code: string;
  analyte_name: string;
  default_unit: string;
  precision_digits: number;
  is_calculated: boolean;
  calculation_formula?: string;
  value_numeric?: number | null;
  value_text?: string | null;
  flag?: "LL" | "L" | "N" | "H" | "HH" | "A" | null;
  status: "DRAFT" | "PRELIMINARY" | "VERIFIED" | "AMENDED";
  instrument_id?: string;
  entered_by: string;
  entered_by_name?: string;
  entered_at: string;
  verified_by?: string;
  verified_by_name?: string;
  verified_at?: string;
  delta_flag?: boolean;
  previous_value?: number | null;
  reference_range?: {
    normal_min?: number;
    normal_max?: number;
    critical_low?: number;
    critical_high?: number;
    text_range?: string;
  };
}

export interface CriticalAlert {
  id: string;
  result_id: string;
  order_id: string;
  order_no: string;
  patient_id: string;
  patient_name: string;
  mrn?: string;
  test_name: string;
  analyte_name: string;
  value: string;
  unit: string;
  flag: "HH" | "LL";
  created_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  acknowledged_by_name?: string;
  communication_method?: "IN_APP" | "PHONE" | "SMS";
  read_back_confirmed?: boolean;
  read_back_text?: string;
  is_escalated?: boolean;
  escalated_at?: string;
}

export interface LabQcMaterial {
  id: string;
  section_id: string;
  code: string;
  name: string;
  manufacturer?: string;
  lot_no: string;
  expiry_date: string;
  is_active: boolean;
  section_name?: string;
}

export interface LabQcRun {
  id: string;
  instrument_id: string;
  material_id: string;
  run_at: string;
  run_by: string;
  status: "ACCEPTED" | "REJECTED";
  corrective_action?: string;
  instrument_name?: string;
  material_name?: string;
  lot_no?: string;
  results?: Array<{
    id: string;
    analyte_id: string;
    analyte_name: string;
    value_num: number;
    target_mean: number;
    target_sd: number;
    z_score: number;
    westgard_flags?: string;
    is_accepted: boolean;
  }>;
}

export interface LabReport {
  id: string;
  order_id: string;
  version: number;
  report_hash: string;
  issued_at: string;
  issued_by: string;
  issued_by_name?: string;
  status: "PRELIMINARY" | "FINAL" | "CORRECTED";
  report_data: any;
}

// ── API Methods ──────────────────────────────────────────────────────────────

export const labApi = {
  // Configuration
  listSections: () => apiGet<LabSection[]>("/lab/sections"),
  listSpecimenTypes: () => apiGet<LabSpecimenType[]>("/lab/specimen-types"),
  listTests: (params?: { isPanel?: boolean; sectionId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.isPanel !== undefined) qs.set("isPanel", String(params.isPanel));
    if (params?.sectionId) qs.set("sectionId", params.sectionId);
    return apiGet<LabTest[]>(`/lab/tests?${qs.toString()}`);
  },
  getTest: (id: string) => apiGet<LabTest>(`/lab/tests/${id}`),
  createTest: (data: CreateLabTestRequest & { price?: number }) => apiPost<LabTest>("/lab/tests", data),
  updateTest: (id: string, data: Partial<CreateLabTestRequest> & { price?: number }) => apiPatch<LabTest>(`/lab/tests/${id}`, data),
  deleteTest: (id: string) => apiDelete<{ success: boolean }>(`/lab/tests/${id}`),
  bulkAdjustPricing: (data: BulkPriceAdjustRequest) => apiPost<{ adjustedCount: number; message: string }>("/admin/pricing/bulk-adjust", data),
  listInstruments: (branchId?: string) => {
    const qs = branchId ? `?branchId=${branchId}` : "";
    return apiGet<LabInstrument[]>(`/lab/instruments${qs}`);
  },
  listQcMaterials: (sectionId?: string) => {
    const qs = sectionId ? `?sectionId=${sectionId}` : "";
    return apiGet<LabQcMaterial[]>(`/lab/qc-materials${qs}`);
  },

  // Worklist & Orders
  getWorklist: (params?: { sectionId?: string; priority?: string; status?: string; ageHours?: number }) => {
    const qs = new URLSearchParams();
    if (params?.sectionId) qs.set("sectionId", params.sectionId);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.status) qs.set("status", params.status);
    if (params?.ageHours) qs.set("ageHours", String(params.ageHours));
    return apiGet<WorklistItem[]>(`/lab/worklist?${qs.toString()}`);
  },
  getOrder: (id: string) => apiGet<any>(`/lab/orders/${id}`),
  createOrder: (data: CreateLabOrderRequest) => apiPost<any>("/lab/orders", data),
  cancelOrder: (id: string, reason: string) => apiPost<any>(`/lab/orders/${id}/cancel`, { reason }),

  // Specimens
  collectSpecimen: (orderId: string, itemId: string, data: CollectSpecimenRequest) =>
    apiPost<any>(`/lab/orders/${orderId}/items/${itemId}/collect`, data),
  receiveSpecimen: (orderId: string, itemId: string, data: ReceiveSpecimenRequest) =>
    apiPost<any>(`/lab/orders/${orderId}/items/${itemId}/receive`, data),
  listSpecimens: (accession?: string) => {
    const qs = accession ? `?accession=${accession}` : "";
    return apiGet<any[]>(`/lab/specimens${qs}`);
  },
  getSpecimenEvents: (id: string) => apiGet<any[]>(`/lab/specimens/${id}/events`),

  // Results & Verification
  startRun: (orderId: string, itemId: string) =>
    apiPost<any>(`/lab/orders/${orderId}/items/${itemId}/start`, {}),
  getItemResults: (orderId: string, itemId: string, confidentialReason?: string) => {
    const qs = confidentialReason ? `?confidentialReason=${encodeURIComponent(confidentialReason)}` : "";
    return apiGet<LabResultValue[]>(`/lab/orders/${orderId}/items/${itemId}/results${qs}`);
  },
  enterResults: (orderId: string, itemId: string, data: EnterLabResultsRequest) =>
    apiPost<any>(`/lab/orders/${orderId}/items/${itemId}/results`, data),
  verifyResult: (resultId: string) =>
    apiPost<any>(`/lab/results/${resultId}/verify`, {}),
  amendResult: (resultId: string, data: AmendLabResultRequest) =>
    apiPost<any>(`/lab/results/${resultId}/amend`, data),
  getAmendments: (resultId: string) =>
    apiGet<any[]>(`/lab/results/${resultId}/amendments`),

  // Critical Alerts
  listCriticalAlerts: (acknowledged?: boolean) => {
    const qs = acknowledged !== undefined ? `?acknowledged=${acknowledged}` : "";
    return apiGet<CriticalAlert[]>(`/lab/critical-alerts${qs}`);
  },
  acknowledgeCriticalAlert: (id: string, data: AckCriticalNotificationRequest) =>
    apiPost<any>(`/lab/critical-alerts/${id}/acknowledge`, data),

  // Reports
  releaseReport: (orderId: string, data: ReleaseLabReportRequest) =>
    apiPost<any>(`/lab/orders/${orderId}/report`, data),
  listReports: (orderId: string) =>
    apiGet<LabReport[]>(`/lab/orders/${orderId}/reports`),
  getReport: (id: string) =>
    apiGet<LabReport>(`/lab/reports/${id}`),

  // QC
  listQcRuns: (instrumentId?: string) => {
    const qs = instrumentId ? `?instrumentId=${instrumentId}` : "";
    return apiGet<LabQcRun[]>(`/lab/qc-runs${qs}`);
  },
  createQcRun: (data: CreateLabQcRunRequest) =>
    apiPost<any>("/lab/qc-runs", data),

  // TAT
  getTatMetrics: () => apiGet<any>("/lab/tat"),
};
