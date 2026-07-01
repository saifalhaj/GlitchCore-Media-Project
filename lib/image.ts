// Client-side image helpers. All functions assume a browser (canvas) context.

import type { Detection } from "./effects/types";

// ponytail: cap the working image to 2048px on its longest side. Keeps every
// per-pixel effect (pixel sort especially) responsive; raise if users need
// full-resolution export.
export const MAX_SIDE = 2048;

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Decode a Blob or URL into ImageData, downscaled so its longest side ≤ maxSide. */
export async function decodeToImageData(
  src: Blob | string,
  maxSide = MAX_SIDE,
): Promise<ImageData> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = newCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = url;
  });
}

/** Paint ImageData into a canvas, resizing the canvas to match. */
export function drawImageData(canvas: HTMLCanvasElement, data: ImageData): void {
  if (canvas.width !== data.width) canvas.width = data.width;
  if (canvas.height !== data.height) canvas.height = data.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(data, 0, 0);
}

/** Bilinear-downscale ImageData to a target width (height keeps aspect). Used
 *  for the low-res sample fed to the mode-rail thumbnails. */
export function resizeImageData(src: ImageData, targetW: number): ImageData {
  const targetH = Math.max(1, Math.round((src.height / src.width) * targetW));
  const from = newCanvas(src.width, src.height);
  from.getContext("2d")!.putImageData(src, 0, 0);
  const to = newCanvas(targetW, targetH);
  const ctx = to.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(from, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH);
}

/** Flatten base + optional overlay into one export canvas. */
export function composite(
  base: HTMLCanvasElement,
  overlay?: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const out = newCanvas(base.width, base.height);
  const ctx = out.getContext("2d")!;
  ctx.drawImage(base, 0, 0);
  if (overlay && overlay.width) ctx.drawImage(overlay, 0, 0, base.width, base.height);
  return out;
}

/** Draw YOLO boxes + labels onto an overlay canvas sized to the source image.
 *  Coordinates are in source pixels; the canvas is CSS-scaled to match the base. */
export function drawDetections(
  canvas: HTMLCanvasElement,
  imgW: number,
  imgH: number,
  dets: Detection[],
  opts: { lineWidth: number; showLabels: boolean; color?: string },
): void {
  if (canvas.width !== imgW) canvas.width = imgW;
  if (canvas.height !== imgH) canvas.height = imgH;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, imgW, imgH);

  const color = opts.color ?? "#ff6b00";
  ctx.lineWidth = opts.lineWidth;
  ctx.strokeStyle = color;
  const fontSize = Math.max(11, Math.round(imgW / 55));
  ctx.font = `600 ${fontSize}px ui-monospace, "JetBrains Mono", monospace`;
  ctx.textBaseline = "top";

  for (const d of dets) {
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    if (!opts.showLabels) continue;
    const text = `${d.label} ${d.score.toFixed(2)}`;
    const pad = Math.round(fontSize * 0.3);
    const tw = ctx.measureText(text).width + pad * 2;
    const th = fontSize + pad * 2;
    const ly = d.y - th >= 0 ? d.y - th : d.y;
    ctx.fillStyle = color;
    ctx.fillRect(d.x, ly, tw, th);
    ctx.fillStyle = "#0b0c0e";
    ctx.fillText(text, d.x + pad, ly + pad);
  }
}

/** Clear an overlay canvas. */
export function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/** Trigger a browser download of a canvas as PNG. */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
