import type { PoseParams } from "./types";
import { loadSession, getOrt, runModel } from "./modelSession";
import { turbo } from "../colormap";

export const MODEL_PATH = "/models/movenet-multipose.onnx";

const SIZE = 256; // multiple of 32, MoveNet MultiPose input
const NUM_INSTANCES = 6;
const NUM_KEYPOINTS = 17;
const STRIDE = 56; // 17*3 + 5 per instance
const MIN_INSTANCE_SCORE = 0.15;

// COCO-17 skeleton edges.
const EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6], [5, 7], [7, 9], [6, 8],
  [8, 10], [5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
];

type Keypoint = { x: number; y: number; score: number };

type Letterbox = { data: Int32Array; scale: number; padX: number; padY: number };

function preprocess(source: ImageData): Letterbox {
  const w = source.width;
  const h = source.height;
  const scale = Math.min(SIZE / w, SIZE / h);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((SIZE - newW) / 2);
  const padY = Math.floor((SIZE - newH) / 2);

  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  src.getContext("2d")!.putImageData(source, 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(src, 0, 0, w, h, padX, padY, newW, newH);

  const { data: px } = ctx.getImageData(0, 0, SIZE, SIZE);
  const area = SIZE * SIZE;
  const data = new Int32Array(area * 3); // NHWC, raw 0..255 ints
  for (let i = 0; i < area; i++) {
    const p = i * 4;
    const o = i * 3;
    data[o] = px[p];
    data[o + 1] = px[p + 1];
    data[o + 2] = px[p + 2];
  }
  return { data, scale, padX, padY };
}

/** Run MoveNet MultiPose and bake skeletons over the source image. */
export async function poseBake(source: ImageData, params: PoseParams): Promise<ImageData> {
  const session = await loadSession(MODEL_PATH);
  const { data, scale, padX, padY } = preprocess(source);

  const ort = await getOrt();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = session as any;
  const inputName = s.inputNames[0];
  const outputName = s.outputNames[0];
  const results = await runModel(MODEL_PATH, {
    [inputName]: new ort.Tensor("int32", data, [1, SIZE, SIZE, 3]),
  });
  const out = results[outputName].data as Float32Array;

  const w = source.width;
  const h = source.height;

  // Decode instances → source-space keypoints.
  const instances: Keypoint[][] = [];
  for (let i = 0; i < NUM_INSTANCES; i++) {
    const b = i * STRIDE;
    if (b + STRIDE > out.length) break; // guard: never read out of bounds
    if (out[b + 55] < MIN_INSTANCE_SCORE) continue;
    const kps: Keypoint[] = [];
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      const ky = out[b + k * 3];
      const kx = out[b + k * 3 + 1];
      const ks = out[b + k * 3 + 2];
      let x = (kx * SIZE - padX) / scale;
      let y = (ky * SIZE - padY) / scale;
      x = x < 0 ? 0 : x > w ? w : x;
      y = y < 0 ? 0 : y > h ? h : y;
      kps.push({ x, y, score: ks });
    }
    instances.push(kps);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.putImageData(source, 0, 0);

  const min = params.minKeypointScore;
  const thermal = params.colorScheme === "thermal";
  const baseColor = params.colorScheme === "mono" ? "#ffffff" : "#c8ff4d";
  const colorFor = (score: number): string => {
    if (!thermal) return baseColor;
    const [r, g, b] = turbo(score);
    return `rgb(${r},${g},${b})`;
  };

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.font = "10px sans-serif";
  ctx.textBaseline = "bottom";

  for (const kps of instances) {
    // Bones.
    ctx.lineWidth = params.boneWidth;
    for (const [a, c] of EDGES) {
      const p = kps[a];
      const q = kps[c];
      if (p.score < min || q.score < min) continue;
      ctx.strokeStyle = colorFor((p.score + q.score) / 2);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    // Joints.
    if (params.showJoints) {
      for (const kp of kps) {
        if (kp.score < min) continue;
        ctx.fillStyle = colorFor(kp.score);
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, params.jointRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (params.showConfidence) {
      for (const kp of kps) {
        if (kp.score < min) continue;
        ctx.fillStyle = colorFor(kp.score);
        ctx.fillText(kp.score.toFixed(2), kp.x + 2, kp.y - 2);
      }
    }
  }

  return ctx.getImageData(0, 0, w, h);
}
