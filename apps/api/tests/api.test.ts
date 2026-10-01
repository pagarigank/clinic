import { describe, expect, it } from "vitest";
import { buildProblem, statusForCode } from "../src/http/problem.js";

describe("problem builder (architecture §11.2)", () => {
  it("maps module/entitlement codes to their documented statuses", () => {
    expect(statusForCode("MODULE_NOT_ENTITLED")).toBe(403);
    expect(statusForCode("MODULE_READ_ONLY")).toBe(403);
    expect(statusForCode("STALE_ROW_VERSION")).toBe(412);
    expect(statusForCode("PERIOD_LOCKED")).toBe(409);
    expect(statusForCode("UPSTREAM_UNAVAILABLE")).toBe(503);
    expect(statusForCode("SOMETHING_UNKNOWN")).toBe(500);
  });

  it("builds a problem+json body with code, title, correlation id", () => {
    const p = buildProblem("MODULE_NOT_ENTITLED", {
      detail: "laboratory is not enabled for this clinic",
      correlationId: "req-1",
    });
    expect(p.status).toBe(403);
    expect(p.code).toBe("MODULE_NOT_ENTITLED");
    expect(p.correlationId).toBe("req-1");
    expect(p.type).toContain("MODULE_NOT_ENTITLED");
  });

  it("unknown codes fall back to a 500 internal problem", () => {
    const p = buildProblem("MYSTERY");
    expect(p.status).toBe(500);
    expect(p.title).toBe("Internal Server Error");
  });
});
