import { describe, expect, it } from 'vitest';
import { of, firstValueFrom } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { TenantContextInterceptor } from '../src/auth/tenant-context.interceptor.js';
import { ReferenceController } from '../src/reference/reference.controller.js';
import type { RequestWithAuth } from '../src/auth/auth-context.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('ICD-10 Reference Controller with TenantContextInterceptor', () => {
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const interceptor = new TenantContextInterceptor(reflector);
  const ctrl = new ReferenceController();

  it('runs listIcd10 inside withTenant and satisfies TenantContextInterceptor', async () => {
    const mockReq: RequestWithAuth = {
      tenantId: TENANT_ID,
      authContext: { kind: 'user', tenantId: TENANT_ID, userId: 'user-1' },
    } as any;

    const executionContext = {
      getHandler: () => function handler() {},
      getClass: () => ReferenceController,
      switchToHttp: () => ({ getRequest: () => mockReq }),
    } as any;

    const callHandler = {
      handle: () => of(ctrl.listIcd10(undefined, '10', '0', mockReq)),
    };

    const result = await firstValueFrom(interceptor.intercept(executionContext, callHandler));
    expect(result).toBeDefined();
    expect((result as any).data).toBeInstanceOf(Array);
    expect((result as any).data.length).toBeGreaterThan(0);
  });
});
