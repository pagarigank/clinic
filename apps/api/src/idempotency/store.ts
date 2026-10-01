import { createHash } from "node:crypto";

export interface StoredResponse {
  status: number;
  body: unknown;
}

interface Entry extends StoredResponse {
  requestHash: string;
  state: "in-flight" | "completed";
}

/** HTTP status for a key reused with a different body (architecture §11.2). */
export const IDEMPOTENCY_CONFLICT_STATUS = 409;

/** Header name every 🔒 endpoint requires (specification §18 conventions). */
export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * Phase 0 in-memory idempotency store implementing the contract every 🔒
 * endpoint will rely on (todo 0.3; ground rule 3; specification §18):
 *  - required `Idempotency-Key` on state-changing endpoints
 *  - same key + different body → 409 IDEMPOTENCY_CONFLICT
 *  - same key + same body after completion → replay the stored response
 * Phase 1 moves persistence into a `(tenant_id, idempotency_key)` table; this
 * class stays the seam (unit-tested here, swapped per environment later).
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  private static hash(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
  }

  /** Look up a completed response for replay; flags a conflict otherwise. */
  check(key: string, payload: unknown): { replay?: StoredResponse; conflict?: boolean } {
    const entry = this.entries.get(key);
    if (!entry) return {};
    if (entry.requestHash !== IdempotencyStore.hash(payload)) return { conflict: true };
    if (entry.state === "completed") {
      return { replay: { status: entry.status, body: entry.body } };
    }
    return { conflict: true }; // concurrent in-flight duplicate
  }

  /** Mark a key as in-flight before executing the handler. */
  reserve(key: string, payload: unknown): void {
    this.entries.set(key, {
      requestHash: IdempotencyStore.hash(payload),
      state: "in-flight",
      status: 0,
      body: null,
    });
  }

  /** Complete a key with the response to replay on retries. */
  complete(key: string, response: StoredResponse): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.state = "completed";
      entry.status = response.status;
      entry.body = response.body;
    }
  }

  /** Release a reservation after a handler failure so a retry may proceed. */
  fail(key: string): void {
    this.entries.delete(key);
  }
}

export const idempotencyStore = new IdempotencyStore();
