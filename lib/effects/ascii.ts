import type { AsciiParams, EffectResult } from "./types";
import { luminance } from "./types";

const RAMPS = {
  standard: " .:-=+*#%@",
  minimal: " .:#",
  // Classic Paul Bourke 70-char ramp, reversed so darkest (space) is first, brightest ("$") last.
  detailed:
    "  ..'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
} as const;

export function ascii(source: ImageData, params: AsciiParams): EffectResult {
  const { columns, ramp, colorMode, invert } = params;
  // Defaults reproduce the original terminal colors exactly.
  const paperColor = params.paperColor ?? "#0b0c0e";
  const inkColor = params.inkColor ?? "#edebe3";
  const paperTransparent = params.paperTransparent ?? false;
  const sw = source.width;
  const sh = source.height;
  const src = source.data;

  const cols = Math.max(1, Math.floor(columns));
  const cellW = sw / cols;
  const rows = Math.max(1, Math.round(sh / (cellW * 2)));

  const chars = RAMPS[ramp];
  const maxIdx = chars.length - 1;

  const charW = 7;
  const charH = charW * 2;
  const canvasW = cols * charW;
  const canvasH = rows * charH;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  if (!paperTransparent) {
    ctx.fillStyle = paperColor;
    ctx.fillRect(0, 0, canvasW, canvasH); // opaque paper
  }
  // transparent paper: leave the canvas cleared so the layer composites over the original.
  ctx.font = `bold ${Math.round(charH * 0.8)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const textRows: string[] = new Array(rows);

  for (let ry = 0; ry < rows; ry++) {
    let line = "";
    const y0 = Math.floor((ry * sh) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * sh) / rows));
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor((rx * sw) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * sw) / cols));

      let sumL = 0,
        sumR = 0,
        sumG = 0,
        sumB = 0,
        n = 0;
      for (let y = y0; y < y1; y++) {
        let idx = (y * sw + x0) * 4;
        for (let x = x0; x < x1; x++) {
          const r = src[idx],
            g = src[idx + 1],
            b = src[idx + 2];
          sumL += luminance(r, g, b);
          sumR += r;
          sumG += g;
          sumB += b;
          n++;
          idx += 4;
        }
      }

      const avgL = sumL / n;
      let norm = avgL / 255;
      if (invert) norm = 1 - norm;
      const ci = Math.min(maxIdx, Math.max(0, Math.floor(norm * maxIdx)));
      const ch = chars[ci];
      line += ch;

      if (colorMode === "sampled") {
        ctx.fillStyle = `rgb(${Math.round(sumR / n)},${Math.round(
          sumG / n
        )},${Math.round(sumB / n)})`;
      } else {
        ctx.fillStyle = inkColor;
      }
      ctx.fillText(ch, rx * charW + charW / 2, ry * charH + charH / 2);
    }
    textRows[ry] = line;
  }

  return {
    imageData: ctx.getImageData(0, 0, canvasW, canvasH),
    text: textRows.join("\n"),
  };
}
