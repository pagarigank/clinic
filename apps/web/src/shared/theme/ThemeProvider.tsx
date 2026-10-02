import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Theme + density preferences (frontend.md §5.1).
 *
 * Bootstrap 5.3 drives colour modes natively through `data-bs-theme` on the
 * document root (architecture ADR-8), so the theme is a single attribute
 * write rather than a class toggle. Density is our own `data-density`
 * attribute, consumed by the `[data-density]` blocks in tokens.css.
 *
 * Preferences persist to localStorage under one key and are read during the
 * initial render to avoid a light-mode flash on a dark-mode load — this is a
 * presentation preference only, never data, which is why localStorage is
 * acceptable here (ADR-10 reserves IndexedDB for domain data).
 */

export type ThemeMode = "light" | "dark";
export type Density = "comfortable" | "compact";

const STORAGE_KEY = "clinic.preferences";

interface Preferences {
  theme: ThemeMode;
  density: Density;
}

export interface ThemeContextValue extends Preferences {
  /** True when the OS/browser reports a dark preference. */
  prefersDark: boolean;
  setTheme: (mode: ThemeMode) => void;
  setDensity: (density: Density) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Attributes are written on <html> so tokens.css and Bootstrap both see them. */
function applyToDocument({ theme, density }: Preferences): void {
  const root = document.documentElement;
  root.setAttribute("data-bs-theme", theme);
  root.setAttribute("data-density", density);
}

function readStored(): Partial<Preferences> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      ...(parsed.theme === "dark" || parsed.theme === "light" ? { theme: parsed.theme } : {}),
      ...(parsed.density === "compact" || parsed.density === "comfortable"
        ? { density: parsed.density }
        : {}),
    };
  } catch {
    // A corrupt value must not break boot — fall back to defaults.
    return {};
  }
}

function systemTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const stored = readStored();
  const [prefersDark, setPrefersDark] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [theme, setThemeState] = useState<ThemeMode>(() => stored.theme ?? systemTheme());
  const [density, setDensityState] = useState<Density>(() => stored.density ?? "comfortable");

  // Apply before paint on mount; React effects run after the first paint,
  // which is why the attribute is also written inline by the entry script.
  useEffect(() => {
    applyToDocument({ theme, density });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, density }));
    } catch {
      // Private-mode storage denial is not fatal; the preference is cosmetic.
    }
  }, [theme, density]);

  // Track the OS preference so a tenant that never chose explicitly still
  // follows their system. An explicit choice wins because `stored.theme` is
  // already set and this only updates `prefersDark`.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);
  const setDensity = useCallback((value: Density) => setDensityState(value), []);
  const toggleTheme = useCallback(
    () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, density, prefersDark, setTheme, setDensity, toggleTheme }),
    [theme, density, prefersDark, setTheme, setDensity, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

export { ThemeContext };