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
  vision: [
    { name: "Surveillance", params: { anchor: "energy", density: 44, accentProb: 0.14, nodeMarkers: false, boxColor: "#4be3d0", accentColor: "#4be3d0", lineColor: "#ffffff", lineOpacity: 0.5 } },
    { name: "Targeting", params: { density: 22, boxMinPx: 24, boxMaxPx: 90, hubCount: 1, accentProb: 0.24, nodeMarkers: true, boxColor: "#ff3b3b", accentColor: "#ff3b3b", lineColor: "#ff9a9a", lineOpacity: 0.6 } },
    { name: "Swarm", params: { density: 100, flickerRate: 20, jitter: 0.6, connectorCount: 44 } },
    { name: "Ghost HUD", params: { density: 34, accentProb: 0.08, lineOpacity: 0.3 }, opacity: 0.5, blend: "screen" },
  ],
  falsecolor: [
    { name: "Ironbow", params: { palette: "ironbow", gain: 1.4, levels: 0, invert: false } },
    { name: "White-hot", params: { palette: "whitehot", gain: 1.3, levels: 0, invert: false } },
    { name: "Black-hot", params: { palette: "whitehot", gain: 1.5, invert: true } },
    { name: "Isotherm", params: { palette: "medical", gain: 1.4, levels: 6 } },
    { name: "Cobalt duotone", params: { palette: "duotone", gain: 1.5, shadowColor: "#06122e", highlightColor: "#5ec8ff" } },
  ],
  mirror: [
    { name: "Mandala", params: { pattern: "kaleido", segments: 8, zoom: 1.3 } },
    { name: "Quad fold", params: { pattern: "quadMirror", zoom: 1.1 } },
    { name: "Hexascope", params: { pattern: "kaleido", segments: 12, zoom: 1.5 } },
    { name: "Prism split", params: { pattern: "kaleido", segments: 6, zoom: 1.6 }, opacity: 0.6, blend: "screen" },
  ],
  pixelate: [
    { name: "Censor", params: { blockSize: 22, shape: "square", outline: false } },
    { name: "Vaporwave", params: { blockSize: 14, shape: "square", outline: true } },
    { name: "Dot grid", params: { blockSize: 12, shape: "circle" } },
    { name: "Chunky hex", params: { blockSize: 20, shape: "hex" } },
  ],
  crt: [
    { name: "Broadcast VHS", params: { maskType: "apertureGrille", maskDepth: 0.5, chromaBleed: 0.5, scanlineIntensity: 0.4, barrel: 0.2, vignette: 0.4, noise: 0.12, tracking: 0.2 } },
    { name: "Trinitron PVM", params: { maskType: "apertureGrille", maskDepth: 0.7, chromaBleed: 0.2, scanlineIntensity: 0.5, barrel: 0.1, vignette: 0.3, noise: 0.03, tracking: 0.02 } },
    { name: "Dead channel", params: { maskType: "shadowMask", maskDepth: 0.4, chromaBleed: 0.7, scanlineIntensity: 0.3, barrel: 0.35, vignette: 0.6, noise: 0.45, rollSpeed: 0.3, tracking: 0.5 } },
    { name: "Camcorder '92", params: { maskType: "none", maskDepth: 0.2, chromaBleed: 0.35, scanlineIntensity: 0.25, barrel: 0.15, vignette: 0.35, noise: 0.18, tracking: 0.12 } },
  ],
  contour: [
    { name: "Topo map", params: { levels: 8, palette: "terrain", fill: "banded", smoothing: 1 } },
    { name: "Contour lines", params: { levels: 12, palette: "mono", fill: "none", smoothing: 1 }, opacity: 0.8, blend: "multiply" },
    { name: "Elevation heat", params: { levels: 10, palette: "turbo", fill: "banded", smoothing: 1 } },
    { name: "Blueprint", params: { levels: 8, palette: "ink", fill: "none", invert: true, smoothing: 1 } },
  ],
  lowpoly: [
    { name: "Crystal", params: { density: 18, cellShape: "triangle", colorSampling: "average", outline: 0 } },
    { name: "Facet + wire", params: { density: 16, cellShape: "triangle", colorSampling: "centroid", outline: 1 } },
    { name: "Voronoi shards", params: { density: 22, cellShape: "voronoi", colorSampling: "average", outline: 0 } },
    { name: "Stained glass", params: { density: 14, cellShape: "voronoi", colorSampling: "average", outline: 2 } },
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
