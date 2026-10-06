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
 * This test parses both files and asserts they agree.
 */

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(here, "../../../packages/db/migrations/seeds/demo.sql");
const loginPath = resolve(here, "../src/features/auth/LoginPage.tsx");

/** Tenant slugs created by the seed. */
function seedSlugs(): string[] {
  const sql = readFileSync(seedPath, "utf8");
  const slugs = new Set<string>();
  for (const m of sql.matchAll(/'\s*([a-z0-9-]+)'\s*,\s*'ACTIVE'\s*\)/gi)) {
    slugs.add(m[1]!);
  }
  return [...slugs];
}

/** User emails inserted by the seed. */
function seedEmails(): string[] {
  const sql = readFileSync(seedPath, "utf8");
  return [...sql.matchAll(/'([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})'/gi)].map((m) => m[1]!.toLowerCase());
}

/** Default state values declared in the login page. */
function loginDefaults(): { slug: string; email: string; password: string } {
  const src = readFileSync(loginPath, "utf8");
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
    expect(existsSync(seedPath)).toBe(true);
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
  it("every fillCredentials target is a real seeded tenant + user", () => {
    const src = readFileSync(loginPath, "utf8");
    const calls = [...src.matchAll(/fillCredentials\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)];
    expect(calls.length, "fillCredentials shortcut target missing").toBeGreaterThan(0);

    const slugs = seedSlugs();
    const emails = seedEmails();

    for (const c of calls) {
      const [, slug, email] = c;
      expect(slugs, `shortcut slug "${slug}" is not seeded`).toContain(slug);
      expect(emails, `shortcut email "${email}" is not seeded`).toContain(email!.toLowerCase());
    }
  });

  it("uses the demo password documented in the seed header", () => {
    const sql = readFileSync(seedPath, "utf8");
    const m = sql.match(/demo credential "([^"]+)"/);
    expect(m?.[1], "demo.sql no longer documents its credential").toBeTruthy();

    const src = readFileSync(loginPath, "utf8");
    const calls = [...src.matchAll(/fillCredentials\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)];
    expect(calls[0]![3]).toBe(m![1]);
  });
});