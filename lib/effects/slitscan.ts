// SLIT-SCAN: each band of the frame is sampled from a different moment in the
// input history, so moving subjects smear across time. See SlitScanParams and
// FrameContext in ./types.ts. Pure + synchronous; runs per frame on video.

import type { EffectResult, FrameContext, SlitScanParams } from "./types";
import { blankLike } from "./types";

export function slitscan(
  source: ImageData,
  params: SlitScanParams,
  ctx: FrameContext,
): EffectResult {
  const N = ctx.history.length;
  // Still path (or single frame): no time to work with → identity.
  if (N <= 1) return { imageData: source };

  const { width: w, height: h } = source;
  const out = blankLike(source);
  const dst = out.data;
  const bh = Math.max(1, Math.round(params.bandHeight));
  const reverse = params.direction === "reverse";
  const off = params.freeze ? 0 : (ctx.frameIndex % N) / N;

  // Map a band index k of B bands to a history frame index.
  const frameFor = (k: number, B: number): number => {
    let t: number;
    switch (params.curve) {
      case "wave":
        t = 0.5 + 0.5 * Math.sin(k * 0.35);
        break;
      case "centerOut": {
        const c = (B - 1) / 2;
        t = c <= 0 ? 0 : Math.abs(k - c) / c;
        break;
      }
      default: // linear
        t = B <= 1 ? 0 : k / (B - 1);
    }
    if (reverse) t = 1 - t;
    t = (t + off) % 1;
    return Math.min(N - 1, Math.max(0, Math.round(t * (N - 1))));
  };

  if (params.axis === "rows") {
    const B = Math.ceil(h / bh);
    for (let k = 0; k < B; k++) {
      const fr = ctx.history[frameFor(k, B)].data;
      const y0 = k * bh;
      const y1 = Math.min(h, y0 + bh);
      // Contiguous row span — copy with typed-array set() in one shot.
      const start = y0 * w * 4;
      const end = y1 * w * 4;
      dst.set(fr.subarray(start, end), start);
    }
    // Force opaque (source alpha may vary; bands were copied wholesale).
    for (let i = 3; i < dst.length; i += 4) dst[i] = 255;
  } else {
    // cols: bands are vertical columns; copy per pixel (non-contiguous).
    const B = Math.ceil(w / bh);
    for (let k = 0; k < B; k++) {
      const fr = ctx.history[frameFor(k, B)].data;
      const x0 = k * bh;
      const x1 = Math.min(w, x0 + bh);
      for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = x0; x < x1; x++) {
          const i = row + x * 4;
          dst[i] = fr[i];
          dst[i + 1] = fr[i + 1];
          dst[i + 2] = fr[i + 2];
          dst[i + 3] = 255;
        }
      }
    }
  }

  return { imageData: out };
}
