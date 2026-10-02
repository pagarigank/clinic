/**
 * The ten module keys — mirrored from `apps/api/src/rbac/module.guard.ts`
 * (architecture §5.3) and `MODULE_DEPENDENCIES` in the tenant-modules service.
 *
 * The server is the authority (a wrong client set still gets
 * `MODULE_DEPENDENCY_MISSING` / `PLAN_MODULE_NOT_ALLOWED`); this mirror exists
 * so the console can render descriptions, dependency hints, and auto-tick
 * behaviour before anything is posted, per frontend §14.1's wizard spec.
 */

export const MODULE_KEYS = [
  "admin",
  "patients",
  "clinical",
  "supply",
  "laboratory",
  "pharmacy",
  "billing",
  "compliance",
  "notifications",
  "reports",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Hard dependencies — mirrors MODULE_DEPENDENCIES in tenant-modules.service.ts. */
export const MODULE_DEPENDENCIES: Record<ModuleKey, ModuleKey[]> = {
  admin: [],
  patients: ["admin"],
  clinical: ["patients"],
  supply: ["admin"],
  laboratory: ["patients"],
  pharmacy: ["patients", "supply"],
  billing: ["patients", "clinical"],
  compliance: ["admin"],
  notifications: ["admin"],
  reports: ["admin"],
};

export interface ModuleDescriptor {
  key: ModuleKey;
  label: string;
  description: string;
}

export const MODULE_CATALOGUE: ModuleDescriptor[] = [
  { key: "admin", label: "Administration", description: "Users, roles, branches, settings, and audit oversight for the clinic." },
  { key: "patients", label: "Patients", description: "Registration, master patient index, consents, and documents." },
  { key: "clinical", label: "Clinical", description: "Scheduling, visits, charting, orders, and prescriptions." },
  { key: "supply", label: "Central Supply", description: "Item master, ledger, purchasing, counts, and FEFO stock control." },
  { key: "laboratory", label: "Laboratory", description: "Orders, specimens, results, QC, and released reports." },
  { key: "pharmacy", label: "Pharmacy", description: "Verification, dispensing, controlled register, and OTC sales." },
  { key: "billing", label: "Billing & Cashiering", description: "Invoices, payments, shifts, and period locks." },
  { key: "compliance", label: "Compliance", description: "Audit explorer, consent, DSR, retention, and breach workflows." },
  { key: "notifications", label: "Notifications", description: "In-app centre plus email/SMS/push channels with delivery log." },
  { key: "reports", label: "Reports", description: "Catalog, async exports, and scheduled delivery across modules." },
];

export type ModuleStatus = "TRIAL" | "ENABLED" | "DRAINING" | "DISABLED";

export interface TenantModuleRow {
  module: ModuleKey;
  status: ModuleStatus;
  seedStatus?: string | null;
  limits?: number | null;
  expiresAt?: string | null;
  disabledReason?: string | null;
  disabledBy?: string | null;
  disabledAt?: string | null;
}

/**
 * "Check what would be blocked" — the open-work inventory the disable flow
 * must present (frontend §14.1). There is no dedicated preflight endpoint yet
 * (the state machine computes this server-side), so the console renders the
 * shapes and the API failure path keeps the flow usable in demo data.
 */
export const OPEN_WORK_BY_MODULE: Partial<Record<ModuleKey, string[]>> = {
  clinical: ["3 open visits", "1 unsigned certificate"],
  laboratory: ["2 unverified results", "1 released report pending render"],
  pharmacy: ["1 prescription awaiting verification", "1 draft dispensation"],
  supply: ["1 unposted GRN", "1 open purchase request"],
  billing: ["1 open cashier shift", "2 draft invoices"],
  patients: ["0 open items"],
  admin: ["0 open items"],
  compliance: ["0 open items"],
  notifications: ["0 pending sends"],
  reports: ["1 scheduled export"],
};
