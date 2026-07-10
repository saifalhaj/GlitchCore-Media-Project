import { turbo } from "../colormap";
import { ContourParams, EffectResult, blankLike, luminance } from "./types";

// Contour / topographic: quantize luma into elevation bands and stroke iso-lines
// between them. Pre-blur the luma so band boundaries don't shimmer on video.

type RGB = [number, number, number];

const INK: RGB = [0x0b, 0x0c, 0x0e]; // near-black line/ink color
const PAPER: RGB = [0xed, 0xeb, 0xe3]; // warm off-white for the ink palette

// Terrain elevation ramp: green lowlands -> tan -> brown -> white peaks.
const TERRAIN_STOPS: RGB[] = [
  [46, 92, 58], // deep green
  [122, 156, 74], // grass
  [204, 184, 120], // tan
  [150, 108, 70], // brown
  [245, 245, 245], // snow
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function terrain(t: number): RGB {
  const n = TERRAIN_STOPS.length - 1;
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const c0 = TERRAIN_STOPS[i];
  const c1 = TERRAIN_STOPS[i + 1];
  return [
    Math.round(lerp(c0[0], c1[0], f)),
    Math.round(lerp(c0[1], c1[1], f)),
    Math.round(lerp(c0[2], c1[2], f)),
  ];
}

export function contour(source: ImageData, params: ContourParams): EffectResult {
  const { width: w, height: h, data: src } = source;
  const out = blankLike(source);
  const dst = out.data;
  const n = w * h;

  const levels = Math.max(2, Math.floor(params.levels));
  const lineWidth = Math.max(1, Math.floor(params.lineWidth));
  const radius = Math.max(0, Math.round(params.smoothing));
  const { fill, palette, invert } = params;

  // 1. Luma buffer.
  const raw = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    raw[i] = luminance(src[p], src[p + 1], src[p + 2]);
  }

  // 2. Separable box blur (H then V) to kill band-edge shimmer.
  const luma = radius > 0 ? boxBlur(raw, w, h, radius) : raw;

  // 3. Quantize into bands.
  const band = new Int16Array(n);
  const maxBand = levels - 1;
  for (let i = 0; i < n; i++) {
    let t = luma[i] / 255;
    t = t < 0 ? 0 : t > 0.999 ? 0.999 : t;
    let b = Math.floor(t * levels);
    if (b > maxBand) b = maxBand; // paranoia guard
    band[i] = invert ? maxBand - b : b;
  }

  // 4. Iso-lines: mark where band differs from right/bottom neighbor, then dilate.
  const line = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = band[i];
      const isEdge =
        (x + 1 < w && band[i + 1] !== b) ||
        (y + 1 < h && band[i + w] !== b);
      if (isEdge) line[i] = 1;
    }
  }
  const dilated = lineWidth > 1 ? dilate(line, w, h, lineWidth - 1) : line;

  // Palette line color: ink uses dark ink on paper; everything else dark lines.
  // (Terrain snow peaks are bright, so dark lines stay visible there too.)
  const lineColor: RGB = INK;

  // 5. Compose.
  const inkPaper = palette === "ink";
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let r: number;
    let g: number;
    let bl: number;

    if (dilated[i]) {
      [r, g, bl] = lineColor;
    } else {
      const b = band[i];
      const t = maxBand > 0 ? b / maxBand : 0;
      if (fill === "source") {
        r = src[p];
        g = src[p + 1];
        bl = src[p + 2];
      } else if (fill === "banded") {
        [r, g, bl] = bandColor(palette, t);
      } else {
        // "none": black background, or paper for ink.
        if (inkPaper) [r, g, bl] = PAPER;
        else r = g = bl = 0;
      }
    }

    dst[p] = r;
    dst[p + 1] = g;
    dst[p + 2] = bl;
    dst[p + 3] = 255;
  }

  return { imageData: out };
}

function bandColor(palette: ContourParams["palette"], t: number): RGB {
  switch (palette) {
    case "turbo":
      return turbo(t);
    case "terrain":
      return terrain(t);
    case "ink":
      return PAPER; // ink fill is flat paper; lines carry the topography
    case "mono":
    default: {
      const v = Math.round(t * 255);
      return [v, v, v];
    }
  }
}

// Separable box blur over a Float32 luma plane. Edge-clamped, two passes.
function boxBlur(
  buf: Float32Array,
  w: number,
  h: number,
  radius: number
): Float32Array {
  const tmp = new Float32Array(buf.length);
  const out = new Float32Array(buf.length);
  const win = radius * 2 + 1;

  // Horizontal.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      sum += buf[row + clampi(k, 0, w - 1)];
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = clampi(x + radius + 1, 0, w - 1);
      const sub = clampi(x - radius, 0, w - 1);
      sum += buf[row + add] - buf[row + sub];
    }
  }

  // Vertical.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      sum += tmp[clampi(k, 0, h - 1) * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = clampi(y + radius + 1, 0, h - 1);
      const sub = clampi(y - radius, 0, h - 1);
      sum += tmp[add * w + x] - tmp[sub * w + x];
    }
  }

  return out;
}

// Dilate a binary mask by `r` pixels (Chebyshev), separable min-style max.
function dilate(
  mask: Uint8Array,
  w: number,
  h: number,
  r: number
): Uint8Array {
  let cur = mask;
  // Horizontal then vertical passes, r each — cheap approximation of a box dilate.
  const hPass = new Uint8Array(cur.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let k = -r; k <= r && !on; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w && cur[row + xx]) on = 1;
      }
      hPass[row + x] = on;
    }
  }
  const vPass = new Uint8Array(cur.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let on = 0;
      for (let k = -r; k <= r && !on; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && hPass[yy * w + x]) on = 1;
      }
      vPass[y * w + x] = on;
    }
  }
  return vPass;
}

function clampi(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
