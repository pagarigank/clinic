import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { expect } from "vitest";

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";
export const USER_A = "a3000000-0000-4000-8000-000000000001";
export const USER_B = "b3000000-0000-4000-8000-000000000001";

/**
 * Mocks the AuthGuard payload to run a request as a specific tenant user.
 * We attach this via a simple middleware or by modifying the token in tests.
 * For true E2E, you'd use a real JWT, but for API isolation tests where AuthGuard
 * is bypassed or mocked, we provide a helper.
 */
export async function assertApiTenantIsolation(options: {
  app: INestApplication;
  /** The setup operation, e.g., POST to create a resource, executed as Tenant A. Returns the resource ID. */
  createOp: () => Promise<string>;
  /** The read operation path, e.g. `/api/v1/patients/{id}`. The harness replaces `{id}`. */
  readPath: string;
  /** Optional headers to pass as Tenant A */
  headersA?: Record<string, string>;
  /** Optional headers to pass as Tenant B */
  headersB?: Record<string, string>;
}) {
  const { app, createOp, readPath, headersA = {}, headersB = {} } = options;

  // 1. Create as A
  const resourceId = await createOp();
  expect(resourceId).toBeTruthy();

  const path = readPath.replace("{id}", resourceId);

  // 2. Read as A -> should succeed
  const resA = await request(app.getHttpServer())
    .get(path)
    .set(headersA)
    .send();
  
  expect(resA.status).toBeGreaterThanOrEqual(200);
  expect(resA.status).toBeLessThan(300);

  // 3. Read as B -> should fail (404 Not Found due to RLS hiding the row)
  const resB = await request(app.getHttpServer())
    .get(path)
    .set(headersB)
    .send();
  
  expect(resB.status).toBe(404);
}
