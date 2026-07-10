"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Stage } from "@/lib/modes";
import { produceStage } from "@/lib/pipeline";
import { drawImageData } from "@/lib/image";

export type StageStatus =
  | "processing"
  | "ready"
  | "loading-model"
  | "model-missing";

export type Stats = { ms: number; status: StageStatus };

// Model-backed modes → the file they load (for the "model not found" notice).
const MODEL_FILES: Record<string, { name: string; file: string }> = {
  yolo: { name: "YOLO", file: "yolo11n.onnx" },
  depth: { name: "Depth", file: "depth-anything-v2-small.onnx" },
  pose: { name: "Pose (MoveNet)", file: "movenet-multipose.onnx" },
  cutout: { name: "Cutout (RMBG)", file: "rmbg-1.4.onnx" },
  depth3d: { name: "Depth 3D", file: "depth-anything-v2-small.onnx" },
};
const isModelMode = (m: string): boolean => m in MODEL_FILES;

export function CanvasStage({
  source,
  stages,
  baseRef,
  onAsciiText,
  onStats,
}: {
  source: ImageData;
  stages: Stage[];
  baseRef: RefObject<HTMLCanvasElement | null>;
  onAsciiText: (t: string | null) => void;
  onStats: (s: Stats) => void;
}) {
  const [status, setStatus] = useState<StageStatus>("processing");
  const [missingMode, setMissingMode] = useState<string | null>(null);
  const lastMode = stages[stages.length - 1]?.mode;

  // Before/after compare: a draggable divider revealing the original on the left.
  const [compare, setCompare] = useState(false);
  const [comparePos, setComparePos] = useState(0.5);
  const compareRef = useRef<HTMLCanvasElement>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Cache the raw source once per image; repaints during a drag only drawImage it.
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = source.width;
    c.height = source.height;
    c.getContext("2d")!.putImageData(source, 0, 0);
    srcCanvasRef.current = c;
  }, [source]);

  const paintCompare = useCallback((pos: number) => {
    const base = baseRef.current;
    const cmp = compareRef.current;
    const src = srcCanvasRef.current;
    if (!base || !cmp || !src || !base.width) return;
    if (cmp.width !== base.width) cmp.width = base.width;
    if (cmp.height !== base.height) cmp.height = base.height;
    const ctx = cmp.getContext("2d")!;
    ctx.clearRect(0, 0, cmp.width, cmp.height);
    ctx.drawImage(src, 0, 0, cmp.width, cmp.height);
    // Divider line at the reveal edge, tinted to the active mode.
    const accent = getComputedStyle(cmp).getPropertyValue("--accent").trim() || "#edebe3";
    const x = Math.round(pos * cmp.width);
    ctx.fillStyle = accent;
    ctx.fillRect(Math.min(cmp.width - 2, Math.max(0, x - 1)), 0, 2, cmp.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint whenever the divider moves, the result re-renders, or compare toggles on.
  useEffect(() => {
    if (compare) paintCompare(comparePos);
  }, [compare, comparePos, status, source, paintCompare]);

  const dragTo = useCallback(
    (clientX: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      if (!rect.width) return;
      setComparePos(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
    },
    [baseRef],
  );

  // Native pointer listeners (not React's delegated ones) so the drag also works
  // for synthetic/automated pointers; covers mouse, touch, and pen alike.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!compare || !el) return;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return; // toggle button, not a drag
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // stale/synthetic pointer id — capture is a nicety, dragging still works
      }
      dragTo(e.clientX);
    };
    const move = (e: PointerEvent) => {
      if (e.buttons) dragTo(e.clientX);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
    };
  }, [compare, dragTo]);

  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;
    let cancelled = false;

    const report = (s: Stats) => {
      if (cancelled) return;
      setStatus(s.status);
      onStats(s);
    };

    const hasModel = stages.some((s) => isModelMode(s.mode));
    report({ ms: 0, status: hasModel ? "loading-model" : "processing" });

    const run = async () => {
      const t0 = performance.now();
      if (hasModel) drawImageData(base, source); // placeholder while a model loads
      let acc = source;
      let text: string | null = null;
      let current: string | null = null;
      try {
        for (const s of stages) {
          current = isModelMode(s.mode) ? s.mode : null;
          const r = await produceStage(s, acc);
          if (cancelled) return;
          acc = r.imageData;
          if (s.mode === "ascii" || s.mode === "words") text = r.text ?? null;
        }
        drawImageData(base, acc);
        onAsciiText(text);
        setMissingMode(null);
        report({ ms: performance.now() - t0, status: "ready" });
      } catch (e) {
        if (cancelled) return;
        drawImageData(base, acc); // show what completed before the failing stage
        onAsciiText(text);
        const code = (e as { code?: string })?.code;
        if (code === "MODEL_UNAVAILABLE") {
          setMissingMode(current);
          report({ ms: performance.now() - t0, status: "model-missing" });
        } else {
          console.error("[stack]", e);
          report({ ms: performance.now() - t0, status: "ready" });
        }
      }
    };

    // Debounce so dragging a slider (or model inference) doesn't fire per tick.
    const timer = setTimeout(run, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, JSON.stringify(stages.map((s) => ({ m: s.mode, p: s.params, o: s.opacity, b: s.blend })))]);

  return (
    <div
      ref={containerRef}
      className="relative grid h-full w-full place-items-center overflow-hidden p-4 sm:p-6"
      style={compare ? { cursor: "ew-resize", touchAction: "none" } : undefined}
      role={compare ? "slider" : undefined}
      aria-label={compare ? "Before/after divider" : undefined}
      aria-valuenow={compare ? Math.round(comparePos * 100) : undefined}
      tabIndex={compare ? 0 : undefined}
      onKeyDown={compare ? (e) => {
        if (e.key === "ArrowLeft") setComparePos((p) => Math.max(0, p - 0.02));
        if (e.key === "ArrowRight") setComparePos((p) => Math.min(1, p + 0.02));
      } : undefined}
    >
      <canvas
        ref={baseRef}
        className="checker stage-glow col-start-1 row-start-1 max-h-full max-w-full rounded-[var(--radius-sm)]"
        style={{ imageRendering: lastMode === "ascii" || lastMode === "halftone" ? "pixelated" : "auto" }}
      />
      {compare && (
        <canvas
          ref={compareRef}
          className="pointer-events-none col-start-1 row-start-1 max-h-full max-w-full rounded-[var(--radius-sm)]"
          style={{ clipPath: `inset(0 ${(1 - comparePos) * 100}% 0 0)` }}
        />
      )}

      <button
        type="button"
        onClick={() => setCompare((v) => !v)}
        className="absolute left-3 top-3 rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition-colors"
        style={{
          borderColor: compare ? "var(--accent)" : "var(--hairline)",
          color: compare ? "var(--accent)" : "var(--text-muted)",
          background: compare
            ? "color-mix(in srgb, var(--accent) 12%, var(--surface))"
            : "color-mix(in srgb, var(--surface) 90%, transparent)",
        }}
        title="Drag the divider to compare against the original"
      >
        compare
      </button>
      {compare && (
        <>
          <span className="pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] text-[var(--text-muted)]">
            original
          </span>
          <span className="pointer-events-none absolute bottom-3 right-3 font-mono text-[10px] text-[var(--text-muted)]">
            result
          </span>
        </>
      )}

      {status === "processing" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-x-0 h-16"
            style={{
              background: "linear-gradient(var(--accent), transparent)",
              opacity: 0.12,
              animation: "scan 1.1s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {(status === "processing" || status === "loading-model") && (
        <span className="absolute right-3 top-3 rounded-full border border-[var(--hairline)] bg-[var(--surface)]/90 px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
          {status === "loading-model"
            ? "running model… first use downloads it"
            : "processing…"}
        </span>
      )}

      {status === "model-missing" && (
        <div
          className="absolute inset-x-4 bottom-4 rounded-[var(--radius-sm)] border bg-[var(--surface)]/95 px-3 py-2.5"
          style={{ borderColor: "color-mix(in srgb, var(--accent) 50%, transparent)" }}
        >
          <p className="font-mono text-[11px] leading-relaxed text-[var(--text)]">
            <span style={{ color: "var(--accent)" }}>
              {(missingMode && MODEL_FILES[missingMode]?.name) ?? "Model"} model not found.
            </span>{" "}
            Drop{" "}
            <code>{(missingMode && MODEL_FILES[missingMode]?.file) ?? "the model"}</code>{" "}
            into <code>public/models/</code> to enable it. Showing the stack up to
            that stage.
          </p>
        </div>
      )}
    </div>
  );
}
