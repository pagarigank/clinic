import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../src/shared/theme/ThemeProvider.js";
import { ThemeControls } from "../src/shared/theme/ThemeControls.js";

/**
 * Theme + density (frontend.md §5.1).
 *
 * The behaviour that matters: the colour mode is written as `data-bs-theme` on
 * <html> because that is Bootstrap 5.3's native switch (ADR-8) — if this ever
 * becomes a class toggle, dark mode stops working across the whole app.
 */

function Probe() {
  const { theme, density } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="density">{density}</span>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-bs-theme");
  document.documentElement.removeAttribute("data-density");
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ThemeProvider", () => {
  it("writes both attributes onto <html> so tokens.css and Bootstrap agree", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
  });

  it("honours a stored preference over the system default", () => {
    window.localStorage.setItem("clinic.preferences", JSON.stringify({ theme: "dark", density: "compact" }));
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("density")).toHaveTextContent("compact");
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
  });

  it("falls back to the system preference when nothing is stored", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("survives a corrupt stored value instead of breaking boot", () => {
    window.localStorage.setItem("clinic.preferences", "{not json");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("rejects a stored value that is not a known mode rather than trusting it", () => {
    // A hand-edited or stale entry must not be able to set an arbitrary mode —
    // the attribute would then match no token block and the UI would lose its
    // semantic colours entirely.
    window.localStorage.setItem("clinic.preferences", JSON.stringify({ theme: "neon", density: "huge" }));
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(screen.getByTestId("density")).toHaveTextContent("comfortable");
  });

  it("persists a change and flips the attribute", async () => {
    const user = userEvent.setup();
    function Switcher() {
      const { setTheme, setDensity } = useTheme();
      return (
        <div>
          <button type="button" onClick={() => setTheme("dark")}>
            dark
          </button>
          <button type="button" onClick={() => setDensity("compact")}>
            compact
          </button>
        </div>
      );
    }
    render(
      <ThemeProvider>
        <Switcher />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "compact" }));
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");

    const stored = JSON.parse(window.localStorage.getItem("clinic.preferences")!);
    expect(stored).toMatchObject({ theme: "dark", density: "compact" });
  });

  it("throws a useful error when useTheme is used outside the provider", () => {
    // Silence the expected React error boundary noise for this intentional throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});

describe("ThemeControls (frontend §17 — WCAG 2.2 AA)", () => {
  it("exposes the pressed state so a screen reader knows the current mode", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>,
    );
    const light = screen.getByRole("button", { name: "Light" });
    const dark = screen.getByRole("button", { name: "Dark" });
    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");

    await user.click(dark);
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(light).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
  });

  it("is operable with the keyboard alone (P-9)", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>,
    );
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
  });

  it("switches density and reflects it on the control", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>,
    );
    const compact = screen.getByRole("button", { name: "Compact" });
    await user.click(compact);
    expect(compact).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });
});