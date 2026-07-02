// Runs a stack of effect stages. Every mode is a full-frame producer:
// pixel effects are synchronous; YOLO (boxes baked in) and Depth are async.

import { isPixelMode, runPixelEffect, type Stage } from "./modes";
import { detectAndBake } from "./effects/yolo";
import { estimateDepth } from "./effects/depth";
import { blendImageData } from "./image";
import type { EffectResult, DepthParams, YoloParams } from "./effects/types";

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
  } else if (isPixelMode(stage.mode)) {
    r = runPixelEffect(stage.mode, source, stage.params);
  } else {
    return { imageData: source };
  }
  return { imageData: blendImageData(r.imageData, source, opacity), text: r.text };
}
