import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { buildProblem, statusForCode } from "./problem.js";

interface ZodLikeIssue {
  path?: (string | number)[];
  message?: string;
}

/**
 * Duck-typed ZodError guard. We deliberately avoid `instanceof ZodError`
 * because zod is duplicated across package boundaries (v3 in some services,
 * v4 in @clinic/contracts), so an instanceof check can silently miss the
 * error and leak it as a 500.
 */
function asZodErrors(exception: unknown): { path: string; message: string }[] | undefined {
  if (typeof exception !== "object" || exception === null) return undefined;
  const candidate = exception as { name?: unknown; issues?: unknown };
  if (candidate.name !== "ZodError" || !Array.isArray(candidate.issues)) return undefined;
  return (candidate.issues as ZodLikeIssue[]).map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join(".") : "",
    message: typeof issue.message === "string" ? issue.message : "Invalid value",
  }));
}

/**
 * Global error filter → RFC 9457 application/problem+json (todo 0.3,
 * architecture §11.2). Error bodies never contain PHI beyond what the caller
 * already saw, and the stack is only included outside production.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest & { id?: string; correlationId?: string }>();

    const correlationId = request.correlationId ?? request.id ?? "";
    let body;
    const env = process.env.NODE_ENV;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse() as {
        code?: string;
        message?: string;
        detail?: string;
        errors?: { path: string; message: string }[];
      };
      const code = payload?.code ?? (status === HttpStatus.NOT_FOUND ? "NOT_FOUND" : "CONFLICT");
      body = buildProblem(code, {
        detail: payload?.detail ?? (typeof payload?.message === "string" ? payload.message : undefined),
        correlationId,
        ...(Array.isArray(payload?.errors) ? { errors: payload.errors } : {}),
      });
      body.status = status;
    } else if (asZodErrors(exception) !== undefined) {
      // Safety net: inline `Schema.parse(body)` in controllers throws a raw
      // ZodError which is not an HttpException. Surface it as 422 instead of
      // a 500, matching ZodValidationPipe.
      body = buildProblem("VALIDATION_FAILED", {
        detail: "Request payload failed validation.",
        correlationId,
        errors: asZodErrors(exception),
      });
      body.status = 422;
    } else {
      body = buildProblem("UPSTREAM_UNAVAILABLE", { correlationId });
      // Unknown/unexpected: log internally, never leak internals to the client.
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
      body.status = 500;
      body.title = "Internal Server Error";
      body.code = "INTERNAL";
      if (env !== "production" && exception instanceof Error) {
        body.detail = exception.message;
      }
    }

    void reply
      .status(body.status)
      .header("content-type", "application/problem+json; charset=utf-8")
      .header("x-correlation-id", correlationId)
      .send(body);
  }
}

export { statusForCode };
