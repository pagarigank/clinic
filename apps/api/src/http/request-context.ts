import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";

/** Correlation id middleware: honour an inbound id, else mint a uuid. */
export function attachCorrelationId(request: FastifyRequest): void {
  const inbound = request.headers["x-correlation-id"];
  request.correlationId = typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUID();
}
