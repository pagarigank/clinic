import { describe, expect, it } from "vitest";
import { redact } from "../src/observability/logger.js";

describe("PHI redaction (ground rule 5)", () => {
  it("redacts known PHI keys at the top level", () => {
    // `note` is itself deny-listed (clinical notes are PHI); use a benign key
    // to prove non-PHI fields pass through untouched.
    const out = redact({ first_name: "Juan", status: "ok" }) as Record<string, string>;
    expect(out.first_name).toBe("[redacted]");
    expect(out.status).toBe("ok");
  });

  it("redacts at nested depth", () => {
    const out = redact({ visit: { patient: { last_name: "Dela Cruz", age: 41 } } }) as {
      visit: { patient: { last_name: string; age: number } };
    };
    expect(out.visit.patient.last_name).toBe("[redacted]");
    expect(out.visit.patient.age).toBe(41);
  });

  it("never leaks authorization headers or cookies", () => {
    const out = redact({ authorization: "Bearer abc", cookie: "sid=1" }) as Record<string, string>;
    expect(out.authorization).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
  });
});
