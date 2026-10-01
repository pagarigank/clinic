import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { PingPage } from "../src/features/ping/PingPage.js";
import { useStubHandler } from "./setup.js";

function renderPage() {
  return render(
    <MemoryRouter>
      <PingPage />
    </MemoryRouter>,
  );
}

describe("PingPage states (frontend §19)", () => {
  it("shows the success state on a healthy ping", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/round trip OK/)).toBeInTheDocument());
  });

  it("shows the error state when the API fails", async () => {
    useStubHandler((_req, res) => {
      res.writeHead(500, { "content-type": "application/problem+json" });
      res.end(
        JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, code: "INTERNAL" }),
      );
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Error:/)).toBeInTheDocument());
  });
});

describe("accessibility (todo 0.4)", () => {
  it("success state has no axe violations", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText(/round trip OK/)).toBeInTheDocument());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
