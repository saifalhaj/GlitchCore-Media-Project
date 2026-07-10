import { ascii } from "./effects/ascii";
import { glitch } from "./effects/glitch";
import { halftone } from "./effects/halftone";
import { edges } from "./effects/edges";
import { vision } from "./effects/vision";
import { falsecolor } from "./effects/falsecolor";
import { mirror } from "./effects/mirror";
import { pixelate } from "./effects/pixelate";
import { crt } from "./effects/crt";
import { contour } from "./effects/contour";
import { lowpoly } from "./effects/lowpoly";
import { words } from "./effects/words";
import { slitscan } from "./effects/slitscan";
import { trails } from "./effects/trails";
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
  CrtParams,
  ContourParams,
  LowPolyParams,
  WordsParams,
  SlitScanParams,
  TrailsParams,
  FrameContext,
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
  | { kind: "color"; key: string; label: string }
  | { kind: "text"; key: string; label: string; placeholder?: string; maxLen?: number };

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
  "crt",
  "contour",
  "lowpoly",
  "words",
  "slitscan",
  "trails",
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

  crt: {
    id: "crt",
    name: "CRT / VHS",
    tagline: "Analog TV death: phosphor mask, chroma bleed, curved glass, rolling tracking error, snow.",
    color: "var(--mode-crt)",
    controls: [
      {
        kind: "select",
        key: "maskType",
        label: "Phosphor mask",
        options: [
          { value: "none", label: "None" },
          { value: "apertureGrille", label: "Aperture grille" },
          { value: "shadowMask", label: "Shadow mask" },
        ],
      },
      { kind: "slider", key: "maskDepth", label: "Mask depth", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "chromaBleed", label: "Chroma bleed", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "scanlineIntensity", label: "Scanlines", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "barrel", label: "Barrel", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "noise", label: "Snow", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "rollSpeed", label: "Roll", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "tracking", label: "Tracking", min: 0, max: 1, step: 0.01 },
      { kind: "seed", key: "seed", label: "Seed" },
    ],
    defaults: {
      maskType: "apertureGrille",
      maskDepth: 0.5,
      chromaBleed: 0.4,
      scanlineIntensity: 0.35,
      barrel: 0.25,
      vignette: 0.4,
      noise: 0.08,
      rollSpeed: 0,
      tracking: 0.1,
      seed: 1337,
    },
  },

  contour: {
    id: "contour",
    name: "Contour",
    tagline: "Luminance quantized into elevation bands, boundaries traced as iso-lines.",
    color: "var(--mode-contour)",
    controls: [
      { kind: "slider", key: "levels", label: "Bands", min: 2, max: 24, step: 1 },
      { kind: "slider", key: "smoothing", label: "Smoothing", min: 0, max: 4, step: 1, unit: "px" },
      { kind: "slider", key: "lineWidth", label: "Line width", min: 1, max: 4, step: 1, unit: "px" },
      {
        kind: "select",
        key: "fill",
        label: "Fill",
        options: [
          { value: "none", label: "Lines only" },
          { value: "banded", label: "Banded" },
          { value: "source", label: "Over source" },
        ],
      },
      {
        kind: "select",
        key: "palette",
        label: "Palette",
        options: [
          { value: "mono", label: "Mono" },
          { value: "turbo", label: "Turbo" },
          { value: "ink", label: "Ink" },
          { value: "terrain", label: "Terrain" },
        ],
      },
      { kind: "toggle", key: "invert", label: "Invert" },
    ],
    defaults: {
      levels: 8,
      smoothing: 1,
      lineWidth: 1,
      fill: "banded",
      palette: "terrain",
      invert: false,
    },
  },

  lowpoly: {
    id: "lowpoly",
    name: "Low-poly",
    tagline: "Shatters the image into flat-shaded triangles or Voronoi cells snapped to its own edges.",
    color: "var(--mode-lowpoly)",
    controls: [
      { kind: "slider", key: "density", label: "Density", min: 6, max: 60, step: 1 },
      { kind: "slider", key: "jitter", label: "Jitter", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "edgeBias", label: "Edge bias", min: 0, max: 1, step: 0.01 },
      {
        kind: "select",
        key: "cellShape",
        label: "Cells",
        options: [
          { value: "triangle", label: "Triangles" },
          { value: "voronoi", label: "Voronoi" },
        ],
      },
      {
        kind: "select",
        key: "colorSampling",
        label: "Color",
        options: [
          { value: "average", label: "Average" },
          { value: "centroid", label: "Centroid" },
        ],
      },
      { kind: "slider", key: "outline", label: "Wireframe", min: 0, max: 2, step: 1, unit: "px" },
      { kind: "seed", key: "seed", label: "Seed" },
    ],
    defaults: {
      density: 18,
      jitter: 0.7,
      edgeBias: 0.6,
      cellShape: "triangle",
      colorSampling: "average",
      outline: 0,
      seed: 1337,
    },
  },

  words: {
    id: "words",
    name: "Word raster",
    tagline: "Semantic ASCII — the image as a grid of whole words, toned by opacity, dissolving at the edges.",
    color: "var(--mode-words)",
    controls: [
      { kind: "text", key: "vocabulary", label: "Words", placeholder: "space or comma separated", maxLen: 200 },
      {
        kind: "select",
        key: "source",
        label: "Source",
        options: [
          { value: "vocab", label: "Your words" },
          { value: "numbers", label: "Numbers" },
          { value: "lorem", label: "Lorem" },
        ],
      },
      { kind: "slider", key: "columns", label: "Columns", min: 12, max: 72, step: 1, unit: "w" },
      {
        kind: "select",
        key: "toneMode",
        label: "Tone",
        options: [
          { value: "opacity", label: "Opacity" },
          { value: "weight", label: "Weight" },
        ],
      },
      { kind: "color", key: "highlight", label: "Highlight" },
      { kind: "slider", key: "highlightThreshold", label: "Highlight at", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "dissolve", label: "Edge dissolve", min: 0, max: 1, step: 0.01 },
      {
        kind: "select",
        key: "paper",
        label: "Paper",
        options: [
          { value: "cream", label: "Cream" },
          { value: "white", label: "White" },
          { value: "dark", label: "Dark" },
          { value: "transparent", label: "Transparent" },
        ],
      },
      { kind: "toggle", key: "invert", label: "Invert" },
      { kind: "seed", key: "seed", label: "Seed" },
    ],
    defaults: {
      vocabulary: "workspace memory context model reason token weight signal",
      source: "vocab",
      columns: 28,
      toneMode: "opacity",
      highlight: "#e0603a",
      highlightThreshold: 0.72,
      dissolve: 0.6,
      paper: "cream",
      invert: false,
      seed: 1337,
    },
  },

  slitscan: {
    id: "slitscan",
    name: "Slit-scan",
    tagline: "Every row is a different moment — motion smears across time. Video only.",
    color: "var(--mode-slitscan)",
    controls: [
      {
        kind: "select",
        key: "axis",
        label: "Axis",
        options: [
          { value: "rows", label: "Rows" },
          { value: "cols", label: "Columns" },
        ],
      },
      { kind: "slider", key: "bandHeight", label: "Band", min: 1, max: 40, step: 1, unit: "px" },
      {
        kind: "select",
        key: "curve",
        label: "Curve",
        options: [
          { value: "linear", label: "Linear" },
          { value: "wave", label: "Wave" },
          { value: "centerOut", label: "Center-out" },
        ],
      },
      {
        kind: "select",
        key: "direction",
        label: "Direction",
        options: [
          { value: "forward", label: "Forward" },
          { value: "reverse", label: "Reverse" },
        ],
      },
      { kind: "toggle", key: "freeze", label: "Freeze" },
    ],
    defaults: { axis: "rows", bandHeight: 2, curve: "linear", direction: "forward", freeze: false },
  },

  trails: {
    id: "trails",
    name: "Trails",
    tagline: "Feedback echo and datamosh smear — each frame decays into the next. Video only.",
    color: "var(--mode-trails)",
    controls: [
      { kind: "slider", key: "persistence", label: "Persistence", min: 0, max: 1, step: 0.01 },
      {
        kind: "select",
        key: "mode",
        label: "Trail blend",
        options: [
          { value: "lighten", label: "Lighten" },
          { value: "screen", label: "Screen" },
          { value: "onion", label: "Onion-skin" },
        ],
      },
      { kind: "slider", key: "smearPx", label: "Smear", min: 0, max: 20, step: 1, unit: "px" },
      { kind: "toggle", key: "diffHighlight", label: "Motion highlight" },
      { kind: "color", key: "tint", label: "Motion tint" },
    ],
    defaults: { persistence: 0.85, mode: "lighten", smearPx: 0, diffHighlight: false, tint: "#ff2a6d" },
  },
};

/** Dispatch a synchronous, stateless pixel effect. Model modes (yolo/depth) and
 *  temporal modes (slitscan/trails) are handled elsewhere. */
export function runPixelEffect(
  mode: PixelMode,
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
    case "crt":
      return crt(source, params as unknown as CrtParams);
    case "contour":
      return contour(source, params as unknown as ContourParams);
    case "lowpoly":
      return lowpoly(source, params as unknown as LowPolyParams);
    case "words":
      return words(source, params as unknown as WordsParams);
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
  | "pixelate"
  | "crt"
  | "contour"
  | "lowpoly"
  | "words";
export const PIXEL_MODES: PixelMode[] = [
  "ascii",
  "glitch",
  "halftone",
  "edges",
  "vision",
  "falsecolor",
  "mirror",
  "pixelate",
  "crt",
  "contour",
  "lowpoly",
  "words",
];
export function isPixelMode(m: ModeId): m is PixelMode {
  return (PIXEL_MODES as string[]).includes(m);
}

export type TemporalMode = "slitscan" | "trails";
export const TEMPORAL_MODES: TemporalMode[] = ["slitscan", "trails"];
export function isTemporalMode(m: ModeId): m is TemporalMode {
  return (TEMPORAL_MODES as string[]).includes(m);
}

/** Dispatch a temporal effect (needs a FrameContext). Degrades to identity when
 *  history is empty / prevOutput is null (the still path). */
export function runTemporalEffect(
  mode: TemporalMode,
  source: ImageData,
  params: Params,
  ctx: FrameContext,
): EffectResult {
  switch (mode) {
    case "slitscan":
      return slitscan(source, params as unknown as SlitScanParams, ctx);
    case "trails":
      return trails(source, params as unknown as TrailsParams, ctx);
  }
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

/** Per-frame chain for live video. Pixel stages run stateless; temporal stages
 *  get a FrameContext (shared input history + their own feedback via prevOut);
 *  model stages (YOLO/Depth) are skipped — far too slow per frame. */
export type VideoContext = {
  history: ImageData[]; // oldest→newest raw input frames
  prevOut: Map<string, ImageData>; // per-stage-id last output (feedback)
  frameIndex: number;
};

export function runVideoChain(
  source: ImageData,
  stages: Stage[],
  vctx: VideoContext,
): EffectResult {
  let acc = source;
  let text: string | undefined;
  for (const s of stages) {
    let r: EffectResult;
    if (isPixelMode(s.mode)) {
      r = runPixelEffect(s.mode, acc, s.params);
    } else if (isTemporalMode(s.mode)) {
      r = runTemporalEffect(s.mode, acc, s.params, {
        history: vctx.history,
        prevOutput: vctx.prevOut.get(s.id) ?? null,
        frameIndex: vctx.frameIndex,
      });
      vctx.prevOut.set(s.id, r.imageData); // feedback for next frame
    } else {
      continue; // model stage — skipped on video
    }
    acc = blendImageData(r.imageData, acc, s.opacity ?? 1, s.blend ?? "normal");
    if (s.mode === "ascii" || s.mode === "words") text = r.text;
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
  crt: { ...MODES.crt.defaults },
  contour: { ...MODES.contour.defaults },
  lowpoly: { ...MODES.lowpoly.defaults },
  words: { ...MODES.words.defaults },
  slitscan: { ...MODES.slitscan.defaults },
  trails: { ...MODES.trails.defaults },
};
