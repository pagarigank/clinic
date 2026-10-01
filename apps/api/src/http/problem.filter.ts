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
