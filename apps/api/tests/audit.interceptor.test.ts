import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuditInterceptor } from "../src/audit/audit.interceptor.js";
import { of, lastValueFrom } from "rxjs";
import * as poolModule from "@clinic/db/src/pool.js";

describe("AuditInterceptor", () => {
  let interceptor: AuditInterceptor;
  let mockPool: any;
  let queryMock: any;

  beforeEach(() => {
    interceptor = new AuditInterceptor();
    queryMock = vi.fn().mockResolvedValue({});
    mockPool = { query: queryMock };
    vi.spyOn(poolModule, "getAppPool").mockReturnValue(mockPool);
  });

  it("ignores GET requests", async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
        }),
      }),
    } as any;
    const next = {
      handle: () => of({ success: true }),
    } as any;

    await lastValueFrom(interceptor.intercept(context, next));
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("intercepts POST and inserts audit_log", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ row_hash: "hash-001" }] }); // for prevHash SELECT
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // for INSERT

    const tenantId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    const entityId = "33333333-3333-4333-8333-333333333333";

    const req = {
      method: "POST",
      url: "/api/v1/patients",
      ip: "127.0.0.1",
      id: "req-123",
      headers: { "user-agent": "test-agent" },
      authContext: {
        tenantId,
        userId,
        kind: "user",
      },
      body: { name: "Test" },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as any;
    const next = {
      handle: () => of({ id: entityId, name: "Test" }),
    } as any;

    await lastValueFrom(interceptor.intercept(context, next));
    expect(queryMock).toHaveBeenCalledTimes(2);

    // Call 1: fetch previous hash
    expect(queryMock.mock.calls[0][1]).toEqual([tenantId]);

    // Call 2: insert with hash chaining and after_state
    const insertArgs = queryMock.mock.calls[1][1];
    expect(insertArgs[0]).toBe(tenantId);
    expect(insertArgs[2]).toBe(userId);
    expect(insertArgs[5]).toBe("POST /api/v1/patients");
    expect(insertArgs[6]).toBe("api");
    expect(insertArgs[7]).toBe(entityId);
    expect(insertArgs[12]).toBe("hash-001"); // prev_hash
    expect(typeof insertArgs[13]).toBe("string"); // row_hash
  });
});
