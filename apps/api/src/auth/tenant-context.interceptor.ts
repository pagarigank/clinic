import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { lastValueFrom, Observable } from "rxjs";
import { runInTenantScope, type TenantScopeHandle } from "@clinic/db";
import { ProblemException } from "../http/problem.exception.js";
import { IS_PUBLIC_KEY, type RequestWithAuth } from "./auth-context.js";

/**
 * Tenant-transaction *verifier* (todo 1.1), registered via `APP_INTERCEPTOR`.
 *
 * architecture §11.3 places the transaction in the service layer
 * (`withTenant()`), not in the interceptor — so this deliberately does **not**
 * open one. Holding a write transaction open for the whole request would keep a
 * pooled connection checked out through response serialisation, wrap the
 * `@Public` health/metrics routes, and collide with the idempotency savepoints
 * (todo 0.3, ground rule 3).
 *
 * What it does instead: it opens a request *scope*, and after the handler
 * returns it asserts the scope actually saw a transaction. A tenant-scoped
 * route whose service forgot `withTenant()` therefore fails loudly with
 * `TENANT_CONTEXT_MISSING` instead of silently returning zero rows
 * (specification AC-2 fail-closed, made diagnosable).
 *
 * Not a security boundary — RLS is. This exists so the failure is legible.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<FastifyRequest & RequestWithAuth>();

    // Platform-scope callers carry no tenant, and public routes (login, refresh,
    // health, ping, metrics) legitimately run outside any tenant transaction.
    const tenantId = request.authContext?.tenantId;
    if (isPublic || !tenantId) return next.handle();

    return new Observable((subscriber) => {
      // Held by reference: the assertion below runs in the subscriber, outside
      // the async continuation that entered the scope, so an ambient lookup
      // there would always miss.
      let scope: TenantScopeHandle | undefined;
      let settled: Promise<unknown>;
      try {
        // Subscribing inside the scope is what makes the store visible to the
        // handler: Nest invokes the route handler on subscribe, not on handle().
        settled = runInTenantScope(tenantId, (s) => {
          scope = s;
          return lastValueFrom(next.handle());
        });
      } catch (e) {
        subscriber.error(e);
        return;
      }
      settled
        .then((value) => {
          if ((scope?.transactionsOpened ?? 0) === 0) {
            throw new ProblemException("TENANT_CONTEXT_MISSING", {
              detail:
                "no tenant transaction was opened for this request; " +
                "the handler must read and write inside withTenant()",
            });
          }
          subscriber.next(value);
        })
        .catch((e) => subscriber.error(e));
    });
  }
}
