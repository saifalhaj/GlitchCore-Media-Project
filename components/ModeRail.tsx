"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_PARAMS, MODE_ORDER, MODES, runPixelEffect } from "@/lib/modes";
import type { ModeId } from "@/lib/effects/types";
import { drawImageData } from "@/lib/image";

/**
 * Signature element — the mode switcher is five live thumbnails, each showing a
 * fixed sample already run through that mode. Navigation doubles as a gallery.
 * Thumbnails are computed once (static) from a low-res sample, so this respects
 * reduced-motion for free.
 */
export function ModeRail({
  activeMode,
  onSelect,
  sample,
}: {
  activeMode: ModeId;
  onSelect: (m: ModeId) => void;
  sample: ImageData | null;
}) {
  const canvases = useRef<Partial<Record<ModeId, HTMLCanvasElement | null>>>({});

  useEffect(() => {
    if (!sample) return;
    for (const id of MODE_ORDER) {
      const canvas = canvases.current[id];
      if (!canvas) continue;
      try {
        if (id === "yolo") {
          drawYoloPreview(canvas, sample);
        } else {
          const { imageData } = runPixelEffect(id, sample, DEFAULT_PARAMS[id]);
          drawImageData(canvas, imageData);
        }
      } catch {
        // A thumbnail failing shouldn't break the rail — leave it blank.
      }
    }
  }, [sample]);

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-2.5 md:overflow-visible md:pb-0"
      role="tablist"
      aria-label="Effect modes"
    >
      {MODE_ORDER.map((id) => {
        const mode = MODES[id];
        const active = id === activeMode;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(id)}
            className="group relative w-[86px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] border text-left transition-all md:w-full"
            style={{
              borderColor: active ? mode.color : "var(--hairline)",
              boxShadow: active ? `0 0 0 1px ${mode.color}, 0 0 18px -8px ${mode.color}` : "none",
            }}
          >
            <div className="checker aspect-[3/2] w-full">
              <canvas
                ref={(el) => {
                  canvases.current[id] = el;
                }}
                className="h-full w-full object-cover"
                style={{ imageRendering: id === "ascii" || id === "halftone" ? "pixelated" : "auto" }}
              />
            </div>
            <div
              className="flex items-center justify-between px-2 py-1"
              style={{
                background: active
                  ? `color-mix(in srgb, ${mode.color} 14%, var(--surface))`
                  : "var(--surface)",
              }}
            >
              <span
                className="font-mono text-[11px] font-medium"
                style={{ color: active ? mode.color : "var(--text-muted)" }}
              >
                {mode.name}
              </span>
              {active && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: mode.color }}
                />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Static, model-free preview for the YOLO thumbnail (real detection runs in the
 *  stage on demand — no reason to eagerly download the model for a 56px chip). */
function drawYoloPreview(canvas: HTMLCanvasElement, sample: ImageData) {
  drawImageData(canvas, sample);
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#ff6b00";
  ctx.lineWidth = Math.max(1, Math.round(sample.width / 90));
  const boxes: [number, number, number, number][] = [
    [0.08, 0.18, 0.42, 0.7],
    [0.55, 0.32, 0.34, 0.52],
  ];
  for (const [x, y, w, h] of boxes) {
    ctx.strokeRect(x * sample.width, y * sample.height, w * sample.width, h * sample.height);
  }
}
