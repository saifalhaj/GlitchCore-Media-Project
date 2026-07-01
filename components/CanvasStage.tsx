"use client";

import { useEffect, useState, type RefObject } from "react";
import { runPixelEffect, type Params } from "@/lib/modes";
import type { ModeId, YoloParams } from "@/lib/effects/types";
import { detect } from "@/lib/effects/yolo";
import { clearCanvas, drawDetections, drawImageData } from "@/lib/image";

export type StageStatus =
  | "processing"
  | "ready"
  | "loading-model"
  | "model-missing";

export type Stats = { ms: number; detections?: number; status: StageStatus };

export function CanvasStage({
  source,
  mode,
  params,
  baseRef,
  overlayRef,
  onAsciiText,
  onStats,
}: {
  source: ImageData;
  mode: ModeId;
  params: Params;
  baseRef: RefObject<HTMLCanvasElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  onAsciiText: (t: string | null) => void;
  onStats: (s: Stats) => void;
}) {
  const [status, setStatus] = useState<StageStatus>("processing");

  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;
    const overlay = overlayRef.current;
    let cancelled = false;

    const report = (s: Stats) => {
      if (cancelled) return;
      setStatus(s.status);
      onStats(s);
    };

    report({ ms: 0, status: mode === "yolo" ? "loading-model" : "processing" });

    const run = async () => {
      const t0 = performance.now();

      if (mode !== "yolo") {
        if (overlay) clearCanvas(overlay);
        const { imageData, text } = runPixelEffect(mode, source, params);
        if (cancelled) return;
        drawImageData(base, imageData);
        onAsciiText(mode === "ascii" ? (text ?? null) : null);
        report({ ms: performance.now() - t0, status: "ready" });
        return;
      }

      // YOLO: source stays as the base, boxes go on the overlay layer.
      drawImageData(base, source);
      onAsciiText(null);
      try {
        const dets = await detect(source, params as unknown as YoloParams);
        if (cancelled) return;
        if (overlay) {
          drawDetections(overlay, source.width, source.height, dets, {
            lineWidth: Number(params.boxLineWidth),
            showLabels: Boolean(params.showLabels),
          });
        }
        report({ ms: performance.now() - t0, detections: dets.length, status: "ready" });
      } catch (e) {
        if (cancelled) return;
        if (overlay) clearCanvas(overlay);
        const code = (e as { code?: string })?.code;
        if (code === "MODEL_UNAVAILABLE") {
          report({ ms: performance.now() - t0, status: "model-missing" });
        } else {
          console.error("[yolo]", e);
          report({ ms: performance.now() - t0, status: "ready" });
        }
      }
    };

    // Debounce so dragging a slider (or YOLO inference) doesn't fire per tick.
    const timer = setTimeout(run, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, mode, JSON.stringify(params)]);

  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden p-4 sm:p-6">
      {/* Both canvases share one grid cell and shrink to fit via max-w/max-h,
          keeping their intrinsic aspect — so the YOLO overlay stays aligned. */}
      <canvas
        ref={baseRef}
        className="checker col-start-1 row-start-1 max-h-full max-w-full rounded-[var(--radius-sm)]"
        style={{ imageRendering: mode === "ascii" || mode === "halftone" ? "pixelated" : "auto" }}
      />
      <canvas
        ref={overlayRef}
        className="pointer-events-none col-start-1 row-start-1 max-h-full max-w-full"
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
        <div className="absolute inset-x-4 bottom-4 rounded-[var(--radius-sm)] border border-[var(--mode-yolo)]/50 bg-[var(--surface)]/95 px-3 py-2.5">
          <p className="font-mono text-[11px] leading-relaxed text-[var(--text)]">
            <span style={{ color: "var(--mode-yolo)" }}>YOLO model not found.</span>{" "}
            Drop <code>yolo11n.onnx</code> into <code>public/models/</code> to
            enable in-browser detection. The source image is shown unaltered.
          </p>
        </div>
      )}
    </div>
  );
}
