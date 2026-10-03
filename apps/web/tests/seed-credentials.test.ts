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
  const slugM = src.match(/const \[slug, setSlug\] = useState\("([^"]+)"\)/);
  const emailM = src.match(/const \[email, setEmail\] = useState\("([^"]+)"\)/);
  const passM = src.match(/const \[password, setPassword\] = useState\("([^"]+)"\)/);
  if (!slugM?.[1] || !emailM?.[1] || !passM?.[1]) {
    throw new Error("LoginPage.tsx defaults could not be parsed");
  }
  return { slug: slugM[1], email: emailM[1], password: passM[1] };
}

describe("login defaults match the demo seed", () => {
  it("has a readable seed and login page", () => {
    expect(existsSync(seedPath)).toBe(true);
    expect(existsSync(loginPath)).toBe(true);
  });

  it("uses a tenant slug that the seed actually creates", () => {
    const slugs = seedSlugs();
    expect(slugs.length, "no tenant slugs parsed from demo.sql — the regex is stale").toBeGreaterThan(0);
    const { slug } = loginDefaults();
    expect(
      slugs,
      `LoginPage defaults to slug "${slug}", which demo.sql does not create (found: ${slugs.join(", ")})`,
    ).toContain(slug);
  });

  it("uses an email that the seed actually creates", () => {
    const emails = seedEmails();
    expect(emails.length, "no emails parsed from demo.sql — the regex is stale").toBeGreaterThan(0);
    const { email } = loginDefaults();
    expect(
      emails,
      `LoginPage defaults to "${email}", which demo.sql does not create`,
    ).toContain(email.toLowerCase());
  });

  it("uses the demo password documented in the seed header", () => {
    const sql = readFileSync(seedPath, "utf8");
    const m = sql.match(/demo credential "([^"]+)"/);
    expect(m?.[1], "demo.sql no longer documents its credential").toBeTruthy();
    expect(loginDefaults().password).toBe(m![1]);
  });
});

describe("demo buttons and form defaults agree", () => {
  it("every fillCredentials target is a real seeded tenant + user", () => {
    const src = readFileSync(loginPath, "utf8");
    const calls = [...src.matchAll(/fillCredentials\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)];
    expect(calls.length, "no demo buttons found — the markup changed?").toBeGreaterThan(0);

    const slugs = seedSlugs();
    const emails = seedEmails();

    for (const c of calls) {
      const [, slug, email] = c;
      expect(slugs, `demo button slug "${slug}" is not seeded`).toContain(slug);
      expect(emails, `demo button email "${email}" is not seeded`).toContain(email!.toLowerCase());
    }
  });

  it("a demo button can reproduce the default form state", () => {
    // Otherwise the pre-filled form and the advertised "one-click" path
    // disagree, which is precisely the confusion this suite was written for.
    const src = readFileSync(loginPath, "utf8");
    const calls = [...src.matchAll(/fillCredentials\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)];
    const defaults = loginDefaults();
    const matches = calls.some(
      (c) => c[1] === defaults.slug && c[2] === defaults.email && c[3] === defaults.password,
    );
    expect(
      matches,
      `defaults (${defaults.slug}/${defaults.email}) match no demo button; available: ${calls
        .map((c) => `${c[1]}/${c[2]}`)
        .join(", ")}`,
    ).toBe(true);
  });
});