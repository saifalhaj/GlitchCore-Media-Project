import { ascii } from "./effects/ascii";
import { glitch } from "./effects/glitch";
import { halftone } from "./effects/halftone";
import { edges } from "./effects/edges";
import { vision } from "./effects/vision";
import { falsecolor } from "./effects/falsecolor";
import { mirror } from "./effects/mirror";
import { pixelate } from "./effects/pixelate";
import { blendImageData, type BlendMode } from "./image";
import type {
  EffectResult,
  ModeId,
  AsciiParams,
  GlitchParams,
  HalftoneParams,
  EdgeParams,
  VisionParams,
  FalseColorParams,
  MirrorParams,
  PixelateParams,
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
  | { kind: "seed"; key: string; label: string }
  | { kind: "color"; key: string; label: string };

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
  "vision",
  "yolo",
  "halftone",
  "falsecolor",
  "edges",
  "depth",
  "mirror",
  "pixelate",
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

  vision: {
    id: "vision",
    name: "Vision",
    tagline: "Fake real-time detection HUD — boxes, tracked IDs, and connectors. Runs live on video where real detection can't.",
    color: "var(--mode-vision)",
    controls: [
      { kind: "slider", key: "density", label: "Node density", min: 5, max: 120, step: 1 },
      { kind: "slider", key: "coreFraction", label: "Tracked core", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "boxMinPx", label: "Box min", min: 4, max: 60, step: 1, unit: "px" },
      { kind: "slider", key: "boxMaxPx", label: "Box max", min: 20, max: 260, step: 1, unit: "px" },
      { kind: "slider", key: "jitter", label: "Jitter", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "flickerRate", label: "Flicker", min: 0, max: 30, step: 1, unit: "Hz" },
      { kind: "slider", key: "connectorCount", label: "Connectors", min: 0, max: 80, step: 1 },
      { kind: "slider", key: "hubCount", label: "Hubs", min: 0, max: 8, step: 1 },
      { kind: "slider", key: "maxLinkDist", label: "Link reach", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "accentProb", label: "Accents", min: 0, max: 1, step: 0.01 },
      { kind: "toggle", key: "nodeMarkers", label: "Node markers" },
      { kind: "slider", key: "strokeWidth", label: "Stroke", min: 1, max: 4, step: 1, unit: "px" },
      {
        kind: "select",
        key: "anchor",
        label: "Anchor",
        options: [
          { value: "energy", label: "Energy (sticks to detail)" },
          { value: "random", label: "Random" },
        ],
      },
      { kind: "color", key: "boxColor", label: "Box color" },
      { kind: "color", key: "lineColor", label: "Line color" },
      { kind: "color", key: "accentColor", label: "Accent color" },
      { kind: "slider", key: "lineOpacity", label: "Line opacity", min: 0, max: 1, step: 0.01 },
      { kind: "seed", key: "seed", label: "Seed" },
    ],
    defaults: {
      density: 44,
      coreFraction: 0.35,
      boxMinPx: 14,
      boxMaxPx: 130,
      jitter: 0.35,
      flickerRate: 10,
      connectorCount: 26,
      hubCount: 2,
      maxLinkDist: 0.55,
      accentProb: 0.14,
      nodeMarkers: false,
      strokeWidth: 1,
      anchor: "energy",
      boxColor: "#4be3d0",
      lineColor: "#ffffff",
      accentColor: "#4be3d0",
      lineOpacity: 0.5,
      seed: 1337,
    },
  },

  falsecolor: {
    id: "falsecolor",
    name: "False-color",
    tagline: "Luminance mapped through a thermal or duotone ramp — predator vision and single-ink looks.",
    color: "var(--mode-falsecolor)",
    controls: [
      {
        kind: "select",
        key: "palette",
        label: "Palette",
        options: [
          { value: "ironbow", label: "Ironbow" },
          { value: "whitehot", label: "White-hot" },
          { value: "medical", label: "Medical" },
          { value: "turbo", label: "Turbo" },
          { value: "duotone", label: "Duotone" },
        ],
      },
      { kind: "slider", key: "gain", label: "Gain", min: 0.2, max: 3, step: 0.05 },
      { kind: "slider", key: "bias", label: "Bias", min: -0.5, max: 0.5, step: 0.01 },
      { kind: "slider", key: "levels", label: "Bands", min: 0, max: 16, step: 1 },
      { kind: "toggle", key: "invert", label: "Invert" },
      { kind: "color", key: "shadowColor", label: "Duotone shadow" },
      { kind: "color", key: "highlightColor", label: "Duotone highlight" },
    ],
    defaults: {
      palette: "ironbow",
      gain: 1.4,
      bias: 0,
      levels: 0,
      invert: false,
      shadowColor: "#06122e",
      highlightColor: "#5ec8ff",
    },
  },

  mirror: {
    id: "mirror",
    name: "Kaleidoscope",
    tagline: "Fold any frame into mirror and rotational symmetry.",
    color: "var(--mode-mirror)",
    controls: [
      {
        kind: "select",
        key: "pattern",
        label: "Pattern",
        options: [
          { value: "kaleido", label: "Kaleidoscope" },
          { value: "quadMirror", label: "Quad mirror" },
          { value: "mirrorX", label: "Mirror X" },
          { value: "mirrorY", label: "Mirror Y" },
        ],
      },
      { kind: "slider", key: "segments", label: "Segments", min: 2, max: 24, step: 1 },
      { kind: "slider", key: "angle", label: "Angle", min: 0, max: 360, step: 1, unit: "°" },
      { kind: "slider", key: "centerX", label: "Center X", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "centerY", label: "Center Y", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "zoom", label: "Zoom", min: 0.5, max: 3, step: 0.05 },
    ],
    defaults: {
      pattern: "kaleido",
      segments: 8,
      angle: 0,
      centerX: 0.5,
      centerY: 0.5,
      zoom: 1.3,
    },
  },

  pixelate: {
    id: "pixelate",
    name: "Pixelate",
    tagline: "Block-average mosaic — the classic censor / vaporwave pixelation.",
    color: "var(--mode-pixelate)",
    controls: [
      { kind: "slider", key: "blockSize", label: "Block size", min: 2, max: 64, step: 1, unit: "px" },
      {
        kind: "select",
        key: "shape",
        label: "Shape",
        options: [
          { value: "square", label: "Square" },
          { value: "hex", label: "Hex" },
          { value: "circle", label: "Circle / dot" },
        ],
      },
      { kind: "toggle", key: "smooth", label: "Smooth" },
      { kind: "toggle", key: "outline", label: "Grid lines" },
    ],
    defaults: { blockSize: 12, shape: "square", smooth: false, outline: false },
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
    case "vision":
      return vision(source, params as unknown as VisionParams);
    case "falsecolor":
      return falsecolor(source, params as unknown as FalseColorParams);
    case "mirror":
      return mirror(source, params as unknown as MirrorParams);
    case "pixelate":
      return pixelate(source, params as unknown as PixelateParams);
  }
}

export type PixelMode =
  | "ascii"
  | "glitch"
  | "halftone"
  | "edges"
  | "vision"
  | "falsecolor"
  | "mirror"
  | "pixelate";
export const PIXEL_MODES: PixelMode[] = [
  "ascii",
  "glitch",
  "halftone",
  "edges",
  "vision",
  "falsecolor",
  "mirror",
  "pixelate",
];
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
  vision: { ...MODES.vision.defaults },
  falsecolor: { ...MODES.falsecolor.defaults },
  mirror: { ...MODES.mirror.defaults },
  pixelate: { ...MODES.pixelate.defaults },
};
