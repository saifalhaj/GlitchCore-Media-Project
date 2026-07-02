// One-click looks per mode — the simple face of the tool. A preset bundles
// effect params (and optionally layer opacity/blend); the dials under
// "Advanced" expose the same values for fine-tuning.

import type { ModeId } from "./effects/types";
import type { Params } from "./modes";
import type { BlendMode } from "./image";

export type Preset = {
  name: string;
  params: Params;
  opacity?: number; // layer opacity, defaults to 1
  blend?: BlendMode; // defaults to "normal"
};

export const PRESETS: Record<ModeId, Preset[]> = {
  ascii: [
    { name: "Terminal", params: { columns: 120, ramp: "standard", colorMode: "mono", invert: false } },
    { name: "Dense type", params: { columns: 180, ramp: "detailed", colorMode: "mono", invert: false } },
    { name: "Color type", params: { columns: 110, ramp: "standard", colorMode: "sampled", invert: false } },
    { name: "Ghost text", params: { columns: 130, ramp: "minimal", colorMode: "mono", invert: false }, opacity: 0.55 },
  ],
  glitch: [
    { name: "Subtle", params: { rgbShiftPx: 3, scanlineOpacity: 0.08, pixelSortThreshold: 0.85, blockCorruptAmount: 0.05, seed: 1337 } },
    { name: "VHS", params: { rgbShiftPx: 8, scanlineOpacity: 0.35, pixelSortThreshold: 0.78, blockCorruptAmount: 0.12, seed: 2049 } },
    { name: "Meltdown", params: { rgbShiftPx: 18, scanlineOpacity: 0.18, pixelSortThreshold: 0.45, blockCorruptAmount: 0.45, seed: 777 } },
  ],
  yolo: [
    { name: "Clean boxes", params: { confThreshold: 0.4, iouThreshold: 0.45, boxLineWidth: 2, showLabels: true } },
    { name: "Bold", params: { confThreshold: 0.3, iouThreshold: 0.45, boxLineWidth: 4, showLabels: true } },
    { name: "Boxes only", params: { confThreshold: 0.4, iouThreshold: 0.45, boxLineWidth: 3, showLabels: false } },
  ],
  halftone: [
    { name: "Newspaper", params: { algorithm: "dotHalftone", cellSize: 6, threshold: 128, colorMode: "mono" } },
    { name: "Comic", params: { algorithm: "bayer4x4", cellSize: 4, threshold: 128, colorMode: "duotone" } },
    { name: "Diffusion", params: { algorithm: "floydSteinberg", cellSize: 3, threshold: 128, colorMode: "mono" } },
    { name: "Print wash", params: { algorithm: "dotHalftone", cellSize: 9, threshold: 128, colorMode: "duotone" }, opacity: 0.65, blend: "multiply" },
  ],
  edges: [
    { name: "Line art", params: { threshold: 80, invert: false } },
    { name: "Ink sketch", params: { threshold: 60, invert: true } },
    { name: "Neon trace", params: { threshold: 95, invert: false }, opacity: 0.75, blend: "screen" },
  ],
  depth: [
    { name: "Thermal", params: { colormap: "turbo", invert: false } },
    { name: "Silver", params: { colormap: "grayscale", invert: false } },
    { name: "Depth fog", params: { colormap: "grayscale", invert: true }, opacity: 0.55, blend: "screen" },
  ],
};

/** True when the layer's current settings match this preset exactly. */
export function presetMatches(
  preset: Preset,
  params: Params,
  opacity: number,
  blend: BlendMode,
): boolean {
  for (const [k, v] of Object.entries(preset.params)) {
    if (params[k] !== v) return false;
  }
  if ((preset.opacity ?? 1) !== opacity) return false;
  if ((preset.blend ?? "normal") !== blend) return false;
  return true;
}
