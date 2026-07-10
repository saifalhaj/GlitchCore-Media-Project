import type { EffectResult, PixelateParams } from "./types";

/**
 * PIXELATE — block-average mosaic. Bakes onto a canvas by iterating a block grid
 * and filling each cell with its average (smooth) or center-pixel (nearest) color.
 * Shapes: square fill, circle dot-grid, or brick-offset "hex" approximation.
 */
export function pixelate(source: ImageData, params: PixelateParams): EffectResult {
  const w = source.width;
  const h = source.height;
  const src = source.data;

  const b = Math.max(1, Math.round(params.blockSize));
  const shape = params.shape;
  const smooth = params.smooth;
  const outline = params.outline;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // Opaque backdrop for every shape: the dot-grid needs it, and it guarantees no
  // transparent gaps on hex offset rows (and it's fully overwritten for square).
  ctx.fillStyle = "#0c0e11";
  ctx.fillRect(0, 0, w, h);

  const rows = Math.ceil(h / b);
  const cols = Math.ceil(w / b);

  for (let ry = 0; ry < rows; ry++) {
    const by = ry * b;
    // hex: offset alternate rows by half a block (brick staggering). Snap to an
    // integer so fillRect doesn't anti-alias seams into semi-transparent pixels.
    const offset = shape === "hex" && ry % 2 === 1 ? Math.round(b / 2) : 0;

    // Offset rows need an extra block on each side to tile the full width.
    const cStart = offset ? -1 : 0;
    const cEnd = offset ? cols : cols - 1;
    for (let cx = cStart; cx <= cEnd; cx++) {
      const bx = cx * b + offset;
      // Clamped block bounds so right/bottom partial blocks are handled.
      const x0 = Math.max(0, Math.min(w - 1, Math.round(bx)));
      const x1 = Math.max(x0 + 1, Math.min(w, Math.round(bx + b)));
      const y0 = by;
      const y1 = Math.min(h, by + b);
      if (y0 >= y1 || x0 >= x1) continue;

      let r: number;
      let g: number;
      let bl: number;

      if (smooth) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          let idx = (y * w + x0) * 4;
          for (let x = x0; x < x1; x++) {
            sr += src[idx];
            sg += src[idx + 1];
            sb += src[idx + 2];
            n++;
            idx += 4;
          }
        }
        r = Math.round(sr / n);
        g = Math.round(sg / n);
        bl = Math.round(sb / n);
      } else {
        // Nearest: sample the block's center pixel (shifted center for hex).
        const px = Math.max(0, Math.min(w - 1, Math.floor((x0 + x1) / 2)));
        const py = Math.max(0, Math.min(h - 1, Math.floor((y0 + y1) / 2)));
        const idx = (py * w + px) * 4;
        r = src[idx];
        g = src[idx + 1];
        bl = src[idx + 2];
      }

      ctx.fillStyle = `rgb(${r},${g},${bl})`;

      if (shape === "circle") {
        const cxp = bx + b / 2;
        const cyp = by + b / 2;
        ctx.beginPath();
        ctx.arc(cxp, cyp, b * 0.46, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(bx, by, b, b);
      }
    }
  }

  if (outline && shape !== "circle") {
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = b; x < w; x += b) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = b; y < h; y += b) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
  }

  return { imageData: ctx.getImageData(0, 0, w, h) };
}
