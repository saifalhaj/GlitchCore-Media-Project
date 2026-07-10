// FALSECOLOR — map luminance through a thermal/duotone ramp. Single O(pixels)
// pass: luminance -> gain/bias/invert/quantize -> palette lookup. Pure & sync.

import { hexToRgb } from "../color";
import { turbo } from "../colormap";
import { blankLike, luminance, type EffectResult, type FalseColorParams } from "./types";

type RGB = [number, number, number];
type Stop = [number, RGB];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Piecewise-linear color ramp: interpolate `stops` (sorted by pos) at t in [0,1]. */
function ramp(stops: Stop[], t: number): RGB {
  t = clamp01(t);
  if (t <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (t <= p1) {
      const [p0, c0] = stops[i - 1];
      const span = p1 - p0;
      const f = span > 0 ? (t - p0) / span : 0;
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return last[1];
}

// black -> deep purple -> magenta/red -> orange -> yellow -> white
const IRONBOW: Stop[] = [
  [0, [0, 0, 4]],
  [0.25, [59, 15, 112]],
  [0.5, [190, 45, 95]],
  [0.7, [249, 122, 9]],
  [0.85, [249, 231, 33]],
  [1, [255, 255, 255]],
];

// blue -> cyan -> green -> yellow -> red -> white rainbow thermal
const MEDICAL: Stop[] = [
  [0, [0, 0, 60]],
  [0.2, [0, 60, 220]],
  [0.4, [0, 200, 200]],
  [0.55, [0, 200, 40]],
  [0.7, [230, 230, 0]],
  [0.88, [220, 30, 20]],
  [1, [255, 255, 255]],
];

export function falsecolor(source: ImageData, params: FalseColorParams): EffectResult {
  const { width, height } = source;
  const src = source.data;
  const out = blankLike(source);
  const dst = out.data;

  const gain = params.gain;
  const bias = params.bias;
  const invert = params.invert;
  // levels === 1 (or <2) means "off" — guard the (levels-1) divide.
  const quantize = params.levels >= 2;
  const levelDiv = params.levels - 1;

  // Duotone endpoints resolved once (hexToRgb normalizes/guards bad hex).
  const shadow = hexToRgb(params.shadowColor);
  const highlight = hexToRgb(params.highlightColor);
  const palette = params.palette;

  const n = width * height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const l = luminance(src[p], src[p + 1], src[p + 2]) / 255;
    let t = clamp01(l * gain + bias);
    if (invert) t = 1 - t;
    if (quantize) t = Math.round(t * levelDiv) / levelDiv;

    let rgb: RGB;
    switch (palette) {
      case "turbo":
        rgb = turbo(t);
        break;
      case "whitehot": {
        const v = t * 255;
        rgb = [v, v, v];
        break;
      }
      case "ironbow":
        rgb = ramp(IRONBOW, t);
        break;
      case "medical":
        rgb = ramp(MEDICAL, t);
        break;
      case "duotone":
        rgb = [
          shadow[0] + (highlight[0] - shadow[0]) * t,
          shadow[1] + (highlight[1] - shadow[1]) * t,
          shadow[2] + (highlight[2] - shadow[2]) * t,
        ];
        break;
    }

    dst[p] = rgb[0];
    dst[p + 1] = rgb[1];
    dst[p + 2] = rgb[2];
    dst[p + 3] = 255;
  }

  return { imageData: out };
}
