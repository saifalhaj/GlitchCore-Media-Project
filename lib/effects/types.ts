// Shared contract for every effect. The four pixel effects are pure, synchronous
// functions `(source, params) => EffectResult`. YOLO is separate (async, returns
// boxes rather than transformed pixels) — see ./yolo.ts.

export type ModeId = "ascii" | "glitch" | "yolo" | "halftone" | "edges";

/** Output of a pixel effect. `text` is only set by ASCII (the raw character grid,
 *  retained for "Copy as text" — the canvas is a rasterization of it). */
export type EffectResult = {
  imageData: ImageData;
  text?: string;
};

export type PixelEffectFn<P> = (source: ImageData, params: P) => EffectResult;

// ---- Per-mode parameter shapes (defaults live in ../modes.ts) ----

export type AsciiParams = {
  columns: number; // output width in characters
  ramp: "standard" | "detailed" | "minimal";
  colorMode: "mono" | "sampled";
  invert: boolean;
};

export type GlitchParams = {
  rgbShiftPx: number; // per-channel offset
  scanlineOpacity: number; // 0–1
  pixelSortThreshold: number; // 0–1 luminance cutoff for runs
  blockCorruptAmount: number; // 0–1 density of corrupted blocks
  seed: number; // reproducible until re-rolled
};

export type YoloParams = {
  confThreshold: number; // drop detections below this score
  iouThreshold: number; // NMS overlap cutoff
  boxLineWidth: number; // px
  showLabels: boolean;
};

export type HalftoneParams = {
  algorithm: "bayer4x4" | "bayer8x8" | "floydSteinberg" | "dotHalftone";
  cellSize: number; // px grid resolution for dot/bayer modes
  threshold: number; // 0–255
  colorMode: "mono" | "duotone";
};

export type EdgeParams = {
  threshold: number; // 0–255, below this = no edge
  invert: boolean;
  blendWithOriginal: number; // 0–1, 0 = pure edge map
};

/** A single YOLO detection in source-image pixel coordinates (top-left origin). */
export type Detection = {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  classId: number;
  label: string;
};

// ---- Shared helpers used across effects ----

/** Rec. 601 luma, 0–255. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Allocate an ImageData of the same size as `src` (SSR-safe: uses the source's
 *  own constructor path is avoided — callers run client-side only). */
export function blankLike(src: ImageData): ImageData {
  return new ImageData(src.width, src.height);
}

/** Deterministic PRNG (mulberry32) so a glitch `seed` is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
