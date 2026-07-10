// Coverage / dissolve primitive. Returns a per-pixel keep-factor in [0,1]
// (0 = drop → fade to paper / transparent, 1 = keep). Effects multiply their
// per-mark alpha (or lerp toward paper) by this — the "editorial dissolve" where
// dots/words/ink thin out toward the edges, a subject, or the shadows.

import { luminance } from "./effects/types";

export type CoverageSource = "none" | "luminance" | "radial" | "subject";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function buildCoverage(
  src: ImageData,
  opts: {
    source: CoverageSource;
    amount: number; // 0 = no dissolve, 1 = full
    falloff: number; // curve hardness (>1 = harder edge)
    subjectMask?: Float32Array; // for source "subject"
  },
): Float32Array {
  const w = src.width;
  const h = src.height;
  const n = w * h;
  const out = new Float32Array(n);

  const amount = clamp01(opts.amount);
  if (amount <= 0 || opts.source === "none") {
    out.fill(1);
    return out;
  }
  const falloff = Math.max(0.1, opts.falloff);
  const shape = (f: number) => 1 - amount * (1 - Math.pow(clamp01(f), falloff));

  if (opts.source === "subject" && opts.subjectMask && opts.subjectMask.length === n) {
    for (let i = 0; i < n; i++) out[i] = shape(opts.subjectMask[i]);
    return out;
  }

  if (opts.source === "luminance") {
    const d = src.data;
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      out[i] = shape(luminance(d[p], d[p + 1], d[p + 2]) / 255);
    }
    return out;
  }

  // radial: 1 at the center, dropping toward the corners.
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxD = Math.hypot(cx, cy) || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x - cx, y - cy) / maxD;
      out[y * w + x] = shape(1 - dist);
    }
  }
  return out;
}
