import { EdgeParams, EffectResult, blankLike, luminance } from "./types";

// Edge Map (spec 4.5): Sobel operator with edge-replicate borders.
export function edges(source: ImageData, params: EdgeParams): EffectResult {
  const { width: w, height: h, data: src } = source;
  const out = blankLike(source);
  const dst = out.data;
  const { threshold, invert, blendWithOriginal: b } = params;

  // Precompute grayscale (luminance) buffer.
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luminance(src[p], src[p + 1], src[p + 2]);
  }

  const clamp = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);
  const sample = (x: number, y: number) =>
    gray[clamp(y, h - 1) * w + clamp(x, w - 1)];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const tc = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const ml = sample(x - 1, y);
      const mr = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const bc = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      let mag = Math.sqrt(gx * gx + gy * gy);
      if (mag > 255) mag = 255;

      const e = mag > threshold ? 255 : 0;
      const edgeV = invert ? 255 - e : e;

      const p = (y * w + x) * 4;
      // Lerp edge map toward original per channel (b=1 => original).
      dst[p] = Math.round(edgeV + (src[p] - edgeV) * b);
      dst[p + 1] = Math.round(edgeV + (src[p + 1] - edgeV) * b);
      dst[p + 2] = Math.round(edgeV + (src[p + 2] - edgeV) * b);
      dst[p + 3] = 255;
    }
  }

  return { imageData: out };
}
