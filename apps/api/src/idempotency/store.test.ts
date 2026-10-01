import { describe, expect, it } from "vitest";
import { IdempotencyStore } from "./store.js";

describe("IdempotencyStore", () => {
  it("replays the stored response for the same key + body", () => {
    const store = new IdempotencyStore();
    store.reserve("k1", { a: 1 });
    store.complete("k1", { status: 201, body: { id: "x" } });

    const { replay, conflict } = store.check("k1", { a: 1 });
    expect(conflict).toBeUndefined();
    expect(replay?.status).toBe(201);
    expect(replay?.body).toEqual({ id: "x" });
  });

  it("flags a conflict when the same key is reused with a different body", () => {
    const store = new IdempotencyStore();
    store.reserve("k2", { a: 1 });
    store.complete("k2", { status: 201, body: { id: "x" } });

    const { conflict, replay } = store.check("k2", { a: 2 });
    expect(conflict).toBe(true);
    expect(replay).toBeUndefined();
  });

  it("treats a concurrent in-flight duplicate as a conflict", () => {
    const store = new IdempotencyStore();
    store.reserve("k3", { a: 1 });
    const { conflict, replay } = store.check("k3", { a: 1 });
    expect(conflict).toBe(true);
    expect(replay).toBeUndefined();
  });

  it("releases the reservation on failure so a retry may proceed", () => {
    const store = new IdempotencyStore();
    store.reserve("k4", { a: 1 });
    store.fail("k4");
    const { replay, conflict } = store.check("k4", { a: 1 });
    expect(replay).toBeUndefined();
    expect(conflict).toBeUndefined();
  });
});
