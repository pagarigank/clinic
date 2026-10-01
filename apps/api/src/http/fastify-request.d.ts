// Augment Fastify's request type with the correlation id attached by
// attachCorrelationId (apps/api/src/http/request-context.ts).
import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    correlationId?: string;
  }
}

export {};
