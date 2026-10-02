import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { StepUpProvider, useStepUp, isStepUpRequired } from "../src/shared/auth/StepUpContext.js";
import { ApiError } from "../src/shared/api/client.js";
import { useStubHandler } from "./setup.js";

/**
 * Step-up client hook — todo.md §1.2/§1.3 ("the web passphrase modal hook
 * lands with the 1.7 shells"). The 401 STEP_UP_REQUIRED contract is live on
 * the API; this proves the web half classifies the problem and completes the
 * challenge against POST /auth/step-up.
 */
function ChallengeButton({ onResult }: { onResult: (granted: boolean) => void }) {
  const { requestStepUp } = useStepUp();
  return (
    <button type="button" onClick={() => void requestStepUp("Disable MFA").then(onResult)}>
      do-risky-thing
    </button>
  );
}

describe("Step-up (todo §1.2)", () => {
  it("isStepUpRequired classifies the 401 problem code, and only it", () => {
    const problem = { type: "about:blank", title: "Step-up required", status: 401, code: "STEP_UP_REQUIRED" };
    expect(isStepUpRequired(new ApiError(problem, 401))).toBe(true);
    expect(isStepUpRequired(new ApiError({ ...problem, code: "MODULE_NOT_ENTITLED" }, 403))).toBe(false);
    expect(isStepUpRequired(new Error("plain"))).toBe(false);
  });

  it("opens the passphrase modal and resolves true after the server accepts", async () => {
    useStubHandler((req, res) => {
      if (req.url?.includes("/auth/step-up")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ accessToken: "step-up-token" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({}));
    });

    let granted: boolean | undefined;
    render(
      <MemoryRouter>
        <StepUpProvider>
          <ChallengeButton onResult={(g) => (granted = g)} />
        </StepUpProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /do-risky-thing/i }));
    expect(screen.getByText(/Confirm it's you/i)).toBeInTheDocument();
    expect(screen.getByText(/Disable MFA/)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: /Confirm/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Passphrase$/i), { target: { value: "DemoPassw0rd!2026" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(granted).toBe(true));
    await waitFor(() => expect(screen.queryByText(/Confirm it's you/i)).not.toBeInTheDocument());
  });

  it("resolves false and surfaces the server detail when the passphrase is wrong", async () => {
    useStubHandler((req, res) => {
      res.writeHead(401, { "content-type": "application/problem+json" });
      res.end(
        JSON.stringify({
          type: "about:blank",
          title: "Step-up failed",
          status: 401,
          code: "STEP_UP_FAILED",
          detail: "Passphrase did not match.",
        }),
      );
    });

    let granted: boolean | undefined;
    render(
      <MemoryRouter>
        <StepUpProvider>
          <ChallengeButton onResult={(g) => (granted = g)} />
        </StepUpProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /do-risky-thing/i }));
    fireEvent.change(screen.getByLabelText(/^Passphrase$/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Passphrase did not match\./i);
    expect(screen.getByText(/Confirm it's you/i)).toBeInTheDocument(); // modal stays open

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    await waitFor(() => expect(granted).toBe(false));
    expect(screen.queryByText(/Confirm it's you/i)).not.toBeInTheDocument();
  });
});
