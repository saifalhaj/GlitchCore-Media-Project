import type { EffectResult, WordsParams } from "./types";
import { luminance, mulberry32 } from "./types";
import { hexToRgb, rgbToHex } from "../color";

// Fork of ascii.ts: same block-average luminance sampler + offscreen-canvas
// rasterization, but each cell renders a whole WORD instead of one glyph.
// Brightness never changes WHICH word shows — only its ink (opacity / weight /
// highlight) and whether an edge cell dissolves away.

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
  "static",
];

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
  minSize: number
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

export function words(source: ImageData, params: WordsParams): EffectResult {
  const sw = source.width;
  const sh = source.height;
  const src = source.data;

  const cols = Math.max(1, Math.round(params.columns));
  const cellW = sw / cols;
  // Landscape word cells (a word is wider than tall) → many short rows.
  const rows = Math.max(1, Math.round((2 * sh) / cellW));

  const seed = params.seed >>> 0;
  const pool = buildPool(params, mulberry32(seed));
  const threshold = clamp01(params.highlightThreshold);
  const dissolve = clamp01(params.dissolve);
  const highlight = rgbToHex(...hexToRgb(params.highlight));
  const paper = params.paper === "transparent" ? null : PAPER[params.paper];
  const ink = paper ? paper.ink : params.invert ? "#0b0c0e" : "#edebe3";

  // Output: preserve source aspect so the (possibly transparent) layer composites
  // cleanly over the original. Cell width is capped for perf on video.
  const cellPxW = Math.min(110, Math.max(18, Math.round(1600 / cols)));
  const canvasW = cols * cellPxW;
  const canvasH = Math.max(1, Math.round((canvasW * sh) / sw));
  const cellPxH = canvasH / rows;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // Region masking: confine the word effect to part of the frame; everywhere
  // else shows the original image, baked into a single result (the "split half"
  // or "one element" look). Purely per-cell + client-side, so it also runs on video.
  const applyTo = params.applyTo ?? "whole";
  const split = clamp01(params.splitAt ?? 0.5);
  const splitCol = Math.round(split * cols);
  const splitRow = Math.round(split * rows);

  // Subject region: a cheap per-cell saliency (edge/texture energy, centre-biased)
  // stands in for "the main element" — no ML, so it works live on video too.
  let subjectCell: Uint8Array | null = null;
  if (applyTo === "subject") {
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
    subjectCell = new Uint8Array(cols * rows);
    for (let i = 0; i < detail.length; i++) {
      subjectCell[i] = detail[i] / maxD >= split ? 1 : 0;
    }
  }

  const inRegion = (cx: number, cy: number): boolean => {
    switch (applyTo) {
      case "right":
        return cx >= splitCol;
      case "left":
        return cx < splitCol;
      case "bottom":
        return cy >= splitRow;
      case "top":
        return cy < splitRow;
      case "subject":
        return subjectCell![cy * cols + cx] === 1;
      default:
        return true;
    }
  };

  if (applyTo === "whole") {
    if (paper) {
      ctx.fillStyle = paper.bg;
      ctx.fillRect(0, 0, canvasW, canvasH); // opaque paper
    }
    // transparent paper: leave the canvas cleared (alpha 0) between words.
  } else {
    // Base = the original image; the effect region is painted over it below.
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext("2d")!.putImageData(source, 0, 0);
    ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, canvasW, canvasH);
    // Opaque paper only inside a rectangular region (the geometric halves).
    if (paper && applyTo !== "subject") {
      const rx0 = applyTo === "right" ? splitCol * cellPxW : 0;
      const rx1 = applyTo === "left" ? splitCol * cellPxW : canvasW;
      const ry0 = applyTo === "bottom" ? splitRow * cellPxH : 0;
      const ry1 = applyTo === "top" ? splitRow * cellPxH : canvasH;
      ctx.fillStyle = paper.bg;
      ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    }
  }

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
    // edge dissolve: normalized distance to nearest horizontal border, 0..1
    const nyEdge = Math.min((ry + 0.5) / rows, 1 - (ry + 0.5) / rows) * 2;

    for (let rx = 0; rx < cols; rx++) {
      if (!inRegion(rx, ry)) {
        rowWords[rx] = ""; // outside the effect region → original shows through
        continue;
      }
      // subject region uses per-cell paper (halves fill a rect once, above)
      if (applyTo === "subject" && paper) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = paper.bg;
        ctx.fillRect(rx * cellPxW, ry * cellPxH, cellPxW + 1, cellPxH + 1);
      }
      const x0 = Math.floor((rx * sw) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * sw) / cols));

      let sumL = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let idx = (y * sw + x0) * 4;
        for (let x = x0; x < x1; x++) {
          sumL += luminance(src[idx], src[idx + 1], src[idx + 2]);
          n++;
          idx += 4;
        }
      }
      const raw = clamp01(sumL / n / 255);
      const norm = params.invert ? 1 - raw : raw;

      // Per-cell deterministic stream (word choice is brightness-independent).
      const rng = mulberry32(
        (seed ^ Math.imul(rx, 0x9e3779b1) ^ Math.imul(ry, 0x85ebca77)) >>> 0
      );
      const r0 = rng();
      const dropRoll = rng();
      // Region → word. "bands": the ordered vocabulary maps top→bottom, so
      // "clouds boat ocean" paints sky/boat/sea as their own labels. "luminance":
      // scene brightness picks the word (dark→first … bright→last word). "mix":
      // a random word per cell across the whole pool (the original behavior).
      let word: string;
      if (params.regionMode === "bands") {
        const band = Math.min(pool.length - 1, Math.floor((ry / rows) * pool.length));
        word = pool[band];
      } else if (params.regionMode === "luminance") {
        word = pool[Math.min(pool.length - 1, Math.floor(raw * pool.length))];
      } else {
        word = pool[Math.min(pool.length - 1, Math.floor(r0 * pool.length))];
      }
      rowWords[rx] = word; // grid stays rectangular even for dropped cells

      const nxEdge = Math.min((rx + 0.5) / cols, 1 - (rx + 0.5) / cols) * 2;
      const edgeDist = Math.min(nxEdge, nyEdge); // 0 at border, 1 at center
      if (dropRoll < dissolve * (1 - edgeDist)) continue; // dissolve → skip ink

      const weight =
        params.toneMode === "weight" ? 300 + Math.round(norm * 5) * 100 : 500;
      // Opacity floor so words stay legible in darker regions.
      ctx.globalAlpha = params.toneMode === "opacity" ? 0.3 + 0.7 * norm : 1;
      ctx.fillStyle = norm >= threshold ? highlight : ink;
      const text = fitWord(ctx, word, maxTextW, weight, baseSize, minSize);
      ctx.fillText(text, rx * cellPxW + cellPxW / 2, ry * cellPxH + cellPxH / 2);
    }
    textRows[ry] = rowWords.join(" ");
  }

  return {
    imageData: ctx.getImageData(0, 0, canvasW, canvasH),
    text: textRows.join("\n"),
  };
}
