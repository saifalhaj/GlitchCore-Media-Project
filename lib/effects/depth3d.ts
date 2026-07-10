import type { Depth3dParams } from "./types";
import { loadSession, getOrt, runModel } from "./modelSession";
import { hexToRgb } from "../color";

// Reuses the Depth-Anything V2 small model (same file depth.ts downloads).
export const MODEL_PATH = "/models/depth-anything-v2-small.onnx";

const SIZE = 518; // multiple of 14 (ViT patch) — model's native input
const MEAN = [0.485, 0.456, 0.406]; // ImageNet
const STD = [0.229, 0.224, 0.225];

/** Run depth, returning a source-sized field in [0,1] where HIGHER = NEARER. */
async function depthField(source: ImageData, invert: boolean): Promise<Float32Array> {
  const session = await loadSession(MODEL_PATH);

  // Preprocess: square-resize to 518 + ImageNet normalize, NCHW.
  const sq = document.createElement("canvas");
  sq.width = SIZE;
  sq.height = SIZE;
  const sctx = sq.getContext("2d", { willReadFrequently: true })!;
  const src = document.createElement("canvas");
  src.width = source.width;
  src.height = source.height;
  src.getContext("2d")!.putImageData(source, 0, 0);
  sctx.drawImage(src, 0, 0, SIZE, SIZE);
  const { data: px } = sctx.getImageData(0, 0, SIZE, SIZE);
  const area = SIZE * SIZE;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    const p = i * 4;
    input[i] = (px[p] / 255 - MEAN[0]) / STD[0];
    input[area + i] = (px[p + 1] / 255 - MEAN[1]) / STD[1];
    input[2 * area + i] = (px[p + 2] / 255 - MEAN[2]) / STD[2];
  }

  const ort = await getOrt();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any = await runModel(MODEL_PATH, {
    [inputName]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]),
  });
  const out = results[outputName];
  const depth = out.data as Float32Array;
  const dims = out.dims as number[];
  const dh = dims[dims.length - 2];
  const dw = dims[dims.length - 1];

  // Min/max normalize (HIGHER = NEARER, matching Depth-Anything inverse depth).
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  // Grayscale depth at model resolution, then stretch back to source size.
  const dImg = new ImageData(dw, dh);
  const d = dImg.data;
  for (let i = 0; i < depth.length; i++) {
    const g = Math.round(((depth[i] - min) / range) * 255);
    const p = i * 4;
    d[p] = g;
    d[p + 1] = g;
    d[p + 2] = g;
    d[p + 3] = 255;
  }
  const from = document.createElement("canvas");
  from.width = dw;
  from.height = dh;
  from.getContext("2d")!.putImageData(dImg, 0, 0);
  const to = document.createElement("canvas");
  to.width = source.width;
  to.height = source.height;
  const tctx = to.getContext("2d", { willReadFrequently: true })!;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(from, 0, 0, source.width, source.height);
  const stretched = tctx.getImageData(0, 0, source.width, source.height).data;

  const field = new Float32Array(source.width * source.height);
  for (let i = 0; i < field.length; i++) {
    let t = stretched[i * 4] / 255;
    if (invert) t = 1 - t;
    field[i] = t;
  }
  return field;
}

export async function depth3d(source: ImageData, params: Depth3dParams): Promise<ImageData> {
  const w = source.width;
  const h = source.height;
  const s = source.data;
  const strength = params.strength;
  const field = await depthField(source, params.invert);

  const out = new ImageData(w, h);
  const o = out.data;

  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);

  if (params.style === "fog") {
    const [fr, fg, fb] = hexToRgb(params.fogTone);
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      const a = (1 - field[i]) * strength; // far → fog tone
      o[p] = s[p] + (fr - s[p]) * a;
      o[p + 1] = s[p + 1] + (fg - s[p + 1]) * a;
      o[p + 2] = s[p + 2] + (fb - s[p + 2]) * a;
      o[p + 3] = 255;
    }
    return out;
  }

  if (params.style === "parallax") {
    const [br, bg, bb] = hexToRgb(params.background);
    const maxShift = Math.round(strength * 45);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const p = i * 4;
        const shift = Math.round((field[i] - 0.5) * 2 * maxShift);
        const sx = x - shift;
        if (sx < 0 || sx >= w) {
          o[p] = br;
          o[p + 1] = bg;
          o[p + 2] = bb;
        } else {
          const sp = (y * w + sx) * 4;
          o[p] = s[sp];
          o[p + 1] = s[sp + 1];
          o[p + 2] = s[sp + 2];
        }
        o[p + 3] = 255;
      }
    }
    return out;
  }

  if (params.style === "anaglyph") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const p = i * 4;
        const disp = Math.round((field[i] - 0.5) * 2 * strength * 20);
        const rp = (y * w + clampX(x + disp)) * 4;
        const cp = (y * w + clampX(x - disp)) * 4;
        o[p] = s[rp]; // red from right-shifted
        o[p + 1] = s[cp + 1]; // green from left-shifted
        o[p + 2] = s[cp + 2]; // blue from left-shifted
        o[p + 3] = 255;
      }
    }
    return out;
  }

  // pointcloud
  const [br, bg, bb] = hexToRgb(params.background);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  ctx.fillRect(0, 0, w, h);

  const step = Math.max(1, params.dotSize + 1);
  const pts: { x: number; y: number; depth: number }[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      pts.push({ x, y, depth: field[y * w + x] });
    }
  }
  pts.sort((a, b) => a.depth - b.depth); // far first, near last (near overlaps)

  const r = params.dotSize;
  for (const pt of pts) {
    const p = (pt.y * w + pt.x) * 4;
    const dx = Math.round((pt.depth - 0.5) * 2 * strength * 30);
    ctx.fillStyle = `rgb(${s[p]},${s[p + 1]},${s[p + 2]})`;
    ctx.beginPath();
    ctx.arc(pt.x + dx, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = 255;
  return img;
}
