import { describe, expect, it, vi, beforeEach } from "vitest";
import { PhiAccessInterceptor } from "../src/audit/phi-access.interceptor.js";
import { of, lastValueFrom } from "rxjs";
import * as poolModule from "@clinic/db/src/pool.js";
import { Reflector } from "@nestjs/core";

describe("PhiAccessInterceptor", () => {
  let interceptor: PhiAccessInterceptor;
  let mockPool: any;
  let queryMock: any;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new PhiAccessInterceptor(reflector);
    queryMock = vi.fn().mockResolvedValue({});
    mockPool = { query: queryMock };
    vi.spyOn(poolModule, "getAppPool").mockReturnValue(mockPool);
  });

  it("ignores requests without @PhiAccess", async () => {
    const context = {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ method: "GET" }),
      }),
    } as any;
    const next = { handle: () => of({}) } as any;
    vi.spyOn(reflector, "get").mockReturnValue(undefined);

    await lastValueFrom(interceptor.intercept(context, next));
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("intercepts @PhiAccess requests and inserts phi_access_log", async () => {
    const context = {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          ip: "127.0.0.1",
          id: "req-123",
          headers: { "user-agent": "test-agent" },
          params: { patientId: "pat-123" },
          authContext: {
            tenantId: "t-1",
            userId: "u-1",
            kind: "user",
          },
        }),
      }),
    } as any;
    const next = { handle: () => of({}) } as any;
    
    vi.spyOn(reflector, "get").mockReturnValue({ resource: "patient_record" });

    await lastValueFrom(interceptor.intercept(context, next));
    expect(queryMock).toHaveBeenCalled();
    const args = queryMock.mock.calls[0][1];
    expect(args[0]).toBe("t-1"); // tenant_id
    expect(args[1]).toBe("u-1"); // actor_id
    expect(args[2]).toBe("pat-123"); // patient_id
    expect(args[3]).toBe("patient_record"); // resource
  });
});
