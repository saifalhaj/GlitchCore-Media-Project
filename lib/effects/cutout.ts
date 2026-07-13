import type { CutoutParams } from "./types";
import { loadSession, getOrt, runModel } from "./modelSession";
import { hexToRgb } from "../color";

export const MODEL_PATH = "/models/rmbg-1.4.onnx";

const SIZE = 1024; // RMBG-1.4 native input/output resolution

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
}

// Separable box blur on a SIZE×SIZE alpha plane, radius r (px).
function boxBlur(a: Float32Array, r: number): Float32Array {
  if (r < 1) return a;
  const w = SIZE;
  const win = 2 * r + 1;
  const tmp = new Float32Array(a.length);
  // Horizontal pass.
  for (let y = 0; y < w; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += a[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = Math.min(w - 1, x + r + 1);
      const sub = Math.max(0, x - r);
      sum += a[row + add] - a[row + sub];
    }
  }
  // Vertical pass.
  const out = new Float32Array(a.length);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(w - 1, y)) * w + x];
    for (let y = 0; y < w; y++) {
      out[y * w + x] = sum / win;
      const add = Math.min(w - 1, y + r + 1);
      const sub = Math.max(0, y - r);
      sum += tmp[add * w + x] - tmp[sub * w + x];
    }
  }
  return out;
}

// The expensive RMBG inference depends only on the source frame, so its
// normalized 1024² matte is memoized per source ImageData. This makes tweaking
// threshold/feather (and every unrelated Word-raster dial) instant instead of
// re-running an ~8s model, and speeds Cutout too. Entries GC with their source.
const matteInferenceCache = new WeakMap<ImageData, Float32Array>();

/** Run RMBG-1.4 (once per source) and return the min/max-normalized 1024² matte. */
async function inferMatte(source: ImageData): Promise<Float32Array> {
  const cached = matteInferenceCache.get(source);
  if (cached) return cached;

  const session = await loadSession(MODEL_PATH); // MODEL_UNAVAILABLE propagates
  const w = source.width;
  const h = source.height;

  // 1. Plain square resize to 1024×1024, then normalize (v/255 - 0.5).
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  srcCanvas.getContext("2d")!.putImageData(source, 0, 0);

  const inCanvas = document.createElement("canvas");
  inCanvas.width = SIZE;
  inCanvas.height = SIZE;
  const inCtx = inCanvas.getContext("2d", { willReadFrequently: true })!;
  inCtx.drawImage(srcCanvas, 0, 0, SIZE, SIZE);
  const { data: px } = inCtx.getImageData(0, 0, SIZE, SIZE);

  const area = SIZE * SIZE;
  const data = new Float32Array(3 * area); // NCHW
  for (let i = 0; i < area; i++) {
    const p = i * 4;
    data[i] = px[p] / 255 - 0.5; // R plane
    data[area + i] = px[p + 1] / 255 - 0.5; // G plane
    data[2 * area + i] = px[p + 2] / 255 - 0.5; // B plane
  }

  // 2. Inference → sigmoid matte, min/max normalize to 0..1.
  const ort = await getOrt();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any = await runModel(MODEL_PATH, {
    [inputName]: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]),
  });
  const raw = results[outputName].data as Float32Array;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const norm = new Float32Array(area);
  for (let i = 0; i < area; i++) norm[i] = (raw[i] - min) / range;

  matteInferenceCache.set(source, norm);
  return norm;
}

/** Return a per-pixel subject alpha (0..1) at the source resolution. Shared by
 *  the Cutout mode and Word raster's precise "subject" region. The RMBG pass is
 *  memoized per source; only the cheap threshold/feather/stretch runs per call.
 *  Throws MODEL_UNAVAILABLE if the model file is missing. */
export async function computeMatte(
  source: ImageData,
  opts: { matteThreshold: number; feather: number; invert?: boolean },
): Promise<Float32Array> {
  const w = source.width;
  const h = source.height;
  const area = SIZE * SIZE;
  const matte = await inferMatte(source); // already min/max-normalized 0..1

  // 3. Alpha from smoothstep threshold; optional feather blur; optional invert.
  const lo = opts.matteThreshold - 0.15;
  const hi = opts.matteThreshold + 0.15;
  let alpha: Float32Array = new Float32Array(area);
  for (let i = 0; i < area; i++) {
    alpha[i] = smoothstep(lo, hi, matte[i]); // matte is already 0..1 normalized
  }
  const rr = Math.round(opts.feather);
  if (rr > 0) alpha = boxBlur(alpha, rr);
  if (opts.invert) {
    for (let i = 0; i < area; i++) alpha[i] = 1 - alpha[i];
  }

  // 4. Stretch the 1024 alpha back to source W×H (bilinear via canvas).
  const alphaImg = new ImageData(SIZE, SIZE);
  for (let i = 0; i < area; i++) {
    const g = Math.round(Math.max(0, Math.min(1, alpha[i])) * 255);
    const p = i * 4;
    alphaImg.data[p] = g;
    alphaImg.data[p + 1] = g;
    alphaImg.data[p + 2] = g;
    alphaImg.data[p + 3] = 255;
  }
  const aFrom = document.createElement("canvas");
  aFrom.width = SIZE;
  aFrom.height = SIZE;
  aFrom.getContext("2d")!.putImageData(alphaImg, 0, 0);
  const aTo = document.createElement("canvas");
  aTo.width = w;
  aTo.height = h;
  const aToCtx = aTo.getContext("2d", { willReadFrequently: true })!;
  aToCtx.imageSmoothingEnabled = true;
  aToCtx.drawImage(aFrom, 0, 0, w, h);
  const stretched = aToCtx.getImageData(0, 0, w, h).data;

  const outMask = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) outMask[i] = stretched[i * 4] / 255;
  return outMask;
}

export async function cutout(source: ImageData, params: CutoutParams): Promise<ImageData> {
  const w = source.width;
  const h = source.height;
  const alphaMask = await computeMatte(source, {
    matteThreshold: params.matteThreshold,
    feather: params.feather,
    invert: params.invert,
  });

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  srcCanvas.getContext("2d")!.putImageData(source, 0, 0);

  // 5. Composite per output mode.
  const out = new ImageData(w, h);
  const o = out.data;
  const s = source.data;

  if (params.output === "transparent") {
    for (let i = 0, n = w * h; i < n; i++) {
      const p = i * 4;
      o[p] = s[p];
      o[p + 1] = s[p + 1];
      o[p + 2] = s[p + 2];
      o[p + 3] = Math.round(alphaMask[i] * 255);
    }
    return out;
  }

  // Build the background plate: solid color, or blurred+dimmed source (spotlight).
  let plate: Uint8ClampedArray;
  if (params.output === "solid") {
    const [br, bg, bb] = hexToRgb(params.bgColor);
    plate = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, n = w * h; i < n; i++) {
      const p = i * 4;
      plate[p] = br;
      plate[p + 1] = bg;
      plate[p + 2] = bb;
      plate[p + 3] = 255;
    }
  } else {
    // spotlight: blur source, then dim toward black by bgDim.
    const bCanvas = document.createElement("canvas");
    bCanvas.width = w;
    bCanvas.height = h;
    const bCtx = bCanvas.getContext("2d", { willReadFrequently: true })!;
    bCtx.filter = `blur(${Math.max(0, params.bgBlur)}px)`;
    bCtx.drawImage(srcCanvas, 0, 0);
    bCtx.filter = "none";
    plate = bCtx.getImageData(0, 0, w, h).data;
    const keep = 1 - Math.max(0, Math.min(1, params.bgDim));
    for (let i = 0, n = w * h; i < n; i++) {
      const p = i * 4;
      plate[p] *= keep;
      plate[p + 1] *= keep;
      plate[p + 2] *= keep;
    }
  }

  for (let i = 0, n = w * h; i < n; i++) {
    const p = i * 4;
    const a = alphaMask[i];
    o[p] = Math.round(plate[p] * (1 - a) + s[p] * a);
    o[p + 1] = Math.round(plate[p + 1] * (1 - a) + s[p + 1] * a);
    o[p + 2] = Math.round(plate[p + 2] * (1 - a) + s[p + 2] * a);
    o[p + 3] = 255;
  }
  return out;
}
