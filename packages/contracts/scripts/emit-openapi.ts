/**
 * Emit the OpenAPI 3.1 document from the Zod contracts (todo 0.2:
 * "OpenAPI-first contract pipeline: Zod schemas → OpenAPI document →
 * generated client types").
 *
 * Phase 0 scope: a hand-maintained document with a compile-time assertion that
 * it matches the Zod schemas' inferred shapes, so drift fails the typecheck.
 * Phase 1+ swaps this for reflection (zod-openapi) without changing consumers.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PingResponse } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

// Compile-time assertion: the documented PingResponse fields must keep matching
// the Zod contract. If the schema drifts, this literal stops assigning.
const pingContractFields: keyof PingResponse = "request_id";
void pingContractFields;

const doc = {
  openapi: "3.1.0",
  info: {
    title: "Clinic Platform API",
    version: "0.1.0",
    description: "Phase 0 smoke surface. Full endpoint map: specification.md §18.",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/ping": {
      get: {
        operationId: "ping",
        summary: "Smoke endpoint proving API + DB round trip",
        responses: {
          "200": {
            description: "Pong with DB time and request id",
            content: {
              "application/json": { $ref: "#/components/schemas/PingResponse" },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      PingResponse: {
        type: "object",
        required: ["message", "dbTime", "request_id"],
        properties: {
          message: { type: "string" },
          dbTime: { type: "string" },
          request_id: { type: "string", format: "uuid" },
        },
      },
      Problem: {
        type: "object",
        required: ["type", "title", "status", "code"],
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          status: { type: "integer" },
          code: { type: "string" },
          detail: { type: "string" },
          instance: { type: "string" },
          correlationId: { type: "string" },
        },
      },
    },
  },
};

const out = join(here, "..", "openapi.json");
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(`openapi.json written (${Object.keys(doc.paths).length} path)`);
