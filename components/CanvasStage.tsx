"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Stage } from "@/lib/modes";
import { produceStage } from "@/lib/pipeline";
import { drawImageData } from "@/lib/image";

export type StageStatus =
  | "processing"
  | "ready"
  | "loading-model"
  | "model-missing";

export type Stats = { ms: number; status: StageStatus };

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
  const [missingMode, setMissingMode] = useState<"yolo" | "depth" | null>(null);
  const lastMode = stages[stages.length - 1]?.mode;

  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;
    let cancelled = false;

    const report = (s: Stats) => {
      if (cancelled) return;
      setStatus(s.status);
      onStats(s);
    };

    const hasModel = stages.some((s) => s.mode === "yolo" || s.mode === "depth");
    report({ ms: 0, status: hasModel ? "loading-model" : "processing" });

    const run = async () => {
      const t0 = performance.now();
      if (hasModel) drawImageData(base, source); // placeholder while a model loads
      let acc = source;
      let text: string | null = null;
      let current: "yolo" | "depth" | null = null;
      try {
        for (const s of stages) {
          current = s.mode === "yolo" || s.mode === "depth" ? s.mode : null;
          const r = await produceStage(s, acc);
          if (cancelled) return;
          acc = r.imageData;
          if (s.mode === "ascii") text = r.text ?? null;
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
  }, [source, JSON.stringify(stages.map((s) => ({ m: s.mode, p: s.params })))]);

  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden p-4 sm:p-6">
      <canvas
        ref={baseRef}
        className="checker max-h-full max-w-full rounded-[var(--radius-sm)]"
        style={{ imageRendering: lastMode === "ascii" || lastMode === "halftone" ? "pixelated" : "auto" }}
      />

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
          {status === "loading-model" ? "loading model…" : "processing…"}
        </span>
      )}

      {status === "model-missing" && (
        <div
          className="absolute inset-x-4 bottom-4 rounded-[var(--radius-sm)] border bg-[var(--surface)]/95 px-3 py-2.5"
          style={{ borderColor: "color-mix(in srgb, var(--accent) 50%, transparent)" }}
        >
          <p className="font-mono text-[11px] leading-relaxed text-[var(--text)]">
            <span style={{ color: "var(--accent)" }}>
              {missingMode === "depth" ? "Depth model not found." : "YOLO model not found."}
            </span>{" "}
            Drop{" "}
            <code>
              {missingMode === "depth" ? "depth-anything-v2-small.onnx" : "yolo11n.onnx"}
            </code>{" "}
            into <code>public/models/</code> to enable it. Showing the stack up to
            that stage.
          </p>
        </div>
      )}
    </div>
  );
}
