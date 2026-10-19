import { apiGet, apiPost, apiPatch, apiDelete, apiGetBlob } from "../../shared/api/client.js";
import type {
  CreateRenalStationRequest,
  UpdateRenalStationRequest,
  CreateDialysisMachineRequest,
  UpdateDialysisMachineRequest,
  ServiceDialysisMachineRequest,
  CreateVascularAccessRequest,
  CreateAccessAssessmentRequest,
  CreateDialysisPrescriptionRequest,
  SignDialysisPrescriptionRequest,
  CreateDialyzerRequest,
  ReprocessDialyzerRequest,
  DiscardDialyzerRequest,
  CreateWaterTreatmentLogRequest,
  CreateWaterLabTestRequest,
  CreateDialysisSessionRequest,
  PreDialysisIntakeRequest,
  RecordFlowsheetRequest,
  PostDialysisCloseRequest,
  CancelDialysisSessionRequest,
} from "@clinic/contracts";

export interface RenalStation {
  id: string;
  tenant_id: string;
  branch_id: string;
  station_no: string;
  name: string;
  room?: string | null;
  is_isolation: boolean;
  is_active: boolean;
  created_at: string;
}

export interface DialysisMachine {
  id: string;
  tenant_id: string;
  branch_id: string;
  station_id?: string | null;
  serial_no: string;
  brand: string;
  model: string;
  total_operating_hours: string | number;
  last_disinfected_at?: string | null;
  last_serviced_at?: string | null;
  status: "ACTIVE" | "MAINTENANCE" | "QUARANTINE" | "DECOMMISSIONED";
  is_isolation: boolean;
}

export interface VascularAccess {
  id: string;
  tenant_id: string;
  patient_id: string;
  access_type: "AV_FISTULA" | "AV_GRAFT" | "TUNNELED_CATHETER" | "TEMPORARY_CATHETER";
  anatomical_site: string;
  side: "LEFT" | "RIGHT";
  surgeon_name?: string | null;
  created_date?: string | null;
  status: "ACTIVE" | "MATURING" | "FAILED" | "ABANDONED";
  notes?: string | null;
}

export interface DialysisPrescription {
  id: string;
  tenant_id: string;
  patient_id: string;
  nephrologist_id: string;
  modality: "HD" | "HDF_ONLINE" | "HF";
  frequency_per_week: number;
  duration_minutes: number;
  target_dry_weight_kg: string | number;
  dialyzer_model: string;
  dialysate_formula: string;
  blood_flow_rate_target: number;
  dialysate_flow_rate_target: number;
  status: "DRAFT" | "ACTIVE" | "AMENDED" | "DISCONTINUED";
  signed_at?: string | null;
  hbv_hbsag_positive?: boolean;
}

export interface DialysisShift {
  id: string;
  tenant_id: string;
  branch_id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  days_of_week?: number[];
  is_active: boolean;
}

export interface Dialyzer {
  id: string;
  tenant_id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
  serial_barcode: string;
  dialyzer_model: string;
  baseline_volume_ml: string | number;
  current_volume_ml: string | number;
  reuse_count: number;
  max_allowed_reuses: number;
  status: "CLEANED_READY" | "IN_USE" | "PENDING_REPROCESS" | "DISCARDED";
  first_used_date?: string | null;
  discarded_at?: string | null;
  discard_reason?: string | null;
}

export interface WaterTreatmentLog {
  id: string;
  tenant_id: string;
  branch_id: string;
  log_date: string;
  shift_name?: string | null;
  tested_by: string;
  carbon_breakthrough_chlorine_ppm: string | number;
  ro_conductivity_us: string | number;
  ro_rejection_rate_pct: string | number;
  status: "COMPLIANT" | "ACTION_REQUIRED";
  notes?: string | null;
  created_at: string;
}

export interface DialysisSession {
  id: string;
  tenant_id: string;
  session_no: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
  branch_id: string;
  station_id: string;
  station_no?: string;
  machine_id: string;
  machine_serial?: string;
  prescription_id: string;
  access_id?: string | null;
  dialyzer_id: string;
  dialyzer_barcode?: string;
  dialyzer_model?: string;
  scheduled_date: string;
  shift_id: string;
  status: "SCHEDULED" | "PRE_DIALYSIS" | "IN_PROGRESS" | "POST_DIALYSIS" | "COMPLETED" | "CANCELLED" | "INTERRUPTED";
  started_at?: string | null;
  completed_at?: string | null;
  primary_nurse_id: string;
  attending_nephrologist_id?: string | null;
  total_uf_removed_liters?: string | number | null;
  actual_duration_minutes?: number | null;
  preAssessment?: any;
  flowsheet?: any[];
  postAssessment?: any;
}

export interface PhilHealthUsage {
  patientId: string;
  calendarYear: number;
  sessionCount: number;
  maxBenefitSessions: number;
  remainingSessions: number;
  isExceeded: boolean;
}

export const renalApi = {
  // Stations & Machines
  getStations: (branchId?: string) =>
    apiGet<RenalStation[]>(`/renal/stations${branchId ? `?branchId=${branchId}` : ""}`),
  createStation: (dto: CreateRenalStationRequest) =>
    apiPost<RenalStation>("/renal/stations", dto),
  updateStation: (id: string, dto: UpdateRenalStationRequest) =>
    apiPatch<RenalStation>(`/renal/stations/${id}`, dto),
  archiveStation: (id: string) =>
    apiDelete<RenalStation>(`/renal/stations/${id}`),
  getMachines: (branchId?: string) =>
    apiGet<DialysisMachine[]>(`/renal/machines${branchId ? `?branchId=${branchId}` : ""}`),
  createMachine: (dto: CreateDialysisMachineRequest) =>
    apiPost<DialysisMachine>("/renal/machines", dto),
  updateMachine: (id: string, dto: UpdateDialysisMachineRequest) =>
    apiPatch<DialysisMachine>(`/renal/machines/${id}`, dto),
  serviceMachine: (id: string, dto: ServiceDialysisMachineRequest) =>
    apiPost<DialysisMachine>(`/renal/machines/${id}/service`, dto),

  // Accesses
  getAccesses: (patientId?: string) =>
    apiGet<VascularAccess[]>(`/renal/accesses${patientId ? `?patientId=${patientId}` : ""}`),
  createAccess: (dto: CreateVascularAccessRequest) =>
    apiPost<VascularAccess>("/renal/accesses", dto),
  createAssessment: (accessId: string, dto: CreateAccessAssessmentRequest) =>
    apiPost<any>(`/renal/accesses/${accessId}/assessments`, dto),

  // Prescriptions
  getPrescriptions: (patientId?: string) =>
    apiGet<DialysisPrescription[]>(`/renal/prescriptions${patientId ? `?patientId=${patientId}` : ""}`),
  createPrescription: (dto: CreateDialysisPrescriptionRequest) =>
    apiPost<DialysisPrescription>("/renal/prescriptions", dto),
  signPrescription: (id: string, dto: SignDialysisPrescriptionRequest) =>
    apiPost<DialysisPrescription>(`/renal/prescriptions/${id}/sign`, dto),

  // Dialyzers
  getDialyzers: (patientId?: string) =>
    apiGet<Dialyzer[]>(`/renal/dialyzers${patientId ? `?patientId=${patientId}` : ""}`),
  createDialyzer: (dto: CreateDialyzerRequest) =>
    apiPost<Dialyzer>("/renal/dialyzers", dto),
  reprocessDialyzer: (id: string, dto: ReprocessDialyzerRequest) =>
    apiPost<{ dialyzer: Dialyzer; reprocessingId: string; passed: boolean; discardReason?: string }>(
      `/renal/dialyzers/${id}/reprocess`,
      dto,
    ),
  discardDialyzer: (id: string, dto: DiscardDialyzerRequest) =>
    apiPost<Dialyzer>(`/renal/dialyzers/${id}/discard`, dto),

  // Water Safety
  getWaterLogs: (branchId?: string, logDate?: string) => {
    const params = new URLSearchParams();
    if (branchId) params.append("branchId", branchId);
    if (logDate) params.append("logDate", logDate);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return apiGet<WaterTreatmentLog[]>(`/renal/water-treatment/logs${qs}`);
  },
  createWaterLog: (dto: CreateWaterTreatmentLogRequest) =>
    apiPost<WaterTreatmentLog>("/renal/water-treatment/logs", dto),
  createWaterLabTest: (dto: CreateWaterLabTestRequest) =>
    apiPost<any>("/renal/water-treatment/lab-tests", dto),

  // Sessions
  getSessions: (filters?: { branchId?: string; scheduledDate?: string; status?: string; patientId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.branchId) params.append("branchId", filters.branchId);
    if (filters?.scheduledDate) params.append("scheduledDate", filters.scheduledDate);
    if (filters?.status) params.append("status", filters.status);
    if (filters?.patientId) params.append("patientId", filters.patientId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return apiGet<DialysisSession[]>(`/renal/sessions${qs}`);
  },
  getSession: (id: string) =>
    apiGet<DialysisSession>(`/renal/sessions/${id}`),
  createSession: (dto: CreateDialysisSessionRequest) =>
    apiPost<DialysisSession>("/renal/sessions", dto),
  startPreDialysis: (id: string, dto: PreDialysisIntakeRequest) =>
    apiPost<DialysisSession>(`/renal/sessions/${id}/pre-dialysis`, dto),
  recordFlowsheet: (id: string, dto: RecordFlowsheetRequest) =>
    apiPost<any>(`/renal/sessions/${id}/flowsheet`, dto),
  completePostDialysis: (id: string, dto: PostDialysisCloseRequest) =>
    apiPost<{ session: DialysisSession; philHealthSequenceNo: number; isPastCeiling: boolean; claimAmount: number; copayAmount: number }>(
      `/renal/sessions/${id}/post-dialysis`,
      dto,
    ),
  cancelSession: (id: string, dto: CancelDialysisSessionRequest) =>
    apiPost<DialysisSession>(`/renal/sessions/${id}/cancel`, dto),
  getTreatmentSheetPdfBlob: (id: string) =>
    apiGetBlob(`/renal/sessions/${id}/treatment-sheet-pdf`),

  // Shifts
  getShifts: (branchId?: string) =>
    apiGet<DialysisShift[]>(`/renal/shifts${branchId ? `?branchId=${branchId}` : ""}`),

  // Patients Lookup
  getPatients: (q?: string) =>
    apiGet<{ data?: any[]; patients?: any[] }>(`/patients${q ? `?q=${encodeURIComponent(q)}` : ""}`),

  // PhilHealth Tracking
  getPhilHealthUsage: (patientId: string, calendarYear?: number) =>
    apiGet<PhilHealthUsage>(`/renal/philhealth/usage/${patientId}${calendarYear ? `?calendarYear=${calendarYear}` : ""}`),
};
