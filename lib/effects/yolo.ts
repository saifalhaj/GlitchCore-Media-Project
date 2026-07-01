import type { Detection, YoloParams } from "./types";

export const MODEL_PATH = "/models/yolo11n.onnx";

const ORT_VERSION = "1.27.0";
const INPUT_SIZE = 640;
const NUM_CLASSES = 80;

// COCO-80 class names, in model output order.
const COCO_LABELS = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
  "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
  "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
  "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
  "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
  "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
  "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
  "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
];

// Single cached session + in-flight load promise so concurrent detect() calls share one load.
type OrtModule = typeof import("onnxruntime-web");
let sessionPromise: Promise<any> | null = null;

async function getSession(): Promise<any> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const ort: OrtModule = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

    // Fail fast with MODEL_UNAVAILABLE when the model file is not served.
    let head: Response;
    try {
      head = await fetch(MODEL_PATH, { method: "HEAD" });
    } catch {
      throw modelUnavailable();
    }
    if (!head.ok) throw modelUnavailable();

    try {
      return await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["webgpu"],
      });
    } catch {
      // ponytail: single wasm fallback covers everything non-webgpu; webgl deliberately skipped.
      try {
        return await ort.InferenceSession.create(MODEL_PATH, {
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
    sessionPromise = null; // let a later call retry
    throw e;
  }
}

function modelUnavailable(): Error {
  const err = new Error("model unavailable");
  (err as any).code = "MODEL_UNAVAILABLE";
  return err;
}

type Letterbox = { data: Float32Array; scale: number; padX: number; padY: number };

function preprocess(source: ImageData): Letterbox {
  const w = source.width;
  const h = source.height;
  const scale = Math.min(INPUT_SIZE / w, INPUT_SIZE / h);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((INPUT_SIZE - newW) / 2);
  const padY = Math.floor((INPUT_SIZE - newH) / 2);

  // Draw the source (put then scale-blit) onto a padded 640x640 canvas.
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  srcCanvas.getContext("2d")!.putImageData(source, 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(srcCanvas, 0, 0, w, h, padX, padY, newW, newH);

  const { data: px } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const area = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(3 * area); // NCHW
  for (let i = 0; i < area; i++) {
    const p = i * 4;
    data[i] = px[p] / 255; // R plane
    data[area + i] = px[p + 1] / 255; // G plane
    data[2 * area + i] = px[p + 2] / 255; // B plane
  }
  return { data, scale, padX, padY };
}

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function nms(dets: Detection[], iouThreshold: number): Detection[] {
  // Per-class (class-aware) NMS — matches canonical YOLO postprocessing, so an
  // overlapping person + bicycle aren't collapsed into one box.
  const sorted = dets.slice().sort((p, q) => q.score - p.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    let overlap = false;
    for (const k of kept) {
      if (k.classId === d.classId && iou(d, k) > iouThreshold) {
        overlap = true;
        break;
      }
    }
    if (!overlap) kept.push(d);
  }
  return kept;
}

export async function detect(source: ImageData, params: YoloParams): Promise<Detection[]> {
  const session = await getSession();
  const { data, scale, padX, padY } = preprocess(source);

  const ort: OrtModule = await import("onnxruntime-web");
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const feeds: Record<string, any> = {
    [inputName]: new ort.Tensor("float32", data, [1, 3, INPUT_SIZE, INPUT_SIZE]),
  };

  const results = await session.run(feeds);
  const output = results[outputName];
  // Shape [1, 84, 8400]: rows 0-3 = cx,cy,w,h; rows 4..83 = class scores.
  const out = output.data as Float32Array;
  const anchors = output.dims[2]; // 8400 (dims[1] = 84 = 4 bbox + 80 classes)

  const srcW = source.width;
  const srcH = source.height;
  const dets: Detection[] = [];

  for (let a = 0; a < anchors; a++) {
    // Argmax over the 80 class scores for this anchor.
    let best = -Infinity;
    let classId = 0;
    for (let c = 0; c < NUM_CLASSES; c++) {
      const s = out[(4 + c) * anchors + a];
      if (s > best) {
        best = s;
        classId = c;
      }
    }
    if (best < params.confThreshold) continue;

    const cx = out[0 * anchors + a];
    const cy = out[1 * anchors + a];
    const bw = out[2 * anchors + a];
    const bh = out[3 * anchors + a];

    // xyxy in 640 space, undo letterbox into source coords.
    let x1 = (cx - bw / 2 - padX) / scale;
    let y1 = (cy - bh / 2 - padY) / scale;
    let x2 = (cx + bw / 2 - padX) / scale;
    let y2 = (cy + bh / 2 - padY) / scale;
    x1 = Math.max(0, Math.min(srcW, x1));
    y1 = Math.max(0, Math.min(srcH, y1));
    x2 = Math.max(0, Math.min(srcW, x2));
    y2 = Math.max(0, Math.min(srcH, y2));

    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0) continue;

    dets.push({
      x: x1,
      y: y1,
      w,
      h,
      score: best,
      classId,
      label: COCO_LABELS[classId] ?? String(classId),
    });
  }

  return nms(dets, params.iouThreshold);
}
