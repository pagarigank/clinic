import { describe, expect, it } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import { ProblemExceptionFilter } from "../src/http/problem.filter.js";

interface CapturedBody {
  code?: string;
  detail?: string;
  errors?: { path: string; message: string }[];
}

function makeHost() {
  const captured: { status?: number; body?: CapturedBody } = {};
  const reply = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    header() {
      return this;
    },
    send(body: unknown) {
      captured.body = body as CapturedBody;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ correlationId: "test-cid" }),
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe("ProblemExceptionFilter", () => {
  it("maps a raw ZodError (not an HttpException) to 422 VALIDATION_FAILED", () => {
    const { host, captured } = makeHost();
    const zodError = {
      name: "ZodError",
      issues: [
        { path: ["amount"], message: "Expected number, received string" },
        { path: ["invoiceId"], message: "Required" },
      ],
    };

    new ProblemExceptionFilter().catch(zodError, host);

    expect(captured.status).toBe(422);
    expect(captured.body?.code).toBe("VALIDATION_FAILED");
    expect(captured.body?.errors?.map((e) => e.path).sort()).toEqual([
      "amount",
      "invoiceId",
    ]);
  });

  it("maps an unknown error to a 500 INTERNAL with no leaked detail in production", () => {
    const { host, captured } = makeHost();
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      new ProblemExceptionFilter().catch(new Error("boom secret"), host);
    } finally {
      process.env.NODE_ENV = previous;
    }

    expect(captured.status).toBe(500);
    expect(captured.body?.code).toBe("INTERNAL");
    expect(captured.body?.detail).toBeUndefined();
  });
});
