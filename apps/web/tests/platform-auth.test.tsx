import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PlatformAuthProvider, RequirePlatform } from "../src/shared/auth/PlatformAuthContext.js";
import { PlatformLoginPage } from "../src/features/platform/PlatformLoginPage.js";
import { useStubHandler } from "./setup.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Platform console auth (frontend.md §14.1): a separate principal from the
 * tenant user. `/platform/*` must render only for a platform session, deny
 * tenant users with a 403, and send anonymous visitors to the platform login.
 */

const PLATFORM_SESSION = {
  user: { id: "0706469e-8eb1-4079-83bd-1be24506447a", email: "superadmin@clinic.local", name: "Super Admin" },
  sessionId: "0ce14069-3433-4467-a0c8-79094443ff90",
  amr: ["pwd"],
};

const TENANT_SESSION = {
  // Synthetic: this suite mocks /auth/session, so no seeded user is involved.
  user: { id: crypto.randomUUID(), name: "Tenant Admin", email: "admin@demo-a.test" },
  tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "demo-a" },
  branchId: "b1000000-0000-4000-8000-000000000001",
  assignedBranches: [{ id: "b1000000-0000-4000-8000-000000000001", name: "Main" }],
  modules: ["admin"],
  permissions: ["admin.user.read"],
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function platformAuthedHandler(getTenant: () => number = () => 401) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (url.includes("/auth/platform/refresh")) return json(res, 200, { accessToken: "platform-token" });
    if (url.includes("/auth/platform/session")) return json(res, 200, PLATFORM_SESSION);
    if (url.includes("/auth/session")) return json(res, getTenant(), TENANT_SESSION);
    if (url.includes("/auth/refresh")) return json(res, 401, { code: "INVALID_CREDENTIALS" });
    return json(res, 200, {});
  };
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/platform/tenants"]}>
      <AuthProvider>
        <PlatformAuthProvider>
          <Routes>
            <Route
              path="/platform/tenants"
              element={
                <RequirePlatform>
                  <div>TENANTS-LANDING</div>
                </RequirePlatform>
              }
            />
            <Route path="/platform/login" element={<div>PLATFORM-LOGIN</div>} />
          </Routes>
        </PlatformAuthProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequirePlatform (frontend.md §14.1)", () => {
  it("renders the console for a platform session", async () => {
    useStubHandler(platformAuthedHandler());
    renderGuard();
    expect(await screen.findByText("TENANTS-LANDING")).toBeInTheDocument();
  });

  it("returns 403-style denial for a tenant user", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/auth/platform/")) return json(res, 401, { code: "INVALID_CREDENTIALS" });
      if (url.includes("/auth/session")) return json(res, 200, TENANT_SESSION);
      if (url.includes("/auth/refresh")) return json(res, 200, { accessToken: "tenant-token" });
      return json(res, 200, {});
    });
    renderGuard();
    expect(await screen.findByText(/403 — Platform access only/i)).toBeInTheDocument();
    expect(screen.queryByText("TENANTS-LANDING")).not.toBeInTheDocument();
  });

  it("redirects an anonymous visitor to the platform login", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/auth/platform/")) return json(res, 401, { code: "INVALID_CREDENTIALS" });
      if (url.includes("/auth/")) return json(res, 401, { code: "INVALID_CREDENTIALS" });
      return json(res, 200, {});
    });
    renderGuard();
    expect(await screen.findByText("PLATFORM-LOGIN")).toBeInTheDocument();
  });
});

describe("PlatformLoginPage (frontend.md §14.1)", () => {
  it("signs in and lands on the tenants console", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/auth/platform/login")) return json(res, 200, { status: "AUTHENTICATED", accessToken: "platform-token" });
      if (url.includes("/auth/platform/session")) return json(res, 200, PLATFORM_SESSION);
      if (url.includes("/auth/platform/")) return json(res, 401, { code: "INVALID_CREDENTIALS" });
      if (url.includes("/auth/")) return json(res, 401, { code: "INVALID_CREDENTIALS" });
      return json(res, 200, {});
    });

    render(
      <MemoryRouter initialEntries={["/platform/login"]}>
        <AuthProvider>
          <PlatformAuthProvider>
            <Routes>
              <Route path="/platform/login" element={<PlatformLoginPage />} />
              <Route path="/platform/tenants" element={<div>TENANTS-LANDING</div>} />
            </Routes>
          </PlatformAuthProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Defaults match seeds/demo.sql (superadmin@clinic.local).
    expect(screen.getByLabelText(/Platform email/i)).toHaveValue("superadmin@clinic.local");
    fireEvent.click(screen.getByRole("button", { name: /Sign in to Platform Console/i }));

    expect(await screen.findByText("TENANTS-LANDING")).toBeInTheDocument();
  });
});
