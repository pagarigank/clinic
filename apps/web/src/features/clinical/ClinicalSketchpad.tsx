import { useEffect, useRef, useState, useCallback } from "react";

interface ClinicalSketchpadProps {
  storageKey?: string;
  height?: number;
  title?: string;
}

export function ClinicalSketchpad({
  storageKey = "clinic_general_sketchpad",
  height = 480,
  title = "Clinical Sketch & Annotation Pad",
}: ClinicalSketchpadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [tool, setTool] = useState<"PEN" | "ERASER">("PEN");
  const [penColor, setPenColor] = useState<string>("#1e293b");
  const [penSize, setPenSize] = useState<number>(3);
  const [eraserSize, setEraserSize] = useState<number>(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Initialize canvas backing with device pixel ratio
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = rect.width > 0 ? rect.width : 800;
    const displayHeight = height;

    // Check if resize is actually needed
    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      // Save existing content before resize
      const prevData = canvas.toDataURL();

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        // Fill white background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, displayWidth, displayHeight);

        // Restore content or load from storage
        const saved = storageKey ? localStorage.getItem(storageKey) : null;
        const toLoad = saved || (prevData.length > 50 ? prevData : null);

        if (toLoad) {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
          };
          img.src = toLoad;
        }
      }
    }
  }, [height, storageKey]);

  useEffect(() => {
    initCanvas();
    const handleResize = () => {
      // Debounce resize
      initCanvas();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [initCanvas]);

  // Save canvas state into history stack
  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory((prev) => [...prev.slice(-19), data]);

    if (storageKey) {
      try {
        localStorage.setItem(storageKey, canvas.toDataURL("image/png"));
      } catch {
        // LocalStorage quota fallback
      }
    }
  }, [storageKey]);

  const undo = () => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nextHistory = [...history];
    const previous = nextHistory.pop();
    setHistory(nextHistory);

    if (previous) {
      ctx.putImageData(previous, 0, 0);
      if (storageKey) {
        localStorage.setItem(storageKey, canvas.toDataURL("image/png"));
      }
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    saveState();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.width / dpr;
    const displayHeight = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
    setSavedNotice("Canvas cleared");
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const downloadSketch = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `clinical-sketch-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setSavedNotice("Sketch downloaded");
    setTimeout(() => setSavedNotice(null), 2500);
  };

  // Coordinates helper
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const lastCoords = useRef<{ x: number; y: number } | null>(null);

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    saveState();
    setIsDrawing(true);
    const coords = getCanvasCoords(e);
    lastCoords.current = coords;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Dot on single click
    ctx.save();
    if (tool === "ERASER") {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, eraserSize / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = penColor;
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, penSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastCoords.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentCoords = getCanvasCoords(e);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === "ERASER") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = eraserSize;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize;
    }

    ctx.beginPath();
    ctx.moveTo(lastCoords.current.x, lastCoords.current.y);
    ctx.lineTo(currentCoords.x, currentCoords.y);
    ctx.stroke();
    ctx.restore();

    lastCoords.current = currentCoords;
  };

  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (canvas && e.pointerId) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore pointer release error
      }
    }
    setIsDrawing(false);
    lastCoords.current = null;

    if (storageKey && canvas) {
      try {
        localStorage.setItem(storageKey, canvas.toDataURL("image/png"));
      } catch {
        // quota fallback
      }
    }
  };

  return (
    <div className="clinic-sketchpad-container card shadow-sm border">
      {/* Header & Controls Toolbar */}
      <div className="card-header bg-light py-2 px-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div className="d-flex align-items-center gap-2">
          <span className="fw-bold text-dark">{title}</span>
          {savedNotice && (
            <span className="badge bg-success-subtle text-success border border-success-subtle small">
              ✓ {savedNotice}
            </span>
          )}
        </div>

        {/* Toolbar: Pen, Eraser, Clear, Undo, Download */}
        <div className="d-flex align-items-center flex-wrap gap-2">
          {/* Tool Selector (Pen vs Eraser) */}
          <div className="btn-group btn-group-sm" role="group" aria-label="Drawing Tools">
            <button
              type="button"
              className={`btn ${tool === "PEN" ? "btn-primary active fw-bold" : "btn-outline-secondary"}`}
              onClick={() => setTool("PEN")}
              title="Pen tool"
            >
              ✏️ Pen
            </button>
            <button
              type="button"
              className={`btn ${tool === "ERASER" ? "btn-warning active fw-bold text-dark" : "btn-outline-secondary"}`}
              onClick={() => setTool("ERASER")}
              title="Eraser tool"
            >
              🧹 Eraser
            </button>
          </div>

          {/* Quick Color Palette for Pen */}
          {tool === "PEN" && (
            <div className="d-flex align-items-center gap-1 bg-white p-1 border rounded">
              {[
                { color: "#1e293b", label: "Black / Ink" },
                { color: "#0284c7", label: "Blue / Medical" },
                { color: "#dc2626", label: "Red / Pathology / Lesion" },
                { color: "#16a34a", label: "Green / Normal" },
              ].map((c) => (
                <button
                  key={c.color}
                  type="button"
                  className="btn btn-sm p-0 rounded-circle border"
                  style={{
                    backgroundColor: c.color,
                    width: "20px",
                    height: "20px",
                    boxShadow: penColor === c.color ? "0 0 0 2px #0284c7" : "none",
                    cursor: "pointer",
                  }}
                  title={c.label}
                  onClick={() => setPenColor(c.color)}
                />
              ))}
            </div>
          )}

          {/* Stroke Width Selector */}
          <div className="d-flex align-items-center gap-1 small text-muted">
            <span style={{ fontSize: "0.78rem" }}>{tool === "PEN" ? "Pen size:" : "Eraser size:"}</span>
            {tool === "PEN" ? (
              <select
                className="form-select form-select-sm py-0 ps-2 pe-4"
                style={{ fontSize: "0.78rem", width: "auto" }}
                value={penSize}
                onChange={(e) => setPenSize(Number(e.target.value))}
              >
                <option value={2}>Fine (2px)</option>
                <option value={3}>Medium (3px)</option>
                <option value={5}>Thick (5px)</option>
              </select>
            ) : (
              <select
                className="form-select form-select-sm py-0 ps-2 pe-4"
                style={{ fontSize: "0.78rem", width: "auto" }}
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
              >
                <option value={12}>Small (12px)</option>
                <option value={20}>Medium (20px)</option>
                <option value={36}>Large (36px)</option>
              </select>
            )}
          </div>

          {/* Action buttons */}
          <div className="btn-group btn-group-sm">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={undo}
              disabled={history.length === 0}
              title="Undo last stroke"
            >
              ↩️ Undo
            </button>
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={clearCanvas}
              title="Clear all drawings"
            >
              🗑️ Clear
            </button>
          </div>

          <button
            type="button"
            className="btn btn-sm btn-outline-primary py-1 px-2"
            onClick={downloadSketch}
            title="Download sketch image as PNG"
          >
            💾 Save Image
          </button>
        </div>
      </div>

      {/* Canvas Drawing Surface */}
      <div
        ref={containerRef}
        className="card-body p-0 position-relative bg-white"
        style={{
          overflow: "hidden",
          touchAction: "none",
          backgroundImage: "radial-gradient(#e2e8f0 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          onPointerLeave={stopDrawing}
          style={{
            display: "block",
            cursor: tool === "ERASER" ? "cell" : "crosshair",
            touchAction: "none",
          }}
        />

        {/* Subtle Watermark / Instruction */}
        <div
          className="position-absolute bottom-0 end-0 p-2 text-muted pe-none user-select-none"
          style={{ fontSize: "0.72rem", opacity: 0.6 }}
        >
          ✏️ Draw freely with mouse, stylus, or touch. Pen &amp; Eraser enabled.
        </div>
      </div>
    </div>
  );
}
