import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { SignaturePad } from "../src/index.js";

afterEach(cleanup);

/**
 * jsdom's canvas has no 2D context implementation — stub the minimal drawing
 * surface the component uses so the pointer-event pipeline is exercised for
 * real (state transitions, aria, data-URL emission) while geometry is faked.
 */
function stubCanvas2d(canvas: HTMLCanvasElement, box: { width: number; height: number }) {
  Object.defineProperty(canvas, "clientWidth", { value: box.width, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: box.height, configurable: true });
  canvas.toDataURL = () => "data:image/png;base64,AAAA";
  const fakeCtx = {
    setTransform: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    clearRect: () => {},
    drawImage: () => {},
  };
  vi.spyOn(canvas, "getContext").mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
}

/**
 * The pad is controlled: the caller owns the data URL. These tests render a
 * harness that adopts onChange, which is how every real call site works.
 */
function SignatureHarness({ onChange }: { onChange?: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <SignaturePad
      label="Witness"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("SignaturePad (frontend §5.2 — witness/verifier attestation)", () => {
  it("starts empty with its hint and no img role", () => {
    render(<SignaturePad label="Pharmacist witness" value={null} onChange={() => {}} />);
    expect(screen.getByText(/Draw the signature inside the box\./i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear signature/i })).toBeDisabled();
  });

  it("emits a PNG data URL after a stroke and announces capture via role=img", async () => {
    const onChange = vi.fn();
    const { container } = render(<SignatureHarness onChange={onChange} />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    stubCanvas2d(canvas, { width: 300, height: 140 });

    // React batches synthetic-event state updates; raw dispatchEvent needs an
    // act() wrapper for the re-render to land before assertions.
    await act(async () => {
      canvas.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
      canvas.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 40, clientY: 30, bubbles: true }));
      canvas.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("data:image/png;base64,AAAA");
    expect(screen.getByRole("img", { name: /Witness — signature captured/i })).toBeInTheDocument();
    expect(screen.getByText(/Signature captured\./i)).toBeInTheDocument();
  });

  it("clears back to null and resets the announced state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<SignatureHarness onChange={onChange} />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    stubCanvas2d(canvas, { width: 300, height: 140 });

    await act(async () => {
      canvas.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
      canvas.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 40, clientY: 30, bubbles: true }));
      canvas.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });
    expect(screen.getByRole("img")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Clear signature/i }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps a disabled pad readable — an attested record must not lose its signature", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <SignaturePad label="Verifier" value="data:image/png;base64,AAAA" onChange={onChange} disabled />,
    );
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    // A disabled pad never emits and never clears.
    await act(async () => {
      canvas.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 5, clientY: 5, bubbles: true }));
      canvas.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 15, clientY: 15, bubbles: true }));
      canvas.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Clear signature/i })).toBeDisabled();
  });
});
