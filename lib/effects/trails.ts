import { EffectResult, FrameContext, TrailsParams, luminance } from "./types";
import { hexToRgb } from "../color";

/** Trails (temporal): feedback echo / datamosh smear. Each frame the layer's own
 *  previous output is decayed by `persistence`, optionally smeared horizontally,
 *  and composited under the live frame — so motion leaves a fading tail. */
export function trails(
  source: ImageData,
  params: TrailsParams,
  ctx: FrameContext,
): EffectResult {
  const { width: w, height: h } = source;
  const prevImg = ctx.prevOutput;

  // First frame / still path: no feedback to work with → identity.
  if (!prevImg || prevImg.width !== w || prevImg.height !== h) {
    return { imageData: source };
  }

  const cur = source.data;
  const prev = prevImg.data;
  const out = new Uint8ClampedArray(cur.length);

  const persistence = Math.max(0, Math.min(1, params.persistence));
  const smear = Math.round(params.smearPx) | 0;
  const mode = params.mode;
  const onionA = persistence * 0.6;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;

      const cr = cur[i];
      const cg = cur[i + 1];
      const cb = cur[i + 2];

      // Sample the (optionally smeared) feedback pixel, then decay it.
      let sx = smear !== 0 ? x - smear : x;
      if (sx < 0) sx = 0;
      else if (sx >= w) sx = w - 1;
      const j = (row + sx) * 4;
      const dr = prev[j] * persistence;
      const dg = prev[j + 1] * persistence;
      const db = prev[j + 2] * persistence;

      let or: number, og: number, ob: number;
      if (mode === "screen") {
        or = 255 - ((255 - cr) * (255 - dr)) / 255;
        og = 255 - ((255 - cg) * (255 - dg)) / 255;
        ob = 255 - ((255 - cb) * (255 - db)) / 255;
      } else if (mode === "onion") {
        or = cr * (1 - onionA) + dr * onionA;
        og = cg * (1 - onionA) + dg * onionA;
        ob = cb * (1 - onionA) + db * onionA;
      } else {
        // "lighten"
        or = cr > dr ? cr : dr;
        og = cg > dg ? cg : dg;
        ob = cb > db ? cb : db;
      }

      out[i] = or;
      out[i + 1] = og;
      out[i + 2] = ob;
      out[i + 3] = 255;
    }
  }

  // Motion scanner: paint moving edges in the tint color.
  if (params.diffHighlight && ctx.history.length >= 2) {
    const prevIn = ctx.history[ctx.history.length - 2].data;
    const [tr, tg, tb] = hexToRgb(params.tint);
    for (let i = 0; i < out.length; i += 4) {
      const motion = Math.abs(
        luminance(cur[i], cur[i + 1], cur[i + 2]) -
          luminance(prevIn[i], prevIn[i + 1], prevIn[i + 2]),
      );
      if (motion > 18) {
        // Ramp mix 0→0.8 as motion climbs past the threshold.
        const mix = Math.min(0.8, (motion - 18) / 100);
        out[i] = out[i] * (1 - mix) + tr * mix;
        out[i + 1] = out[i + 1] * (1 - mix) + tg * mix;
        out[i + 2] = out[i + 2] * (1 - mix) + tb * mix;
      }
    }
  }

  return { imageData: new ImageData(out, w, h) };
}
