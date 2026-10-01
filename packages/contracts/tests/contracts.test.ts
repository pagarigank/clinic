import { describe, expect, it } from "vitest";
import {
  MODULE_HARD_DEPENDENCIES,
  MODULE_KEYS,
  ERROR_CODES,
  PingResponseSchema,
  ProblemSchema,
} from "../src/index.js";

describe("module catalogue", () => {
  it("has exactly the ten PLT-T7 module keys", () => {
    expect(MODULE_KEYS).toHaveLength(10);
  });

  it("hard dependencies reference known modules", () => {
    for (const deps of Object.values(MODULE_HARD_DEPENDENCIES)) {
      for (const d of deps ?? []) {
        expect(MODULE_KEYS).toContain(d);
      }
    }
  });

  it("billing depends on clinical; clinical depends on patients", () => {
    expect(MODULE_HARD_DEPENDENCIES.billing).toContain("clinical");
    expect(MODULE_HARD_DEPENDENCIES.clinical).toContain("patients");
  });
});

describe("error catalogue (architecture §11.2)", () => {
  it("uses the documented HTTP statuses", () => {
    expect(ERROR_CODES.MODULE_NOT_ENTITLED).toBe(403);
    expect(ERROR_CODES.MODULE_READ_ONLY).toBe(403);
    expect(ERROR_CODES.STALE_ROW_VERSION).toBe(412);
    expect(ERROR_CODES.IDEMPOTENCY_CONFLICT).toBe(409);
    expect(ERROR_CODES.UPSTREAM_UNAVAILABLE).toBe(503);
    expect(ERROR_CODES.NOT_FOUND).toBe(404);
  });
});

describe("problem schema", () => {
  it("parses a minimal problem", () => {
    const p = ProblemSchema.parse({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      code: "MODULE_NOT_ENTITLED",
    });
    expect(p.code).toBe("MODULE_NOT_ENTITLED");
  });

  it("rejects a problem without a code", () => {
    expect(() =>
      ProblemSchema.parse({ type: "about:blank", title: "x", status: 400 }),
    ).toThrow();
  });
});

describe("ping contract", () => {
  it("accepts a well-formed ping response", () => {
    const r = PingResponseSchema.parse({
      message: "pong",
      dbTime: "2026-10-01 00:00:00+00",
      request_id: "1b671a64-40d5-491e-99b0-da01ff1f3341",
    });
    expect(r.message).toBe("pong");
  });

  it("rejects a non-uuid request id", () => {
    expect(() =>
      PingResponseSchema.parse({ message: "pong", dbTime: "x", request_id: "nope" }),
    ).toThrow();
  });
});
