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
    const req = {
      method: "POST",
      url: "/api/v1/patients",
      ip: "127.0.0.1",
      id: "req-123",
      headers: { "user-agent": "test-agent" },
      authContext: {
        tenantId: "t-1",
        userId: "u-1",
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
      handle: () => of({ id: "p-123", name: "Test" }),
    } as any;

    await lastValueFrom(interceptor.intercept(context, next));
    expect(queryMock).toHaveBeenCalled();
    const args = queryMock.mock.calls[0][1];
    expect(args[0]).toBe("t-1"); // tenant_id
    expect(args[1]).toBe("u-1"); // actor_id
    expect(args[4]).toBe("POST /api/v1/patients"); // action
    expect(args[5]).toBe("api"); // entity_type (from url)
    expect(args[6]).toBe("p-123"); // entity_id
  });
});
