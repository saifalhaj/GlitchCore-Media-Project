import { ascii } from "./effects/ascii";
import { glitch } from "./effects/glitch";
import { halftone } from "./effects/halftone";
import { edges } from "./effects/edges";
import { blendImageData, type BlendMode } from "./image";
import type {
  EffectResult,
  ModeId,
  AsciiParams,
  GlitchParams,
  HalftoneParams,
  EdgeParams,
} from "./effects/types";

// UI control descriptors — ParamPanel renders these generically per active mode.
export type Control =
  | {
      kind: "slider";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | {
      kind: "select";
      key: string;
      label: string;
      options: { value: string; label: string }[];
    }
  | { kind: "toggle"; key: string; label: string }
  | { kind: "seed"; key: string; label: string };

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export type ModeDef = {
  id: ModeId;
  name: string;
  tagline: string;
  color: string; // active accent (CSS)
  color2?: string; // secondary accent, where a mode owns a pair (glitch)
  controls: Control[];
  defaults: Params;
};

export const MODE_ORDER: ModeId[] = [
  "ascii",
  "glitch",
  "yolo",
  "halftone",
  "edges",
  "depth",
];

export const MODES: Record<ModeId, ModeDef> = {
  ascii: {
    id: "ascii",
    name: "ASCII",
    tagline: "Luminance mapped to a character ramp on a sampled grid.",
    color: "var(--mode-ascii)",
    controls: [
      { kind: "slider", key: "columns", label: "Columns", min: 20, max: 240, step: 2, unit: "ch" },
      {
        kind: "select",
        key: "ramp",
        label: "Ramp",
        options: [
          { value: "standard", label: "Standard" },
          { value: "detailed", label: "Detailed" },
          { value: "minimal", label: "Minimal" },
        ],
      },
      {
        kind: "select",
        key: "colorMode",
        label: "Color",
        options: [
          { value: "mono", label: "Mono" },
          { value: "sampled", label: "Sampled" },
        ],
      },
      { kind: "toggle", key: "invert", label: "Invert" },
    ],
    defaults: { columns: 120, ramp: "standard", colorMode: "mono", invert: false },
  },

  glitch: {
    id: "glitch",
    name: "Glitchcore",
    tagline: "Stacked datamosh: RGB shift, scanlines, pixel sort, block corruption.",
    color: "var(--mode-glitch)",
    color2: "var(--mode-glitch-2)",
    controls: [
      { kind: "slider", key: "rgbShiftPx", label: "RGB shift", min: 0, max: 40, step: 1, unit: "px" },
      { kind: "slider", key: "scanlineOpacity", label: "Scanlines", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "pixelSortThreshold", label: "Pixel sort", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "blockCorruptAmount", label: "Block corrupt", min: 0, max: 1, step: 0.01 },
      { kind: "seed", key: "seed", label: "Seed" },
    ],
    defaults: {
      rgbShiftPx: 6,
      scanlineOpacity: 0.15,
      pixelSortThreshold: 0.6,
      blockCorruptAmount: 0.2,
      seed: 1337,
    },
  },

  yolo: {
    id: "yolo",
    name: "YOLO",
    tagline: "Real object detection (YOLO11n) — runs entirely in your browser.",
    color: "var(--mode-yolo)",
    controls: [
      { kind: "slider", key: "confThreshold", label: "Confidence", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "iouThreshold", label: "NMS IoU", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "boxLineWidth", label: "Box width", min: 1, max: 6, step: 1, unit: "px" },
      { kind: "toggle", key: "showLabels", label: "Labels" },
    ],
    defaults: { confThreshold: 0.4, iouThreshold: 0.45, boxLineWidth: 2, showLabels: true },
  },

  halftone: {
    id: "halftone",
    name: "Halftone",
    tagline: "Ordered / error-diffusion dithering and true dot halftone.",
    color: "var(--mode-halftone)",
    controls: [
      {
        kind: "select",
        key: "algorithm",
        label: "Algorithm",
        options: [
          { value: "bayer4x4", label: "Bayer 4×4" },
          { value: "bayer8x8", label: "Bayer 8×8" },
          { value: "floydSteinberg", label: "Floyd–Steinberg" },
          { value: "dotHalftone", label: "Dot halftone" },
        ],
      },
      { kind: "slider", key: "cellSize", label: "Cell size", min: 2, max: 24, step: 1, unit: "px" },
      { kind: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1 },
      {
        kind: "select",
        key: "colorMode",
        label: "Color",
        options: [
          { value: "mono", label: "Mono" },
          { value: "duotone", label: "Duotone" },
        ],
      },
    ],
    defaults: { algorithm: "bayer8x8", cellSize: 8, threshold: 128, colorMode: "mono" },
  },

  edges: {
    id: "edges",
    name: "Edge Map",
    tagline: "Sobel gradient magnitude — line art from the source.",
    color: "var(--mode-edge)",
    controls: [
      { kind: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1 },
      { kind: "toggle", key: "invert", label: "Invert" },
    ],
    defaults: { threshold: 80, invert: false },
  },

  depth: {
    id: "depth",
    name: "Depth",
    tagline: "Monocular depth (Depth-Anything V2) — near is bright, in your browser.",
    color: "var(--mode-depth)",
    controls: [
      {
        kind: "select",
        key: "colormap",
        label: "Colormap",
        options: [
          { value: "turbo", label: "Turbo" },
          { value: "grayscale", label: "Grayscale" },
        ],
      },
      { kind: "toggle", key: "invert", label: "Invert" },
    ],
    defaults: { colormap: "turbo", invert: false },
  },
};

/** Dispatch a synchronous pixel effect. YOLO (detection) and Depth (async model
 *  inference) are handled specially in components/CanvasStage.tsx. */
export function runPixelEffect(
  mode: Exclude<ModeId, "yolo" | "depth">,
  source: ImageData,
  params: Params,
): EffectResult {
  switch (mode) {
    case "ascii":
      return ascii(source, params as unknown as AsciiParams);
    case "glitch":
      return glitch(source, params as unknown as GlitchParams);
    case "halftone":
      return halftone(source, params as unknown as HalftoneParams);
    case "edges":
      return edges(source, params as unknown as EdgeParams);
  }
}

export type PixelMode = "ascii" | "glitch" | "halftone" | "edges";
export const PIXEL_MODES: PixelMode[] = ["ascii", "glitch", "halftone", "edges"];
export function isPixelMode(m: ModeId): m is PixelMode {
  return (PIXEL_MODES as string[]).includes(m);
}

/** One layer of the effect stack. `opacity` and `blend` are layer-level (not
 *  effect params): opacity 1 + normal = the effect replaces the frame; lower
 *  opacity or multiply/screen composite it over the layer's input. */
export type Stage = {
  id: string;
  mode: ModeId;
  params: Params;
  opacity: number;
  blend: BlendMode;
};

export function makeStage(mode: ModeId): Stage {
  return {
    id: crypto.randomUUID(),
    mode,
    params: { ...MODES[mode].defaults },
    opacity: 1,
    blend: "normal",
  };
}

/** Run only the synchronous pixel stages of a chain — used for live video, where
 *  per-frame model inference (YOLO/Depth) would be far too slow. Model stages
 *  pass through unchanged. */
export function runPixelChain(source: ImageData, stages: Stage[]): EffectResult {
  let acc = source;
  let text: string | undefined;
  for (const s of stages) {
    if (!isPixelMode(s.mode)) continue;
    const r = runPixelEffect(s.mode, acc, s.params);
    acc = blendImageData(r.imageData, acc, s.opacity ?? 1, s.blend ?? "normal");
    if (s.mode === "ascii") text = r.text;
  }
  return { imageData: acc, text };
}

export const DEFAULT_PARAMS: Record<ModeId, Params> = {
  ascii: { ...MODES.ascii.defaults },
  glitch: { ...MODES.glitch.defaults },
  yolo: { ...MODES.yolo.defaults },
  halftone: { ...MODES.halftone.defaults },
  edges: { ...MODES.edges.defaults },
  depth: { ...MODES.depth.defaults },
};
