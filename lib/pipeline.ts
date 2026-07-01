// Runs a stack of effect stages. Every mode is a full-frame producer:
// pixel effects are synchronous; YOLO (boxes baked in) and Depth are async.

import { isPixelMode, runPixelEffect, type Stage } from "./modes";
import { detectAndBake } from "./effects/yolo";
import { estimateDepth } from "./effects/depth";
import type { EffectResult, DepthParams, YoloParams } from "./effects/types";

/** Produce one stage's output from an input frame. May throw MODEL_UNAVAILABLE
 *  (from a YOLO/Depth stage whose model file is missing). */
export async function produceStage(stage: Stage, source: ImageData): Promise<EffectResult> {
  if (stage.mode === "yolo") {
    return { imageData: await detectAndBake(source, stage.params as unknown as YoloParams) };
  }
  if (stage.mode === "depth") {
    return { imageData: await estimateDepth(source, stage.params as unknown as DepthParams) };
  }
  if (isPixelMode(stage.mode)) {
    return runPixelEffect(stage.mode, source, stage.params);
  }
  return { imageData: source };
}
