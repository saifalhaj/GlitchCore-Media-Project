import { CrtParams, EffectResult, blankLike, mulberry32 } from "./types";

/** CRT / VHS analog-TV simulation. Geometry (barrel + vertical roll + tracking
 *  tears) is sampled from the source, then chroma is smeared, a phosphor mask +
 *  scanlines + vignette are applied multiplicatively, and seeded snow is added.
 *  rollSpeed 0 => fully static and deterministic (no Date.now()). */
export function crt(source: ImageData, params: CrtParams): EffectResult {
  const { width: w, height: h } = source;
  const src = source.data;
  const {
    maskType,
    maskDepth,
    chromaBleed,
    scanlineIntensity,
    barrel,
    vignette,
    noise,
    rollSpeed,
    tracking,
    seed,
  } = params;

  // --- time (motion only; deterministic when rollSpeed is 0) ---
  const rollOffset = rollSpeed > 0 ? (Date.now() * 0.06 * rollSpeed) % h : 0;

  // --- tracking tears: a couple of moving bands shift a few rows horizontally ---
  let rowShift: Int16Array | null = null;
  if (tracking > 0) {
    rowShift = new Int16Array(h);
    const trng = mulberry32(
      (seed ^ Math.floor(rollSpeed > 0 ? Date.now() / 80 : 0)) >>> 0
    );
    for (let band = 0; band < 2; band++) {
      const center = Math.floor(trng() * h);
      const thick = 2 + Math.floor(trng() * 6);
      const shift = Math.round((trng() * 2 - 1) * tracking * 40);
      for (let yy = center; yy < center + thick && yy < h; yy++) {
        rowShift[yy] = shift;
      }
    }
  }

  // --- pass 1: geometry sampling -> YCbCr (black outside the curved glass) ---
  const Y = new Float32Array(w * h);
  const Cb = new Float32Array(w * h);
  const Cr = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * 2 - 1;
    const rs = rowShift ? rowShift[y] : 0;
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * 2 - 1;
      const r2 = nx * nx + ny * ny;
      const factor = 1 + barrel * 0.35 * r2;
      const sxb = (nx * factor * 0.5 + 0.5) * w;
      const syb = (ny * factor * 0.5 + 0.5) * h;

      const idx = y * w + x;
      let black = sxb < 0 || sxb >= w || syb < 0 || syb >= h;

      // roll wraps vertically; tracking tears shift horizontally
      let sy = syb + rollOffset;
      sy = ((sy % h) + h) % h;
      const sx = sxb + rs;
      if (sx < 0 || sx >= w) black = true;

      if (black) {
        Cb[idx] = 128;
        Cr[idx] = 128;
        continue; // Y stays 0
      }

      let ix = sx | 0;
      if (ix >= w) ix = w - 1;
      let iy = sy | 0;
      if (iy >= h) iy = h - 1;
      const p = (iy * w + ix) * 4;
      const r = src[p];
      const g = src[p + 1];
      const b = src[p + 2];
      Y[idx] = 0.299 * r + 0.587 * g + 0.114 * b;
      Cb[idx] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
      Cr[idx] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
    }
  }

  // --- chroma bleed: horizontal box-blur Cb/Cr (Y stays sharp) ---
  const rad = Math.round(chromaBleed * 6);
  const CbB = boxBlurH(Cb, w, h, rad);
  const CrB = boxBlurH(Cr, w, h, rad);

  // --- pass 2: reconstruct + phosphor mask + scanlines + vignette + snow ---
  const out = blankLike(source);
  const dst = out.data; // Uint8ClampedArray: assignment clamps/rounds for us
  const noiseRng =
    noise > 0
      ? mulberry32((seed ^ (rollSpeed > 0 ? Math.floor(Date.now() / 33) : 0)) >>> 0)
      : null;
  const DIM = 0.35;

  for (let y = 0; y < h; y++) {
    const ny = (y / h) * 2 - 1;
    const scan = y % 2 === 1 ? 1 - scanlineIntensity : 1;
    const rowDim = y % 3 === 2 ? DIM : 1; // shadow-mask vertical gap
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const yv = Y[idx];
      const cb = CbB[idx] - 128;
      const cr = CrB[idx] - 128;
      let r = yv + 1.402 * cr;
      let g = yv - 0.344136 * cb - 0.714136 * cr;
      let b = yv + 1.772 * cb;

      // phosphor mask (multiplicative, lerp(1, pattern, maskDepth))
      if (maskType !== "none") {
        const c = x % 3;
        let mr: number;
        let mg: number;
        let mb: number;
        if (maskType === "apertureGrille") {
          mr = c === 0 ? 1 : DIM;
          mg = c === 1 ? 1 : DIM;
          mb = c === 2 ? 1 : DIM;
        } else {
          mr = (c === 0 ? 1 : DIM) * rowDim;
          mg = (c === 1 ? 1 : DIM) * rowDim;
          mb = (c === 2 ? 1 : DIM) * rowDim;
        }
        r *= 1 - maskDepth * (1 - mr);
        g *= 1 - maskDepth * (1 - mg);
        b *= 1 - maskDepth * (1 - mb);
      }

      // scanlines
      if (scan !== 1) {
        r *= scan;
        g *= scan;
        b *= scan;
      }

      // vignette (darker at corners)
      if (vignette > 0) {
        const nx = (x / w) * 2 - 1;
        const r2 = nx * nx + ny * ny;
        const m = 1 - vignette * smoothstep(0.25, 1.4, r2);
        r *= m;
        g *= m;
        b *= m;
      }

      // snow
      if (noiseRng && noiseRng() < noise * 0.5) {
        const d = (noiseRng() * 2 - 1) * noise * 120;
        r += d;
        g += d;
        b += d;
      }

      const p = idx * 4;
      dst[p] = r;
      dst[p + 1] = g;
      dst[p + 2] = b;
      dst[p + 3] = 255;
    }
  }

  return { imageData: out };
}

/** Horizontal box blur (edge-clamped, sliding window => O(pixels)). */
function boxBlurH(chan: Float32Array, w: number, h: number, rad: number): Float32Array {
  if (rad <= 0) return chan;
  const win = 2 * rad + 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let sum = 0;
    for (let k = -rad; k <= rad; k++) {
      let xx = k;
      if (xx < 0) xx = 0;
      else if (xx >= w) xx = w - 1;
      sum += chan[base + xx];
    }
    out[base] = sum / win;
    for (let x = 1; x < w; x++) {
      let add = x + rad;
      if (add >= w) add = w - 1;
      let rem = x - rad - 1;
      if (rem < 0) rem = 0;
      sum += chan[base + add] - chan[base + rem];
      out[base + x] = sum / win;
    }
  }
  return out;
}

function smoothstep(e0: number, e1: number, x: number): number {
  let t = (x - e0) / (e1 - e0);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}
