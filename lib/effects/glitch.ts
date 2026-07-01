import {
  EffectResult,
  GlitchParams,
  luminance,
  mulberry32,
} from "./types";

/** Glitchcore (spec 4.2): datamosh stack on a copy of the pixel buffer.
 *  All randomness comes from mulberry32(seed) so a seed is reproducible. */
export function glitch(source: ImageData, params: GlitchParams): EffectResult {
  const { width: w, height: h } = source;
  const src = source.data;
  const out = new Uint8ClampedArray(src); // working copy

  // Guard: all-zero params => identity (spec 4.2). Without this the threshold-0
  // pixel sort would reorder every row even at "off".
  if (
    params.rgbShiftPx === 0 &&
    params.scanlineOpacity === 0 &&
    params.pixelSortThreshold === 0 &&
    params.blockCorruptAmount === 0
  ) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return { imageData: new ImageData(out, w, h) };
  }

  const rand = mulberry32(params.seed);

  // 1. RGB shift: R from (x+shift), B from (x-shift), G unchanged.
  const shift = Math.round(params.rgbShiftPx);
  if (shift !== 0) {
    const shifted = new Uint8ClampedArray(out); // read source, write out
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4;
        const rx = Math.min(w - 1, Math.max(0, x + shift));
        const bx = Math.min(w - 1, Math.max(0, x - shift));
        out[i] = shifted[(row + rx) * 4]; // R
        out[i + 2] = shifted[(row + bx) * 4 + 2]; // B
      }
    }
  }

  // 2. Pixel sort per row: runs where luminance > threshold*255, sort ascending.
  const cutoff = params.pixelSortThreshold * 255;
  if (params.pixelSortThreshold < 1) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let x = 0;
      while (x < w) {
        if (lumAt(out, (row + x) * 4) > cutoff) {
          let end = x;
          while (end < w && lumAt(out, (row + end) * 4) > cutoff) end++;
          sortRun(out, row + x, end - x);
          x = end;
        } else {
          x++;
        }
      }
    }
  }

  // 3. Block corruption.
  if (params.blockCorruptAmount > 0) {
    const blockSize = Math.max(4, Math.floor(Math.min(w, h) / 24));
    const area = w * h;
    const count = Math.floor(
      params.blockCorruptAmount * (area / (blockSize * blockSize))
    );
    for (let n = 0; n < count; n++) {
      const bx = Math.floor(rand() * Math.max(1, w - blockSize));
      const by = Math.floor(rand() * Math.max(1, h - blockSize));
      const bw = Math.min(blockSize, w - bx);
      const bh = Math.min(blockSize, h - by);
      if (rand() < 0.5) {
        // horizontal shift of the block
        const off = 1 + Math.floor(rand() * blockSize);
        for (let yy = by; yy < by + bh; yy++) {
          const rowBase = yy * w;
          const rowCopy = new Uint8ClampedArray(bw * 4);
          for (let k = 0; k < bw; k++) {
            const srcX = bx + ((k + off) % bw);
            const s = (rowBase + srcX) * 4;
            const d = k * 4;
            rowCopy[d] = out[s];
            rowCopy[d + 1] = out[s + 1];
            rowCopy[d + 2] = out[s + 2];
            rowCopy[d + 3] = out[s + 3];
          }
          for (let k = 0; k < bw; k++) {
            const d = (rowBase + bx + k) * 4;
            const c = k * 4;
            out[d] = rowCopy[c];
            out[d + 1] = rowCopy[c + 1];
            out[d + 2] = rowCopy[c + 2];
            out[d + 3] = rowCopy[c + 3];
          }
        }
      } else {
        // bit-crush (quantize) colors
        for (let yy = by; yy < by + bh; yy++) {
          const rowBase = yy * w;
          for (let xx = bx; xx < bx + bw; xx++) {
            const i = (rowBase + xx) * 4;
            out[i] = out[i] & 0xe0;
            out[i + 1] = out[i + 1] & 0xe0;
            out[i + 2] = out[i + 2] & 0xe0;
          }
        }
      }
    }
  }

  // 4. Scanlines: darken every 2nd row toward black.
  const alpha = params.scanlineOpacity;
  if (alpha > 0) {
    const keep = 1 - alpha;
    for (let y = 0; y < h; y += 2) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4;
        out[i] = out[i] * keep;
        out[i + 1] = out[i + 1] * keep;
        out[i + 2] = out[i + 2] * keep;
      }
    }
  }

  // Force opaque.
  for (let i = 3; i < out.length; i += 4) out[i] = 255;

  return { imageData: new ImageData(out, w, h) };
}

function lumAt(data: Uint8ClampedArray, i: number): number {
  return luminance(data[i], data[i + 1], data[i + 2]);
}

/** In-place insertion sort of `len` RGBA pixels starting at pixel index `start`,
 *  ordered by ascending luminance.
 *  ponytail: insertion sort — runs are short (row-local); swap for a keyed
 *  merge sort only if very wide bright runs show up as a hotspot. */
function sortRun(data: Uint8ClampedArray, start: number, len: number): void {
  if (len < 2) return;
  const px: number[] = [];
  const lums: number[] = [];
  for (let k = 0; k < len; k++) {
    const i = (start + k) * 4;
    px.push((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]);
    lums.push(luminance(data[i], data[i + 1], data[i + 2]));
  }
  for (let a = 1; a < len; a++) {
    const pv = px[a];
    const lv = lums[a];
    let b = a - 1;
    while (b >= 0 && lums[b] > lv) {
      px[b + 1] = px[b];
      lums[b + 1] = lums[b];
      b--;
    }
    px[b + 1] = pv;
    lums[b + 1] = lv;
  }
  for (let k = 0; k < len; k++) {
    const i = (start + k) * 4;
    const v = px[k];
    data[i] = (v >>> 24) & 0xff;
    data[i + 1] = (v >>> 16) & 0xff;
    data[i + 2] = (v >>> 8) & 0xff;
    data[i + 3] = v & 0xff;
  }
}
