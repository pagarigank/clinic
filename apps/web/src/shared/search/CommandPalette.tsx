import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { apiGet } from "../api/client.js";

/**
 * Global search / command palette — todo.md §2.3 and frontend.md §9
 * (`SearchContext`, Ctrl/⌘+K).
 *
 * Searches patients the caller may see plus the navigation destinations the
 * shell offers. Results respect permissions because the API filters them and
 * the nav list is built from the session's entitled modules (frontend §7.2).
 *
 * PHI hygiene (frontend §9): recent patients live in MEMORY only — never in
 * localStorage, sessionStorage, or the URL. A deep link carries the patient id
 * (`/patients?focus=<id>`), never a name (§20 "the URL carries ids and
 * filters").
 */

export interface PatientRef {
  id: string;
  name: string;
  patientNo: string;
}

interface SearchContextValue {
  recentPatients: PatientRef[];
  rememberPatient: (patient: PatientRef) => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [recentPatients, setRecentPatients] = useState<PatientRef[]>([]);

  const rememberPatient = useCallback((patient: PatientRef) => {
    setRecentPatients((prev) => [patient, ...prev.filter((p) => p.id !== patient.id)].slice(0, 5));
  }, []);

  const value = useMemo<SearchContextValue>(() => ({ recentPatients, rememberPatient }), [recentPatients, rememberPatient]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchContext(): SearchContextValue {
  // A safe no-op fallback keeps patient screens renderable outside the shell
  // (component tests, future embedded surfaces). Recents are presentation-only
  // state, so an absent provider degrades to "nothing remembered" — it never
  // affects clinical data or permissions.
  return (
    useContext(SearchContext) ?? {
      recentPatients: [],
      rememberPatient: () => {},
    }
  );
}

interface NavDestination {
  label: string;
  path: string;
  keywords: string;
}

const DESTINATIONS: NavDestination[] = [
  { label: "Dashboard", path: "/dashboard", keywords: "home landing overview" },
  { label: "Patient Registry", path: "/patients", keywords: "patients mpi register search" },
  { label: "Duplicate Candidates (JOB-22)", path: "/patients/duplicates", keywords: "duplicates merge review job-22" },
  { label: "Appointments", path: "/clinical/appointments", keywords: "scheduling calendar booking walk-in" },
  { label: "Queue Board", path: "/clinical/queue", keywords: "queue tickets now serving" },
  { label: "Consultations & Chart", path: "/clinical/visits", keywords: "visits encounters chart soap" },
  { label: "Staff & Users", path: "/admin/users", keywords: "users staff directory" },
  { label: "Roles & Permissions", path: "/admin/roles", keywords: "roles rbac permissions sod" },
  { label: "Branches & Units", path: "/admin/branches", keywords: "branches service units" },
  { label: "Services & Prices", path: "/admin/service-catalog", keywords: "catalog prices discounts payments" },
  { label: "Settings", path: "/admin/settings", keywords: "settings modules entitlements policy" },
  { label: "System Health", path: "/ping", keywords: "health ping metrics" },
  { label: "Platform Console", path: "/platform/tenants", keywords: "platform tenants console superadmin" },
];

interface PaletteResult {
  key: string;
  label: string;
  detail?: string;
  run: () => void;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { recentPatients, rememberPatient } = useSearchContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [patientHits, setPatientHits] = useState<PatientRef[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Ctrl/⌘+K opens, Esc cancels without acting (frontend §17).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input on open and restore focus on close.
  useEffect(() => {
    if (open) {
      setQuery("");
      setPatientHits([]);
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Debounced patient search; the API enforces permission filtering, and a
  // failure simply leaves the navigation results usable.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setPatientHits([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiGet<{ data?: PatientRef[]; patients?: PatientRef[] }>(
          `/patients?search=${encodeURIComponent(q)}`,
        );
        const list = res?.data ?? res?.patients;
        if (Array.isArray(list)) {
          setPatientHits(
            list.slice(0, 6).map((p) => ({
              id: p.id,
              name: p.name ?? `${p.patientNo}`,
              patientNo: p.patientNo ?? "",
            })),
          );
        }
      } catch {
        setPatientHits([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const openPatient = useCallback(
    (p: PatientRef) => {
      rememberPatient(p);
      setOpen(false);
      navigate(`/patients?focus=${encodeURIComponent(p.id)}`);
    },
    [navigate, rememberPatient],
  );

  const results = useMemo<PaletteResult[]>(() => {
    const q = query.trim().toLowerCase();
    const nav = DESTINATIONS.filter(
      (d) => !q || d.label.toLowerCase().includes(q) || d.keywords.includes(q),
    ).map<PaletteResult>((d) => ({
      key: `nav-${d.path}`,
      label: d.label,
      detail: "Go to",
      run: () => {
        setOpen(false);
        navigate(d.path);
      },
    }));
    const patients = patientHits.map<PaletteResult>((p) => ({
      key: `patient-${p.id}`,
      label: p.name,
      detail: p.patientNo,
      run: () => openPatient(p),
    }));
    // Recents surface before typing (frontend §9), never ahead of a live match.
    const recents =
      q.length === 0
        ? recentPatients
            .filter((r) => !patients.some((p) => p.key === `patient-${r.id}`))
            .map<PaletteResult>((p) => ({
              key: `recent-${p.id}`,
              label: p.name,
              detail: `Recent · ${p.patientNo}`,
              run: () => openPatient(p),
            }))
        : [];
    return [...patients, ...recents, ...nav].slice(0, 12);
  }, [query, patientHits, recentPatients, navigate, openPatient]);

  useEffect(() => setActive(0), [results.length, query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[active]?.run();
    }
  };

  return (
    <div
      className="modal show d-block"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 560 }} ref={dialogRef}>
        <div className="modal-content">
          <div className="modal-body p-2">
            <input
              ref={inputRef}
              type="text"
              className="form-control form-control-lg"
              placeholder="Search patients, pages… (↑ ↓ to move, Enter to open)"
              aria-label="Search patients and pages"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="command-palette-list"
              aria-activedescendant={results[active] ? `cp-opt-${active}` : undefined}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <ul id="command-palette-list" role="listbox" className="list-group list-group-flush mt-2">
              {results.map((r, i) => (
                <li
                  key={r.key}
                  id={`cp-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`list-group-item list-group-item-action ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    r.run();
                  }}
                >
                  <div className="d-flex justify-content-between align-items-center">
                    <span>{r.label}</span>
                    {r.detail ? <span className="small text-muted">{r.detail}</span> : null}
                  </div>
                </li>
              ))}
              {results.length === 0 ? (
                <li className="list-group-item text-center text-muted py-4" role="status">
                  Nothing matches — check the spelling or try a patient number.
                </li>
              ) : null}
            </ul>
          </div>
          <div className="modal-footer py-1 small text-muted justify-content-between">
            <span>Esc to close</span>
            <span>
              <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
