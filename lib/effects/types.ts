// Shared contract for every effect. The four pixel effects are pure, synchronous
// functions `(source, params) => EffectResult`. YOLO is separate (async, returns
// boxes rather than transformed pixels) — see ./yolo.ts.

export type ModeId =
  | "ascii"
  | "glitch"
  | "yolo"
  | "halftone"
  | "edges"
  | "depth"
  | "vision"
  | "falsecolor"
  | "mirror"
  | "pixelate"
  | "crt"
  | "contour"
  | "lowpoly"
  | "words"
  | "slitscan"
  | "trails";

/** Output of a pixel effect. `text` is only set by ASCII (the raw character grid,
 *  retained for "Copy as text" — the canvas is a rasterization of it). */
export type EffectResult = {
  imageData: ImageData;
  text?: string;
};

export type PixelEffectFn<P> = (source: ImageData, params: P) => EffectResult;

/** Temporal effects need recent frames. `history` is oldest→newest raw input
 *  frames (last entry = current); `prevOutput` is this layer's own last output
 *  (feedback). On the still path history has one entry and prevOutput is null,
 *  so temporal effects degrade to identity. */
export type FrameContext = {
  history: ImageData[];
  prevOutput: ImageData | null;
  frameIndex: number;
};
export type TemporalPixelFn<P> = (
  source: ImageData,
  params: P,
  ctx: FrameContext,
) => EffectResult;

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
  // (blending with the original is layer-level now — see Stage.opacity)
};

export type DepthParams = {
  colormap: "grayscale" | "turbo";
  invert: boolean; // swap near/far brightness
};

export type VisionParams = {
  density: number; // target node count
  coreFraction: number; // 0–1, share of nodes that persist with stable IDs
  boxMinPx: number;
  boxMaxPx: number;
  jitter: number; // 0–1, per-frame position wobble
  flickerRate: number; // Hz — bucket rate that reshuffles ephemeral nodes
  connectorCount: number;
  hubCount: number; // hub-and-spoke: how many hubs links fan from
  maxLinkDist: number; // 0–1, fraction of image diagonal
  accentProb: number; // 0–1, chance a node gets a cyan fill / chip
  nodeMarkers: boolean;
  strokeWidth: number;
  anchor: "energy" | "random"; // energy = saliency-anchored nodes
  boxColor: string; // #rrggbb
  lineColor: string;
  accentColor: string;
  lineOpacity: number; // 0–1 (the "pink line" illusion is white at low alpha)
  seed: number;
};

export type FalseColorParams = {
  palette: "ironbow" | "whitehot" | "medical" | "turbo" | "duotone";
  gain: number;
  bias: number; // -0.5–0.5
  levels: number; // 0 = continuous, else quantize into N bands
  invert: boolean;
  shadowColor: string; // duotone low #rrggbb
  highlightColor: string; // duotone high #rrggbb
};

export type MirrorParams = {
  pattern: "kaleido" | "quadMirror" | "mirrorX" | "mirrorY";
  segments: number;
  angle: number; // degrees
  centerX: number; // 0–1
  centerY: number; // 0–1
  zoom: number;
};

export type PixelateParams = {
  blockSize: number; // px
  shape: "square" | "hex" | "circle";
  smooth: boolean; // average (true) vs nearest (false) sampling
  outline: boolean; // draw grid lines between blocks
};

export type CrtParams = {
  maskType: "none" | "apertureGrille" | "shadowMask";
  maskDepth: number; // 0–1 strength of the phosphor mask
  chromaBleed: number; // 0–1 horizontal chroma smear
  scanlineIntensity: number; // 0–1
  barrel: number; // 0–1 curved-glass distortion
  vignette: number; // 0–1
  noise: number; // 0–1 snow
  rollSpeed: number; // vertical roll amount (0 = still)
  tracking: number; // 0–1 tracking-tear amount
  seed: number;
};

export type ContourParams = {
  levels: number; // elevation bands
  smoothing: number; // pre-blur radius (stops video shimmer)
  lineWidth: number; // px
  fill: "none" | "banded" | "source";
  palette: "mono" | "turbo" | "ink" | "terrain";
  invert: boolean;
};

export type LowPolyParams = {
  density: number; // feature-point grid density
  jitter: number; // 0–1 point randomness
  edgeBias: number; // 0–1 bias points toward edges
  cellShape: "triangle" | "voronoi";
  colorSampling: "average" | "centroid";
  outline: number; // 0–2 wireframe width
  seed: number;
};

export type WordsParams = {
  vocabulary: string; // whitespace/comma-separated words to draw from
  source: "vocab" | "numbers" | "lorem";
  columns: number;
  toneMode: "opacity" | "weight"; // brightness → opacity or font-weight
  highlight: string; // #rrggbb for the brightest cells
  highlightThreshold: number; // 0–1
  dissolve: number; // 0–1, drop cells toward the border → transparent
  paper: "cream" | "white" | "dark" | "transparent";
  invert: boolean;
  seed: number;
};

export type SlitScanParams = {
  axis: "rows" | "cols"; // scan across rows (each row = a moment) or columns
  bandHeight: number; // px per time band
  curve: "linear" | "wave" | "centerOut"; // how band index maps to time
  direction: "forward" | "reverse";
  freeze: boolean; // hold the time mapping (stops advancing)
};

export type TrailsParams = {
  persistence: number; // 0–1, how much of the previous frame survives
  mode: "lighten" | "screen" | "onion"; // how the trail composites
  smearPx: number; // directional smear of the feedback each frame
  diffHighlight: boolean; // highlight moving pixels
  tint: string; // #rrggbb for the motion highlight
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
