import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Seed/login credential contract.
 *
 * WHY THIS TEST EXISTS
 * The login screen shipped with pre-filled defaults (`demo` /
 * `admin@example.com`) that no seeded tenant or user actually has. The
 * one-click demo buttons on the same screen used the correct values, so the bug
 * only appeared when someone pressed Submit with the pre-filled form — and it
 * presented as "login is broken" rather than "the defaults are wrong".
 *
 * Nothing else in the stack catches this: the API correctly returns
 * 401 INVALID_CREDENTIALS for unknown users (that is required behaviour —
 * specification G-14/generic responses), so a UI/seed mismatch fails silently
 * at runtime and nowhere in CI.
 *
 * The demo tenant + admin/doctor users come from `demo.sql`; the remaining
 * staff accounts (nurse, dispenser, receptionist, verifier, lab technologist,
 * lab verifier, supply storekeeper) come from `demo_clean.sql`. Both files must
 * stay consistent with the DEV keyboard-shortcut targets in the login page.
 */

const here = dirname(fileURLToPath(import.meta.url));
const demoSqlPath = resolve(here, "../../../packages/db/migrations/seeds/demo.sql");
const demoCleanPath = resolve(here, "../../../packages/db/migrations/seeds/demo_clean.sql");
const loginPath = resolve(here, "../src/features/auth/LoginPage.tsx");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Tenant slugs created by the demo seed. */
function seedSlugs(): string[] {
  const sql = read(demoSqlPath);
  const slugs = new Set<string>();
  for (const m of sql.matchAll(/'\s*([a-z0-9-]+)'\s*,\s*'ACTIVE'\s*\)/gi)) {
    slugs.add(m[1]!);
  }
  return [...slugs];
}

/** User emails inserted by either seed file. */
function seedEmails(): string[] {
  const sql = read(demoSqlPath) + "\n" + read(demoCleanPath);
  return [...sql.matchAll(/'([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})'/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
}

/** Emails wired to the DEV keyboard shortcuts in the login page. */
function shortcutEmails(src: string): string[] {
  return [...src.matchAll(/case\s+"[a-z]":\s*email\s*=\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/** Default state values declared in the login page. */
function loginDefaults(): { slug: string; email: string; password: string } {
  const src = read(loginPath);
  const slugM = src.match(/const \[slug, setSlug\] = useState\("([^"]*)"\)/);
  const emailM = src.match(/const \[email, setEmail\] = useState\("([^"]*)"\)/);
  const passM = src.match(/const \[password, setPassword\] = useState\("([^"]*)"\)/);
  if (!slugM || !emailM || !passM) {
    throw new Error("LoginPage.tsx defaults could not be parsed");
  }
  return { slug: slugM[1]!, email: emailM[1]!, password: passM[1]! };
}

describe("login defaults for deployment", () => {
  it("has a readable seed and login page", () => {
    expect(existsSync(demoSqlPath)).toBe(true);
    expect(existsSync(demoCleanPath)).toBe(true);
    expect(existsSync(loginPath)).toBe(true);
  });

  it("defaults to empty textboxes on initial load for deployment", () => {
    const { slug, email, password } = loginDefaults();
    expect(slug).toBe("");
    expect(email).toBe("");
    expect(password).toBe("");
  });
});

describe("shortcut credentials match demo seed", () => {
  it("every keyboard shortcut targets a real seeded tenant + user", () => {
    const src = read(loginPath);
    const emails = shortcutEmails(src);
    expect(emails.length, "no shortcut email targets found in LoginPage.tsx").toBeGreaterThan(0);

    const slugs = seedSlugs();
    const seeded = seedEmails();

    const slugM = src.match(/fillCredentials\("([^"]+)",\s*email,/);
    expect(slugM, "shortcut fillCredentials does not fill a tenant slug").toBeTruthy();
    expect(slugs, `shortcut slug "${slugM![1]}" is not seeded`).toContain(slugM![1]);

    for (const email of emails) {
      expect(seeded, `shortcut email "${email}" is not seeded`).toContain(email.toLowerCase());
    }
  });

  it("uses the demo password documented in the seed header", () => {
    const sql = read(demoSqlPath);
    const m = sql.match(/demo credential "([^"]+)"/);
    expect(m?.[1], "demo.sql no longer documents its credential").toBeTruthy();

    const src = read(loginPath);
    const passM = src.match(/fillCredentials\("[^"]+",\s*email,\s*"([^"]+)"\)/);
    expect(passM, "shortcut password literal missing").toBeTruthy();
    expect(passM![1]).toBe(m![1]);
  });
});
