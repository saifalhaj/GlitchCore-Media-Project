import type { DepthParams } from "./types";
import { turbo } from "../colormap";

export const DEPTH_MODEL_PATH = "/models/depth-anything-v2-small.onnx";

const ORT_VERSION = "1.27.0";
const SIZE = 518; // multiple of 14 (ViT patch) — model's native input
// ImageNet normalization.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type OrtModule = typeof import("onnxruntime-web");
let sessionPromise: Promise<any> | null = null;

function modelUnavailable(): Error {
  const err = new Error("depth model unavailable");
  (err as { code?: string }).code = "MODEL_UNAVAILABLE";
  return err;
}

async function getSession(): Promise<any> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort: OrtModule = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
    let head: Response;
    try {
      head = await fetch(DEPTH_MODEL_PATH, { method: "HEAD" });
    } catch {
      throw modelUnavailable();
    }
    if (!head.ok) throw modelUnavailable();
    try {
      return await ort.InferenceSession.create(DEPTH_MODEL_PATH, {
        executionProviders: ["webgpu"],
      });
    } catch {
      try {
        return await ort.InferenceSession.create(DEPTH_MODEL_PATH, {
          executionProviders: ["wasm"],
        });
      } catch {
        throw modelUnavailable();
      }
    }
  })();
  try {
    return await sessionPromise;
  } catch (e) {
    sessionPromise = null;
    throw e;
  }
}

function preprocess(source: ImageData): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const src = document.createElement("canvas");
  src.width = source.width;
  src.height = source.height;
  src.getContext("2d")!.putImageData(source, 0, 0);
  ctx.drawImage(src, 0, 0, SIZE, SIZE); // square resize (stretched back on output)

  const { data: px } = ctx.getImageData(0, 0, SIZE, SIZE);
  const area = SIZE * SIZE;
  const out = new Float32Array(3 * area); // NCHW
  for (let i = 0; i < area; i++) {
    const p = i * 4;
    out[i] = (px[p] / 255 - MEAN[0]) / STD[0];
    out[area + i] = (px[p + 1] / 255 - MEAN[1]) / STD[1];
    out[2 * area + i] = (px[p + 2] / 255 - MEAN[2]) / STD[2];
  }
  return out;
}

/** Run monocular depth estimation, returning a colorized depth map at the
 *  source image's dimensions. Depth-Anything predicts inverse depth, so larger
 *  values = nearer → mapped bright by default (invert swaps). */
export async function estimateDepth(source: ImageData, params: DepthParams): Promise<ImageData> {
  const session = await getSession();
  const data = preprocess(source);

  const ort: OrtModule = await import("onnxruntime-web");
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const results = await session.run({
    [inputName]: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]),
  });
  const out = results[outputName];
  const depth = out.data as Float32Array;
  const dims = out.dims as number[];
  const dh = dims[dims.length - 2];
  const dw = dims[dims.length - 1];

  // Min/max normalize the raw depth.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  // Colorize into a depth-resolution buffer.
  const dImg = new ImageData(dw, dh);
  const d = dImg.data;
  const grayscale = params.colormap === "grayscale";
  for (let i = 0; i < depth.length; i++) {
    let t = (depth[i] - min) / range;
    if (params.invert) t = 1 - t;
    const p = i * 4;
    if (grayscale) {
      const g = Math.round(t * 255);
      d[p] = g;
      d[p + 1] = g;
      d[p + 2] = g;
    } else {
      const [r, gg, b] = turbo(t);
      d[p] = r;
      d[p + 1] = gg;
      d[p + 2] = b;
    }
    d[p + 3] = 255;
  }

  // Stretch the (square) depth map back to the source dimensions.
  if (dw === source.width && dh === source.height) return dImg;
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
  return tctx.getImageData(0, 0, source.width, source.height);
}
