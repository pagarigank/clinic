import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { toHaveNoViolations } from "jest-axe";

// Register jest-axe's matcher (the import shape is
// { toHaveNoViolations: { toHaveNoViolations(): void } }) with a cast, since
// its type predates vitest's MatcherState signature.
expect.extend({
  toHaveNoViolations: (toHaveNoViolations as unknown as Record<string, (this: unknown, ...a: unknown[]) => unknown>).toHaveNoViolations,
} as unknown as Parameters<typeof expect.extend>[0]);

/**
 * Deterministic API stub for component tests. MSW 3's interceptor does not
 * reliably cover jsdom's fetch in this environment, so we run a real loopback
 * HTTP server and point the API client at it via API_ORIGIN (see client.ts).
 */
export type StubHandler = (req: IncomingMessage, res: ServerResponse) => void;

let currentHandler: StubHandler = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      message: "pong",
      dbTime: "2026-10-01 08:00:00+08",
      request_id: "1b671a64-40d5-491e-99b0-da01ff1f3341",
    }),
  );
};

let server: Server | undefined;
let port = 8790;

beforeAll(async () => {
  server = createServer((req, res) => currentHandler(req, res));
  await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
  process.env.API_ORIGIN = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  currentHandler = defaultHandler;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

function defaultHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      message: "pong",
      dbTime: "2026-10-01 08:00:00+08",
      request_id: "1b671a64-40d5-491e-99b0-da01ff1f3341",
    }),
  );
}

/** Override the stub for one test (reset per-test automatically). */
export function useStubHandler(handler: StubHandler): void {
  currentHandler = handler;
}

export function stubUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}
