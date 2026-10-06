import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { LoginPage } from "../src/features/auth/LoginPage.js";
import { RegisterPage } from "../src/features/auth/RegisterPage.js";
import { useStubHandler } from "./setup.js";

describe("LoginPage", () => {
  it("renders login form with Cerulean branding and fields", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Clinic Platform")).toBeInTheDocument();
    expect(screen.getByLabelText(/CLINIC IDENTIFIER/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/WORK EMAIL ADDRESS/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PASSWORD/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign In to Clinic/i })).toBeInTheDocument();
    expect(screen.getByText(/Schedule Appointment with Doctor/i)).toBeInTheDocument();
    expect(screen.getByText(/Submit Staff Registration Request/i)).toBeInTheDocument();
  });

  it("initializes with empty textboxes and hidden demo credential buttons", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    const slugInput = screen.getByLabelText(/CLINIC IDENTIFIER/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/WORK EMAIL ADDRESS/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/PASSWORD/i) as HTMLInputElement;

    expect(slugInput.value).toBe("");
    expect(emailInput.value).toBe("");
    expect(passwordInput.value).toBe("");
    expect(screen.queryByRole("button", { name: /Tenant Admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Attending Doctor/i })).not.toBeInTheDocument();
  });

  it("fills admin credentials and automatically logs in on Ctrl + I shortcut", async () => {
    let loginBody: any = null;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/auth/login")) {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          loginBody = JSON.parse(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "OK", accessToken: "test-token" }));
        });
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "pong" }));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "i", ctrlKey: true });

    const slugInput = screen.getByLabelText(/CLINIC IDENTIFIER/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/WORK EMAIL ADDRESS/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/PASSWORD/i) as HTMLInputElement;

    expect(slugInput.value).toBe("demo-a");
    expect(emailInput.value).toBe("admin@demo-a.test");
    expect(passwordInput.value).toBe("DemoPassw0rd!2026");

    await waitFor(() => {
      expect(loginBody).toEqual({
        tenant: "demo-a",
        email: "admin@demo-a.test",
        password: "DemoPassw0rd!2026",
      });
    });
  });
});

describe("RegisterPage", () => {
  it("renders registration form with Tenant Admin approval notice", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <RegisterPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Staff & Practitioner Registration/i)).toBeInTheDocument();
    expect(screen.getByText(/Tenant Admin Approval Required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/FIRST NAME/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/LAST NAME/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/OFFICIAL \/ WORK EMAIL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CLINICAL \/ STAFF ROLE/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit Registration for Admin Approval/i })).toBeInTheDocument();
  });

  it("submits registration and displays pending approval status screen", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <RegisterPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/FIRST NAME/i), { target: { value: "Jose" } });
    fireEvent.change(screen.getByLabelText(/LAST NAME/i), { target: { value: "Rizal" } });
    fireEvent.change(screen.getByLabelText(/OFFICIAL \/ WORK EMAIL/i), { target: { value: "dr.rizal@clinic.ph" } });
    fireEvent.change(screen.getByLabelText(/MOBILE NO\./i), { target: { value: "0917-111-2222" } });

    fireEvent.click(screen.getByRole("button", { name: /Submit Registration for Admin Approval/i }));

    expect(screen.getByText(/Registration Submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/PENDING TENANT ADMIN APPROVAL/i)).toBeInTheDocument();
    expect(screen.getByText(/Jose Rizal/i)).toBeInTheDocument();
  });
});
