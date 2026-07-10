import {
  type HalftoneParams,
  type EffectResult,
  luminance,
  blankLike,
} from "./types";
import { hexToRgb } from "../color";
import { buildCoverage } from "../mask";

type RGB = [number, number, number];

const SHADOW: RGB = [0x1b, 0x2a, 0x4a]; // "#1b2a4a"
const HIGHLIGHT: RGB = [0x3e, 0x6f, 0xd9]; // "#3e6fd9"

// Standard 4x4 Bayer matrix.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// 8x8 derived from the 4x4 recurrence: B_{2n}(x,y) = 4*B_n(x%n,y%n) + B2(x/n,y/n).
const BAYER8 = (() => {
  const B2 = [
    [0, 2],
    [3, 1],
  ];
  const m: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      m[y][x] = 4 * BAYER4[y % 4][x % 4] + B2[(y / 4) | 0][(x / 4) | 0];
    }
  }
  return m;
})();

export function halftone(source: ImageData, params: HalftoneParams): EffectResult {
  const W = source.width;
  const H = source.height;
  const out = blankLike(source);
  const dst = out.data;
  const src = source.data;

  const cell = Math.max(1, Math.floor(params.cellSize));
  const Wb = Math.ceil(W / cell);
  const Hb = Math.ceil(H / cell);
  const duotone = params.colorMode === "duotone";

  // blockLum[by*Wb + bx] = average luminance of that block.
  const blockLum = new Float32Array(Wb * Hb);
  for (let by = 0; by < Hb; by++) {
    const y0 = by * cell;
    const y1 = Math.min(y0 + cell, H);
    for (let bx = 0; bx < Wb; bx++) {
      const x0 = bx * cell;
      const x1 = Math.min(x0 + cell, W);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * W + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          sum += luminance(src[i], src[i + 1], src[i + 2]);
          count++;
        }
      }
      blockLum[by * Wb + bx] = count > 0 ? sum / count : 0;
    }
  }

  // Mono uses the user's ink/paper (defaults reproduce the original colors);
  // duotone keeps its fixed shadow/highlight pair.
  const paperColor: RGB = duotone ? HIGHLIGHT : hexToRgb(params.paperColor);
  const inkColor: RGB = duotone ? SHADOW : hexToRgb(params.inkColor);

  const fillBlock = (bx: number, by: number, c: RGB) => {
    const x0 = bx * cell;
    const x1 = Math.min(x0 + cell, W);
    const y0 = by * cell;
    const y1 = Math.min(y0 + cell, H);
    for (let y = y0; y < y1; y++) {
      let i = (y * W + x0) * 4;
      for (let x = x0; x < x1; x++, i += 4) {
        dst[i] = c[0];
        dst[i + 1] = c[1];
        dst[i + 2] = c[2];
        dst[i + 3] = 255;
      }
    }
  };

  if (params.algorithm === "bayer4x4" || params.algorithm === "bayer8x8") {
    const bayer = params.algorithm === "bayer4x4" ? BAYER4 : BAYER8;
    const n = bayer.length;
    const bias = 128 - params.threshold;
    for (let by = 0; by < Hb; by++) {
      for (let bx = 0; bx < Wb; bx++) {
        const t = ((bayer[bx % n][by % n] + 0.5) / (n * n)) * 255;
        // "on" => paper (ink off); "off" => ink.
        const on = blockLum[by * Wb + bx] + bias > t;
        fillBlock(bx, by, on ? paperColor : inkColor);
      }
    }
  } else if (params.algorithm === "floydSteinberg") {
    const buf = Float32Array.from(blockLum);
    const on = new Uint8Array(Wb * Hb);
    for (let by = 0; by < Hb; by++) {
      for (let bx = 0; bx < Wb; bx++) {
        const idx = by * Wb + bx;
        const old = buf[idx];
        const nv = old >= params.threshold ? 255 : 0;
        on[idx] = nv === 255 ? 1 : 0;
        const err = old - nv;
        if (bx + 1 < Wb) buf[idx + 1] += (err * 7) / 16;
        if (by + 1 < Hb) {
          if (bx - 1 >= 0) buf[idx + Wb - 1] += (err * 3) / 16;
          buf[idx + Wb] += (err * 5) / 16;
          if (bx + 1 < Wb) buf[idx + Wb + 1] += (err * 1) / 16;
        }
      }
    }
    for (let by = 0; by < Hb; by++) {
      for (let bx = 0; bx < Wb; bx++) {
        // light (on) => paper, dark (off) => ink.
        fillBlock(bx, by, on[by * Wb + bx] ? paperColor : inkColor);
      }
    }
  } else {
    // dotHalftone: filled circle per block on paper background; radius ∝ darkness.
    const bg: RGB = paperColor;
    const maxR = (cell / 2) * Math.SQRT2;
    // paint background first
    for (let by = 0; by < Hb; by++)
      for (let bx = 0; bx < Wb; bx++) fillBlock(bx, by, bg);

    for (let by = 0; by < Hb; by++) {
      for (let bx = 0; bx < Wb; bx++) {
        const lum = blockLum[by * Wb + bx];
        let r = (1 - lum / 255) * (cell / 2) * 1.35;
        if (r > maxR) r = maxR;
        if (r <= 0) continue;
        // dot color: ink (mono) or lerp shadow->highlight by darkness (duotone).
        let dot: RGB = inkColor;
        if (duotone) {
          const dk = 1 - lum / 255; // 1 = darkest
          dot = [
            SHADOW[0] + (HIGHLIGHT[0] - SHADOW[0]) * (1 - dk),
            SHADOW[1] + (HIGHLIGHT[1] - SHADOW[1]) * (1 - dk),
            SHADOW[2] + (HIGHLIGHT[2] - SHADOW[2]) * (1 - dk),
          ];
        }
        const cx = bx * cell + cell / 2;
        const cy = by * cell + cell / 2;
        const r2 = r * r;
        // ponytail: manual pixel disc, no canvas 2D ctx — no antialias but zero setup cost.
        const y0 = Math.max(0, Math.floor(cy - r));
        const y1 = Math.min(H - 1, Math.ceil(cy + r));
        const x0 = Math.max(0, Math.floor(cx - r));
        const x1 = Math.min(W - 1, Math.ceil(cx + r));
        for (let y = y0; y <= y1; y++) {
          const dy = y + 0.5 - cy;
          for (let x = x0; x <= x1; x++) {
            const dx = x + 0.5 - cx;
            if (dx * dx + dy * dy <= r2) {
              const i = (y * W + x) * 4;
              dst[i] = dot[0];
              dst[i + 1] = dot[1];
              dst[i + 2] = dot[2];
              dst[i + 3] = 255;
            }
          }
        }
      }
    }
  }

  // Editorial dissolve: fade ink toward paper (or drop paper to transparent)
  // by a coverage field. Off by default so existing output is unchanged.
  const dissolve = params.dissolve ?? 0;
  if (dissolve > 0) {
    const cov = buildCoverage(source, {
      source: params.dissolveSource ?? "radial",
      amount: dissolve,
      falloff: 1.6,
    });
    const [pr, pg, pb] = paperColor;
    for (let i = 0; i < cov.length; i++) {
      const c = cov[i];
      const p = i * 4;
      if (params.paperTransparent) {
        const isPaper =
          Math.abs(dst[p] - pr) < 10 && Math.abs(dst[p + 1] - pg) < 10 && Math.abs(dst[p + 2] - pb) < 10;
        dst[p + 3] = isPaper ? 0 : Math.round(c * 255);
      } else {
        dst[p] = Math.round(pr + (dst[p] - pr) * c);
        dst[p + 1] = Math.round(pg + (dst[p + 1] - pg) * c);
        dst[p + 2] = Math.round(pb + (dst[p + 2] - pb) * c);
      }
    }
  }

  return { imageData: out };
}
