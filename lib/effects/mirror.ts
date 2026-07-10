import type { EffectResult, MirrorParams } from "./types";
import { blankLike } from "./types";

export function mirror(source: ImageData, params: MirrorParams): EffectResult {
  const w = source.width;
  const h = source.height;
  const src = source.data;

  const out = blankLike(source);
  const dst = out.data;

  const { pattern } = params;
  const cx = params.centerX * w;
  const cy = params.centerY * h;
  const ang = (params.angle * Math.PI) / 180;
  const z = Math.max(0.01, params.zoom);
  const segs = Math.max(1, Math.round(params.segments));
  const wedge = (2 * Math.PI) / segs;
  const halfWedge = wedge / 2;

  const maxX = w - 1;
  const maxY = h - 1;

  let di = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, di += 4) {
      let sx: number;
      let sy: number;

      if (pattern === "mirrorX") {
        sx = cx - Math.abs(x - cx);
        sy = y;
      } else if (pattern === "mirrorY") {
        sx = x;
        sy = cy - Math.abs(y - cy);
      } else if (pattern === "quadMirror") {
        sx = cx - Math.abs(x - cx);
        sy = cy - Math.abs(y - cy);
      } else {
        // kaleido
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy) / z;
        const theta = Math.atan2(dy, dx) - ang;
        let a = ((theta % wedge) + wedge) % wedge;
        if (a > halfWedge) a = wedge - a;
        sx = cx + r * Math.cos(a + ang);
        sy = cy + r * Math.sin(a + ang);
      }

      // nearest sample, clamp to bounds
      let ix = Math.round(sx);
      let iy = Math.round(sy);
      if (ix < 0) ix = 0;
      else if (ix > maxX) ix = maxX;
      if (iy < 0) iy = 0;
      else if (iy > maxY) iy = maxY;

      const si = (iy * w + ix) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = 255;
    }
  }

  return { imageData: out };
}
