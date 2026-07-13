import type { EffectResult, WordsParams } from "./types";
import { luminance, mulberry32 } from "./types";
import { hexToRgb, rgbToHex } from "../color";

// Fork of ascii.ts: same block-average luminance sampler + offscreen-canvas
// rasterization, but each cell renders a whole WORD instead of one glyph.
// Brightness never changes WHICH word shows — only its ink (opacity / weight /
// highlight) and whether an edge cell dissolves away.
//
// The effect can also be confined to a region (a geometric half, or one subject)
// via `applyTo`; everywhere else shows a chosen background so the wordified
// element stays the clear focus. A precise subject uses an RMBG matte passed in
// as `mask` (still-image path); otherwise a cheap saliency approximation runs
// (works live on video).

const DEFAULT_VOCAB = [
  "signal",
  "noise",
  "echo",
  "drift",
  "pulse",
  "static",
  "fragment",
  "memory",
  "trace",
];

// Matte alpha above this counts a pixel/cell as "inside the subject" — one source
// of truth shared by the region test, the accent sampler, and the text export.
const MATTE_INCLUDE = 0.4;
// Crash guards for extreme aspect ratios: bound the fillText count and the raster
// area so a very tall/wide crop can't hang or OOM the tab.
const MAX_RASTER_CELLS = 130_000;
const MAX_RASTER_AREA = 16_000_000; // ~16 MP

// 30 latin words for the "lorem" source.
const LOREM = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing",
  "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore",
  "et", "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis",
  "nostrud", "exercitation", "ullamco", "laboris", "nisi", "aliquip",
];

const PAPER = {
  cream: { bg: "#efe9dc", ink: "#1a1712" },
  white: { bg: "#ffffff", ink: "#14140f" },
  dark: { bg: "#0b0c0e", ink: "#edebe3" },
} as const;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Build the word pool. Never empty (falls back to DEFAULT_VOCAB). */
function buildPool(params: WordsParams, rng: () => number): string[] {
  if (params.source === "lorem") return LOREM;
  if (params.source === "numbers") {
    const out: string[] = [];
    for (let i = 0; i < 64; i++) {
      const digits = 2 + Math.floor(rng() * 3); // 2..4 digits
      const max = Math.pow(10, digits);
      out.push(String(Math.floor(rng() * max)).padStart(digits, "0"));
    }
    return out;
  }
  const words = params.vocabulary
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  return words.length > 0 ? words : DEFAULT_VOCAB;
}

/** Fit `word` into `maxW` px: shrink the font toward `minSize`, then drop
 *  trailing chars if still too wide. Sets ctx.font as a side effect; returns the
 *  text to draw. */
function fitWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  maxW: number,
  weight: number,
  baseSize: number,
  minSize: number,
): string {
  ctx.font = `${weight} ${baseSize}px ui-monospace, monospace`;
  let w = ctx.measureText(word).width;
  if (w > maxW) {
    const size = Math.max(minSize, Math.floor(baseSize * (maxW / w)));
    ctx.font = `${weight} ${size}px ui-monospace, monospace`;
    w = ctx.measureText(word).width;
  }
  // ponytail: char-drop loop is O(word length); fine for modest words.
  let text = word;
  while (w > maxW && text.length > 1) {
    text = text.slice(0, -1);
    w = ctx.measureText(text).width;
  }
  return text;
}

/** Cheap per-cell saliency (edge/texture energy, centre-biased) → which cells
 *  belong to "the main element". Model-free, so it runs live on video. Returns a
 *  Uint8Array over the cols×rows grid (1 = subject). */
function saliencyCells(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  cols: number,
  rows: number,
  cutoff: number,
): Uint8Array {
  const detail = new Float32Array(cols * rows);
  let maxD = 1e-6;
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * sh) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * sh) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * sw) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * sw) / cols));
      let g = 0;
      let m = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1 - 1; x += 2) {
          const i = (y * sw + x) * 4;
          const l = luminance(src[i], src[i + 1], src[i + 2]);
          const l2 = luminance(src[i + 4], src[i + 5], src[i + 6]);
          g += Math.abs(l - l2);
          m++;
        }
      }
      const cxn = (cx + 0.5) / cols - 0.5;
      const cyn = (cy + 0.5) / rows - 0.5;
      const centre = Math.max(0, 1 - Math.hypot(cxn, cyn) * 1.6);
      const d = (m > 0 ? g / m : 0) * (0.4 + 0.6 * centre);
      detail[cy * cols + cx] = d;
      if (d > maxD) maxD = d;
    }
  }
  const total = cols * rows;
  const cells = new Uint8Array(total);
  let count = 0;
  for (let i = 0; i < total; i++) {
    if (detail[i] / maxD >= cutoff) {
      cells[i] = 1;
      count++;
    }
  }
  // Never yield a near-empty region: if a high cutoff selected too little, keep
  // the top ~15% most-salient cells instead so the subject always has a body.
  const floor = Math.max(1, Math.round(total * 0.08));
  if (count < floor) {
    const order = Array.from({ length: total }, (_, i) => i).sort(
      (a, b) => detail[b] - detail[a],
    );
    const keep = Math.min(total, Math.round(total * 0.15));
    cells.fill(0);
    for (let k = 0; k < keep; k++) cells[order[k]] = 1;
  }
  return cells;
}

function hue(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const c = mx - Math.min(r, g, b);
  if (c === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / c) % 6;
  else if (mx === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
const clamp255 = (v: number) => Math.round(Math.max(0, Math.min(255, v)));

/** Sample a representative accent colour from the wordified region — the DOMINANT
 *  hue (a saturation×value-weighted histogram vote), not a plain average, so a
 *  mixed-colour subject picks its signature colour instead of averaging to mud.
 *  Falls back to a saturation-weighted mean on near-monochrome regions. */
function computeAccent(
  source: ImageData,
  applyTo: string,
  split: number,
  mask?: Float32Array,
  cells?: Uint8Array | null,
  cols?: number,
  rows?: number,
): string | null {
  const sw = source.width;
  const sh = source.height;
  const d = source.data;
  const hasMask = !!mask && mask.length === sw * sh;
  const inTest = (x: number, y: number, i: number): boolean => {
    switch (applyTo) {
      case "subject":
        if (hasMask) return mask![i] > MATTE_INCLUDE;
        if (cells && cols && rows) {
          const cx = Math.min(cols - 1, Math.floor((x * cols) / sw));
          const cy = Math.min(rows - 1, Math.floor((y * rows) / sh));
          return cells[cy * cols + cx] === 1;
        }
        return true;
      case "left":
        return x < split * sw;
      case "right":
        return x >= split * sw;
      case "top":
        return y < split * sh;
      case "bottom":
        return y >= split * sh;
      default:
        return true;
    }
  };

  const BINS = 24;
  const binW = new Float32Array(BINS);
  const binR = new Float32Array(BINS);
  const binG = new Float32Array(BINS);
  const binB = new Float32Array(BINS);
  // Fallback (near-monochrome regions): saturation-weighted mean, as before.
  let mR = 0;
  let mG = 0;
  let mB = 0;
  let mW = 0;

  for (let y = 0; y < sh; y += 3) {
    for (let x = 0; x < sw; x += 3) {
      const i = y * sw + x;
      if (!inTest(x, y, i)) continue;
      const p = i * 4;
      const r = d[p];
      const g = d[p + 1];
      const b = d[p + 2];
      const mx = Math.max(r, g, b);
      const sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
      const val = mx / 255;
      const fw = sat * sat + 0.02;
      mR += r * fw;
      mG += g * fw;
      mB += b * fw;
      mW += fw;
      if (sat < 0.15 || val < 0.1) continue; // ignore greys/blacks for the hue vote
      const bin = Math.min(BINS - 1, Math.floor(hue(r, g, b) / (360 / BINS)));
      const w = sat * val;
      binW[bin] += w;
      binR[bin] += r * w;
      binG[bin] += g * w;
      binB[bin] += b * w;
    }
  }

  let peak = -1;
  let peakW = 0;
  for (let b = 0; b < BINS; b++) {
    if (binW[b] > peakW) {
      peakW = binW[b];
      peak = b;
    }
  }

  if (peak < 0) {
    // No vivid pixels → keep old behaviour (mean) or the user's highlight.
    if (mW <= 0) return null;
    const mean = (mR + mG + mB) / (3 * mW);
    const ch = (v: number) => clamp255(mean + (v / mW - mean) * 1.5);
    return rgbToHex(ch(mR), ch(mG), ch(mB));
  }

  // Average the peak hue bin plus its two neighbours (wrapping).
  let R = 0;
  let G = 0;
  let B = 0;
  let W = 0;
  for (const bin of [(peak + BINS - 1) % BINS, peak, (peak + 1) % BINS]) {
    R += binR[bin];
    G += binG[bin];
    B += binB[bin];
    W += binW[bin];
  }
  let r = R / W;
  let g = G / W;
  let b = B / W;
  // Punch up saturation, and lift value so the accent stays legible on paper.
  const mean = (r + g + b) / 3;
  const boost = 1.55;
  r = mean + (r - mean) * boost;
  g = mean + (g - mean) * boost;
  b = mean + (b - mean) * boost;
  const mx = Math.max(r, g, b);
  if (mx > 0 && mx < 150) {
    const lift = 150 / mx;
    r *= lift;
    g *= lift;
    b *= lift;
  }
  return rgbToHex(clamp255(r), clamp255(g), clamp255(b));
}

export function words(
  source: ImageData,
  params: WordsParams,
  mask?: Float32Array,
): EffectResult {
  const sw = source.width;
  const sh = source.height;
  const src = source.data;

  const cols = Math.max(1, Math.round(params.columns));
  const cellW = sw / cols;
  // Landscape word cells (a word is wider than tall) → many short rows.
  let rows = Math.max(1, Math.round((2 * sh) / cellW));
  // Guard: an extreme aspect ratio makes rows (and the fillText count) explode.
  if (cols * rows > MAX_RASTER_CELLS) rows = Math.max(1, Math.floor(MAX_RASTER_CELLS / cols));

  const seed = params.seed >>> 0;
  const pool = buildPool(params, mulberry32(seed));
  const threshold = clamp01(params.highlightThreshold);
  const dissolve = clamp01(params.dissolve);
  const paper = params.paper === "transparent" ? null : PAPER[params.paper];
  const ink = paper ? paper.ink : params.invert ? "#0b0c0e" : "#edebe3";

  const applyTo = params.applyTo ?? "whole";
  const split = clamp01(params.splitAt ?? 0.5);
  const bgMode = params.background ?? "keep";
  const hasMask = !!mask && mask.length === sw * sh;
  const splitCol = Math.round(split * cols);
  const splitRow = Math.round(split * rows);
  // Fast (model-free) subject cells — computed once and reused for the accent,
  // the clip mask, and the text export so they all agree on the element.
  const fastCells =
    applyTo === "subject" && !hasMask
      ? saliencyCells(src, sw, sh, cols, rows, split)
      : null;

  // Which grid cells fall inside the wordified region. For a precise (soft) matte
  // the visible edge is sub-cell, so ink is still drawn for every cell and the
  // matte clip trims it — but the text export samples the matte at the cell centre.
  const cellInRegion = (rx: number, ry: number): boolean => {
    switch (applyTo) {
      case "left":
        return rx < splitCol;
      case "right":
        return rx >= splitCol;
      case "top":
        return ry < splitRow;
      case "bottom":
        return ry >= splitRow;
      case "subject":
        if (hasMask) {
          const px = Math.min(sw - 1, Math.floor(((rx + 0.5) * sw) / cols));
          const py = Math.min(sh - 1, Math.floor(((ry + 0.5) * sh) / rows));
          return mask![py * sw + px] > MATTE_INCLUDE;
        }
        return fastCells ? fastCells[ry * cols + rx] === 1 : true;
      default:
        return true;
    }
  };
  // Cell-based regions (halves, fast subject) can skip ink for out-of-region
  // cells; a soft matte keeps them so the clipped silhouette edge stays clean.
  const skipOutOfRegion = applyTo !== "whole" && !(applyTo === "subject" && hasMask);

  // Highlight colour: user-chosen, or sampled from the element itself.
  let highlight = rgbToHex(...hexToRgb(params.highlight));
  if (params.autoColor) {
    const accent = computeAccent(source, applyTo, split, mask, fastCells, cols, rows);
    if (accent) highlight = accent;
  }

  // Output: preserve source aspect so the (possibly transparent) layer composites
  // cleanly over the original. Cell width is capped for perf on video.
  let cellPxW = Math.min(110, Math.max(18, Math.round(1600 / cols)));
  let canvasW = cols * cellPxW;
  let canvasH = Math.max(1, Math.round((canvasW * sh) / sw));
  // Guard: cap the raster area (preserving aspect) so a huge crop can't OOM.
  if (canvasW * canvasH > MAX_RASTER_AREA) {
    const s = Math.sqrt(MAX_RASTER_AREA / (canvasW * canvasH));
    canvasW = Math.max(cols, Math.round(canvasW * s));
    canvasH = Math.max(1, Math.round(canvasH * s));
  }
  cellPxW = canvasW / cols; // may be fractional after the area clamp — fine on canvas
  const cellPxH = canvasH / rows;

  // --- 1. Render the FULL word raster onto its own canvas. -------------------
  const wordCanvas = document.createElement("canvas");
  wordCanvas.width = canvasW;
  wordCanvas.height = canvasH;
  const ctx = wordCanvas.getContext("2d", { willReadFrequently: true })!;
  if (paper) {
    ctx.fillStyle = paper.bg;
    ctx.fillRect(0, 0, canvasW, canvasH); // opaque paper
  }
  // transparent paper: leave the canvas cleared (alpha 0) between words.

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const baseSize = Math.max(9, Math.round(cellPxH * 0.72));
  const minSize = Math.max(8, Math.round(cellPxH * 0.4));
  const maxTextW = cellPxW - 3;

  const textRows: string[] = new Array(rows);

  for (let ry = 0; ry < rows; ry++) {
    const rowWords: string[] = new Array(cols);
    const y0 = Math.floor((ry * sh) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * sh) / rows));
    const nyEdge = Math.min((ry + 0.5) / rows, 1 - (ry + 0.5) / rows) * 2;

    for (let rx = 0; rx < cols; rx++) {
      const inR = cellInRegion(rx, ry);
      if (!inR && skipOutOfRegion) {
        rowWords[rx] = ""; // out of a cell-based region → not drawn, not in text
        continue;
      }
      const x0 = Math.floor((rx * sw) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * sw) / cols));

      let sumL = 0;
      let sumMask = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let idx = (y * sw + x0) * 4;
        let pi = y * sw + x0;
        for (let x = x0; x < x1; x++) {
          sumL += luminance(src[idx], src[idx + 1], src[idx + 2]);
          if (hasMask) sumMask += mask![pi];
          n++;
          idx += 4;
          pi++;
        }
      }
      const raw = clamp01(sumL / n / 255);
      const norm = params.invert ? 1 - raw : raw;
      // Precise matte: mean silhouette coverage of this cell drives the edge fade
      // and the text export, so boundary words dissolve instead of hard-cutting.
      const coverage = hasMask ? sumMask / n : 1;

      // Per-cell deterministic stream (word choice is brightness-independent).
      const rng = mulberry32(
        (seed ^ Math.imul(rx, 0x9e3779b1) ^ Math.imul(ry, 0x85ebca77)) >>> 0,
      );
      const r0 = rng();
      const dropRoll = rng();
      // Region → word. "bands": ordered vocabulary maps top→bottom. "luminance":
      // brightness picks the word (dark→first … bright→last). "mix": random.
      let word: string;
      if (params.regionMode === "bands") {
        const band = Math.min(pool.length - 1, Math.floor((ry / rows) * pool.length));
        word = pool[band];
      } else if (params.regionMode === "luminance") {
        word = pool[Math.min(pool.length - 1, Math.floor(raw * pool.length))];
      } else {
        word = pool[Math.min(pool.length - 1, Math.floor(r0 * pool.length))];
      }
      // Text matches ink: include a precise-matte cell wherever its edge alpha is
      // nonzero (coverage > 0.15, the smoothstep floor below), so the exported
      // words are exactly the ones visibly rendered along the silhouette.
      const include = hasMask ? coverage > 0.15 : inR;
      rowWords[rx] = include ? word : "";

      if (hasMask && coverage < 0.06) continue; // essentially outside the silhouette

      const nxEdge = Math.min((rx + 0.5) / cols, 1 - (rx + 0.5) / cols) * 2;
      const edgeDist = Math.min(nxEdge, nyEdge);
      if (dropRoll < dissolve * (1 - edgeDist)) continue; // dissolve → skip ink

      const weight =
        params.toneMode === "weight" ? 300 + Math.round(norm * 5) * 100 : 500;
      let alpha = params.toneMode === "opacity" ? 0.3 + 0.7 * norm : 1;
      if (hasMask) {
        // smoothstep 0.15→0.85 coverage: edge words fade rather than get cut
        const t = coverage <= 0.15 ? 0 : coverage >= 0.85 ? 1 : (coverage - 0.15) / 0.7;
        alpha *= t * t * (3 - 2 * t);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = norm >= threshold ? highlight : ink;
      const text = fitWord(ctx, word, maxTextW, weight, baseSize, minSize);
      ctx.fillText(text, rx * cellPxW + cellPxW / 2, ry * cellPxH + cellPxH / 2);
    }
    textRows[ry] = rowWords.join(" ");
  }
  ctx.globalAlpha = 1;
  const text = textRows.join("\n");

  // --- 2. Whole image → the word raster is the result. -----------------------
  if (applyTo === "whole") {
    return { imageData: ctx.getImageData(0, 0, canvasW, canvasH), text };
  }

  // --- 3. Region: paint a background, then draw the word raster clipped to the
  //        region (rectangular half, precise matte, or fast saliency). --------
  const out = document.createElement("canvas");
  out.width = canvasW;
  out.height = canvasH;
  const octx = out.getContext("2d", { willReadFrequently: true })!;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  srcCanvas.getContext("2d")!.putImageData(source, 0, 0);

  // Background treatment outside the wordified region.
  if (bgMode === "keep" || bgMode === "fade") {
    octx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, canvasW, canvasH);
    if (bgMode === "fade") {
      // Radial wash toward paper: lighter near the element, deeper at the corners
      // — adds depth-of-field focus without re-exposing the busy background.
      const fade = clamp01(params.bgFade ?? 0.66);
      const [pr, pg, pb] = hexToRgb(paper ? paper.bg : "#f1ede4");
      let fx = canvasW / 2;
      let fy = canvasH / 2;
      if (applyTo === "subject" && hasMask) {
        let ax = 0;
        let ay = 0;
        let aw = 0;
        for (let i = 0; i < sw * sh; i += 7) {
          const a = mask![i];
          if (a > MATTE_INCLUDE) {
            ax += (i % sw) * a;
            ay += ((i / sw) | 0) * a;
            aw += a;
          }
        }
        if (aw > 0) {
          fx = ((ax / aw) * canvasW) / sw;
          fy = ((ay / aw) * canvasH) / sh;
        }
      } else if (applyTo === "subject" && fastCells) {
        let ax = 0;
        let ay = 0;
        let c = 0;
        for (let cy = 0; cy < rows; cy++)
          for (let cx = 0; cx < cols; cx++)
            if (fastCells[cy * cols + cx]) {
              ax += cx;
              ay += cy;
              c++;
            }
        if (c > 0) {
          fx = ((ax / c + 0.5) / cols) * canvasW;
          fy = ((ay / c + 0.5) / rows) * canvasH;
        }
      } else {
        // geometric half (or a subject with no mask/cells) → rect centre
        const rx0 = applyTo === "right" ? splitCol * cellPxW : 0;
        const rx1 = applyTo === "left" ? splitCol * cellPxW : canvasW;
        const ry0 = applyTo === "bottom" ? splitRow * cellPxH : 0;
        const ry1 = applyTo === "top" ? splitRow * cellPxH : canvasH;
        fx = (rx0 + rx1) / 2;
        fy = (ry0 + ry1) / 2;
      }
      const rOut = Math.hypot(Math.max(fx, canvasW - fx), Math.max(fy, canvasH - fy)) || 1;
      const grad = octx.createRadialGradient(fx, fy, 0, fx, fy, rOut);
      grad.addColorStop(0, `rgba(${pr},${pg},${pb},${(fade * 0.4).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${pr},${pg},${pb},${fade.toFixed(3)})`);
      octx.fillStyle = grad;
      octx.fillRect(0, 0, canvasW, canvasH);
    }
  } else if (bgMode === "paper") {
    octx.fillStyle = paper ? paper.bg : "#efe9dc";
    octx.fillRect(0, 0, canvasW, canvasH);
  }
  // bgMode === "remove": leave transparent.

  // Region alpha mask over the output canvas.
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = canvasW;
  maskCanvas.height = canvasH;
  const mctx = maskCanvas.getContext("2d")!;
  mctx.fillStyle = "#ffffff";
  if (applyTo === "subject") {
    if (mask && mask.length === sw * sh) {
      // Precise: the RMBG matte, upscaled to the word canvas as alpha.
      const mi = new ImageData(sw, sh);
      for (let i = 0; i < sw * sh; i++) {
        const a = Math.round(clamp01(mask[i]) * 255);
        const p = i * 4;
        mi.data[p] = 255;
        mi.data[p + 1] = 255;
        mi.data[p + 2] = 255;
        mi.data[p + 3] = a;
      }
      const mf = document.createElement("canvas");
      mf.width = sw;
      mf.height = sh;
      mf.getContext("2d")!.putImageData(mi, 0, 0);
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(mf, 0, 0, sw, sh, 0, 0, canvasW, canvasH);
    } else {
      // Fast: block out the salient cells (blocky, but model-free / video-safe).
      const cells = fastCells ?? saliencyCells(src, sw, sh, cols, rows, split);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (cells[cy * cols + cx]) {
            mctx.fillRect(cx * cellPxW, cy * cellPxH, cellPxW + 1, cellPxH + 1);
          }
        }
      }
    }
  } else {
    // Geometric halves.
    const rx0 = applyTo === "right" ? Math.round(split * cols) * cellPxW : 0;
    const rx1 = applyTo === "left" ? Math.round(split * cols) * cellPxW : canvasW;
    const ry0 = applyTo === "bottom" ? Math.round(split * rows) * cellPxH : 0;
    const ry1 = applyTo === "top" ? Math.round(split * rows) * cellPxH : canvasH;
    mctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
  }

  // Optional feathered boundary: blur the region mask so the words dissolve into
  // the background at the edge (a soft split line, or a soft silhouette edge).
  const edgeFade = clamp01(params.edgeFade ?? 0);
  let regionMask = maskCanvas;
  if (edgeFade > 0) {
    const fm = document.createElement("canvas");
    fm.width = canvasW;
    fm.height = canvasH;
    const fx = fm.getContext("2d")!;
    fx.filter = `blur(${Math.max(1, Math.round(edgeFade * canvasW * 0.04))}px)`;
    fx.drawImage(maskCanvas, 0, 0);
    regionMask = fm;
  }

  // Soft drop-shadow: a blurred, offset, dark copy of the region silhouette,
  // laid under the words so the element lifts off the background.
  const shadow = clamp01(params.shadow ?? 0);
  // A near-black shadow is invisible on dark paper — skip it there.
  if (shadow > 0 && params.paper !== "dark") {
    const sc = document.createElement("canvas");
    sc.width = canvasW;
    sc.height = canvasH;
    const sx = sc.getContext("2d")!;
    sx.drawImage(regionMask, 0, 0);
    sx.globalCompositeOperation = "source-in";
    sx.fillStyle = "#0a0b0d";
    sx.fillRect(0, 0, canvasW, canvasH);
    // Bias the offset downward for a grounded, contact-shadow look.
    const offX = Math.round(canvasW * 0.006 * (0.6 + shadow));
    const offY = Math.round(canvasW * 0.016 * (0.6 + shadow));
    octx.save();
    octx.globalAlpha = 0.5 * shadow;
    octx.filter = `blur(${Math.round(4 + 14 * shadow)}px)`;
    octx.drawImage(sc, offX, offY);
    octx.restore();
  }

  // Clip the word raster to the region, then lay it over the background.
  const clip = document.createElement("canvas");
  clip.width = canvasW;
  clip.height = canvasH;
  const cctx = clip.getContext("2d")!;
  cctx.drawImage(wordCanvas, 0, 0);
  cctx.globalCompositeOperation = "destination-in";
  cctx.drawImage(regionMask, 0, 0);
  octx.drawImage(clip, 0, 0);

  return { imageData: octx.getImageData(0, 0, canvasW, canvasH), text };
}
