// Runs a stack of effect stages. Every mode is a full-frame producer:
// pixel effects are synchronous; YOLO (boxes baked in) and Depth are async.

import {
  isPixelMode,
  isTemporalMode,
  runPixelEffect,
  runTemporalEffect,
  type Stage,
} from "./modes";
import { detectAndBake } from "./effects/yolo";
import { estimateDepth } from "./effects/depth";
import { poseBake } from "./effects/pose";
import { cutout, computeMatte } from "./effects/cutout";
import { depth3d } from "./effects/depth3d";
import { words } from "./effects/words";
import { blendImageData } from "./image";
import type {
  EffectResult,
  DepthParams,
  YoloParams,
  PoseParams,
  CutoutParams,
  Depth3dParams,
  WordsParams,
} from "./effects/types";

/** Produce one stage's output from an input frame, composited at the layer's
 *  opacity over its input. May throw MODEL_UNAVAILABLE (from a YOLO/Depth
 *  stage whose model file is missing). */
export async function produceStage(stage: Stage, source: ImageData): Promise<EffectResult> {
  const opacity = stage.opacity ?? 1;
  let r: EffectResult;
  if (stage.mode === "yolo") {
    r = { imageData: await detectAndBake(source, stage.params as unknown as YoloParams) };
  } else if (stage.mode === "depth") {
    r = { imageData: await estimateDepth(source, stage.params as unknown as DepthParams) };
  } else if (stage.mode === "pose") {
    r = { imageData: await poseBake(source, stage.params as unknown as PoseParams) };
  } else if (stage.mode === "cutout") {
    r = { imageData: await cutout(source, stage.params as unknown as CutoutParams) };
  } else if (stage.mode === "depth3d") {
    r = { imageData: await depth3d(source, stage.params as unknown as Depth3dParams) };
  } else if (
    stage.mode === "words" &&
    (stage.params as unknown as WordsParams).applyTo === "subject" &&
    (stage.params as unknown as WordsParams).subjectDetect === "precise"
  ) {
    // Precise "one element": RMBG matte → wordify only that silhouette. Still
    // path only; if the model is missing, fall back to the fast saliency mask.
    const wp = stage.params as unknown as WordsParams;
    let mask: Float32Array | undefined;
    try {
      const tighten = Math.max(0, Math.min(1, wp.matteTighten ?? 0.5));
      mask = await computeMatte(source, {
        matteThreshold: 0.35 + tighten * 0.4, // higher → tighter silhouette
        feather: Math.max(0, Math.round(wp.matteFeather ?? 1)),
      });
    } catch {
      mask = undefined;
    }
    r = words(source, wp, mask);
  } else if (isPixelMode(stage.mode)) {
    r = runPixelEffect(stage.mode, source, stage.params);
  } else if (isTemporalMode(stage.mode)) {
    // Still path: no history/feedback → temporal effects degrade to identity.
    r = runTemporalEffect(stage.mode, source, stage.params, {
      history: [source],
      prevOutput: null,
      frameIndex: 0,
    });
  } else {
    return { imageData: source };
  }
  return {
    imageData: blendImageData(r.imageData, source, opacity, stage.blend ?? "normal"),
    text: r.text,
  };
}
