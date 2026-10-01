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
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    const patientId = "33333333-3333-4333-8333-333333333333";

    const context = {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          ip: "127.0.0.1",
          id: "req-123",
          headers: { "user-agent": "test-agent" },
          params: { patientId },
          authContext: {
            tenantId,
            userId,
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
    expect(args[0]).toBe(tenantId); // tenant_id
    expect(args[1]).toBe(userId); // actor_id
    expect(args[2]).toBe(patientId); // patient_id
    expect(args[3]).toBe("patient_record"); // resource
  });
});
