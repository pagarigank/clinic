export interface RegistrationRequest {
  id: string;
  referenceNo: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
  phone: string;
  role: string;
  licenseNo?: string;
  branch: string;
  notes?: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

const STORAGE_KEY = "clinic_registration_requests";

const INITIAL_REQUESTS: RegistrationRequest[] = [
  {
    id: "reg-1",
    referenceNo: "REG-2026-0041",
    firstName: "Maria Clara",
    lastName: "Santos",
    email: "dr.santos@metrocare.ph",
    phone: "09171234567",
    role: "DOCTOR",
    licenseNo: "PRC-0098412",
    branch: "Metro General Hospital - Main",
    notes: "Internal Medicine Specialist applying for outpatient clinic privileges.",
    status: "PENDING_APPROVAL",
    submittedAt: "2026-10-01 09:30 AM",
  },
  {
    id: "reg-2",
    referenceNo: "REG-2026-0042",
    firstName: "Juan",
    lastName: "Dela Cruz",
    email: "juan.delacruz@metrocare.ph",
    phone: "09187654321",
    role: "ENCODER",
    branch: "Metro General Hospital - Main",
    notes: "Front desk admitting and registration staff.",
    status: "PENDING_APPROVAL",
    submittedAt: "2026-10-01 11:15 AM",
  },
  {
    id: "reg-3",
    referenceNo: "REG-2026-0039",
    firstName: "Carmela",
    lastName: "Reyes",
    email: "carmela.reyes@metrocare.ph",
    phone: "09191122334",
    role: "NURSE",
    licenseNo: "PRC-0076219",
    branch: "North Care Ambulatory Center",
    notes: "Triage and immunization nurse staff.",
    status: "APPROVED",
    submittedAt: "2026-09-30 02:40 PM",
    reviewedAt: "2026-09-30 04:00 PM",
    reviewedBy: "Tenant Administrator",
  },
];

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.getItem === "function") {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

let memoryRequests: RegistrationRequest[] = [...INITIAL_REQUESTS];

export function getRegistrationRequests(): RegistrationRequest[] {
  try {
    const storage = getSafeStorage();
    if (!storage) {
      return memoryRequests;
    }
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      storage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_REQUESTS));
      return INITIAL_REQUESTS;
    }
    return JSON.parse(raw);
  } catch {
    return memoryRequests;
  }
}

export function submitRegistration(dto: Omit<RegistrationRequest, "id" | "referenceNo" | "status" | "submittedAt">): RegistrationRequest {
  const current = getRegistrationRequests();
  const serial = current.length + 42;
  const newReq: RegistrationRequest = {
    ...dto,
    id: `reg-${Date.now()}`,
    referenceNo: `REG-2026-${String(serial).padStart(4, "0")}`,
    status: "PENDING_APPROVAL",
    submittedAt: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
  };
  const updated = [newReq, ...current];
  memoryRequests = updated;
  try {
    getSafeStorage()?.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return newReq;
}

export function updateRegistrationStatus(id: string, status: "APPROVED" | "REJECTED", reviewer: string = "Tenant Administrator"): boolean {
  const current = getRegistrationRequests();
  const idx = current.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  current[idx] = {
    ...current[idx]!,
    status,
    reviewedAt: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    reviewedBy: reviewer,
  };
  memoryRequests = current;
  try {
    getSafeStorage()?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  return true;
}
