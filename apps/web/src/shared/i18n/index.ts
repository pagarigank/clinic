import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * i18n scaffolding (frontend.md §18).
 *
 * Contract this file exists to enforce:
 *
 *   STORED FORMATS ARE ALWAYS CANONICAL. Dates are ISO 8601 strings and money
 *   is a `numeric(14,2)` from the server. `Intl` is a *renderer* only — no
 *   formatting helper in this module ever parses a "display" string, rounds a
 *   value the server already rounded, or recomputes a total. The client does
 *   not compute money (ground rule 6, frontend P-6).
 *
 * en-PH is the default locale. The tenant may override it and a user may
 * override the tenant; `setLocale` persists the user choice to localStorage.
 * This is presentation-only state, which is why it is not in the Dexie offline
 * store (ADR-10 reserves that for domain data).
 */

export const SUPPORTED_LOCALES = ["en-PH", "en-US"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en-PH";

/** G-08: the tenant timezone. Canonical storage is UTC; this is for display. */
export const DEFAULT_TIMEZONE = "Asia/Manila";

const STORAGE_KEY = "clinic.locale";

/** G-09: currency is tenant-configurable; PHP is the shipped default. */
export const DEFAULT_CURRENCY = "PHP";

function isSupported(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): SupportedLocale | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isSupported(raw) ? raw : null;
  } catch {
    return null;
  }
}

const resources = {
  "en-PH": {
    translation: {
      common: {
        appName: "Clinic Platform",
        loading: "Loading…",
        actions: {
          save: "Save",
          cancel: "Cancel",
          confirm: "Confirm",
          close: "Close",
          search: "Search",
          retry: "Retry",
          clear: "Clear",
        },
        status: {
          critical: "Critical",
          high: "High",
          normal: "Normal",
          low: "Low",
          neutral: "Neutral",
          pending: "Pending",
        },
      },
      theme: {
        appearance: "Appearance",
        light: "Light",
        dark: "Dark",
        density: "Density",
        comfortable: "Comfortable",
        compact: "Compact",
        toggleTheme: "Switch to {{mode}} mode",
      },
      auth: {
        signIn: "Sign in",
        signOut: "Sign out",
        email: "Email",
        password: "Password",
        submit: "Sign in",
        register: "Create account",
        stepUpRequired: "Confirm your passphrase to continue.",
        mfaRequired: "Enter your authentication code.",
      },
      patients: {
        title: "Patients",
        search: "Search patients",
        register: "Register patient",
        noResults: "No patients match your search.",
        banner: {
          revealAllergies: "Show allergies",
          revealDiagnoses: "Show diagnoses",
          allergies: "Allergies",
          diagnoses: "Diagnoses",
        },
      },
    },
  },
  "en-US": {
    translation: {
      common: {
        appName: "Clinic Platform",
        loading: "Loading…",
        actions: {
          save: "Save",
          cancel: "Cancel",
          confirm: "Confirm",
          close: "Close",
          search: "Search",
          retry: "Retry",
          clear: "Clear",
        },
        status: {
          critical: "Critical",
          high: "High",
          normal: "Normal",
          low: "Low",
          neutral: "Neutral",
          pending: "Pending",
        },
      },
      theme: {
        appearance: "Appearance",
        light: "Light",
        dark: "Dark",
        density: "Density",
        comfortable: "Comfortable",
        compact: "Compact",
        toggleTheme: "Switch to {{mode}} mode",
      },
      auth: {
        signIn: "Sign in",
        signOut: "Sign out",
        email: "Email",
        password: "Password",
        submit: "Sign in",
        register: "Create account",
        stepUpRequired: "Confirm your passphrase to continue.",
        mfaRequired: "Enter your authentication code.",
      },
      patients: {
        title: "Patients",
        search: "Search patients",
        register: "Register patient",
        noResults: "No patients match your search.",
        banner: {
          revealAllergies: "Show allergies",
          revealDiagnoses: "Show diagnoses",
          allergies: "Allergies",
          diagnoses: "Diagnoses",
        },
      },
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: readStoredLocale() ?? DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  // Missing keys render the key, which surfaces gaps in tests rather than
  // silently showing an empty string in the UI.
  parseMissingKeyHandler: (key) => `⟨${key}⟩`,
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** User-level locale override; the tenant default is applied by the caller. */
export async function setLocale(locale: SupportedLocale): Promise<void> {
  if (!isSupported(locale)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage denial is not fatal for a presentation preference.
  }
  await i18n.changeLanguage(locale);
}

export function currentLocale(): SupportedLocale {
  return isSupported(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

export default i18n;