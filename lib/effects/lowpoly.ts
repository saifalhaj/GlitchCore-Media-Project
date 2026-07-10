import {
  EffectResult,
  LowPolyParams,
  luminance,
  mulberry32,
} from "./types";

/**
 * LOW-POLY / Voronoi — a jittered grid of seed points (not full Delaunay, which
 * keeps this fast and robust per video frame). Seeds sit at grid vertices with a
 * random offset; edgeBias snaps them toward strong Sobel gradients so facets hug
 * detail. Two renderers:
 *   - "triangle": each grid quad → 2 filled triangles (canvas bake).
 *   - "voronoi": each pixel takes the color of its nearest neighboring seed,
 *     searched only in the local grid neighborhood → O(pixels * k).
 * All randomness is mulberry32(seed) — never Math.random. Output is opaque.
 */
export function lowpoly(source: ImageData, params: LowPolyParams): EffectResult {
  const w = source.width;
  const h = source.height;
  const src = source.data;

  const jitter = clamp01(params.jitter);
  const edgeBias = clamp01(params.edgeBias);
  const outline = params.outline < 0 ? 0 : params.outline > 2 ? 2 : params.outline;
  const centroid = params.colorSampling === "centroid";

  // Grid geometry: cols from density, rows chosen so cells are ~square.
  const cols = Math.max(2, Math.round(params.density));
  const cellW = w / cols;
  const rows = Math.max(2, Math.round((cols * h) / w));
  const cellH = h / rows;

  const clampX = (x: number) => (x < 0 ? 0 : x > w - 1 ? w - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y > h - 1 ? h - 1 : y);

  // Luminance buffer (one pass) only needed when biasing seeds toward edges.
  let lum: Float32Array | null = null;
  if (edgeBias > 0) {
    lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = luminance(src[p], src[p + 1], src[p + 2]);
    }
  }
  const magAt = (x: number, y: number): number => {
    if (!lum) return 0;
    const L = (xx: number, yy: number) =>
      lum![(clampY(yy) | 0) * w + (clampX(xx) | 0)];
    const gx =
      -L(x - 1, y - 1) + L(x + 1, y - 1) - 2 * L(x - 1, y) + 2 * L(x + 1, y) - L(x - 1, y + 1) + L(x + 1, y + 1);
    const gy =
      -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1) + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1);
    return Math.hypot(gx, gy);
  };

  // Build seed positions at each grid vertex (cols+1) x (rows+1).
  const vcols = cols + 1;
  const vrows = rows + 1;
  const nseeds = vcols * vrows;
  const sx = new Float64Array(nseeds);
  const sy = new Float64Array(nseeds);
  const rng = mulberry32(params.seed >>> 0);

  const DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];
  const probe = 0.5 * Math.min(cellW, cellH);

  for (let j = 0; j < vrows; j++) {
    for (let i = 0; i < vcols; i++) {
      const k = j * vcols + i;
      let px = i * cellW + (rng() * 2 - 1) * jitter * cellW;
      let py = j * cellH + (rng() * 2 - 1) * jitter * cellH;
      px = clampX(px);
      py = clampY(py);
      // Nudge toward the strongest nearby gradient (cheap edge snap).
      if (edgeBias > 0 && probe > 0) {
        let best = magAt(px, py);
        let bx = px;
        let by = py;
        for (let d = 0; d < DIRS.length; d++) {
          const cx = px + DIRS[d][0] * probe;
          const cy = py + DIRS[d][1] * probe;
          const m = magAt(cx, cy);
          if (m > best) {
            best = m;
            bx = cx;
            by = cy;
          }
        }
        px = clampX(px + (bx - px) * edgeBias);
        py = clampY(py + (by - py) * edgeBias);
      }
      sx[k] = px;
      sy[k] = py;
    }
  }

  // Sample source color at an (x,y) — centroid = single pixel, else 3x3 box avg.
  const colorAt = (x: number, y: number): [number, number, number] => {
    const cx = clampX(x) | 0;
    const cy = clampY(y) | 0;
    if (centroid) {
      const p = (cy * w + cx) * 4;
      return [src[p], src[p + 1], src[p + 2]];
    }
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = clampY(cy + dy) | 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = clampX(cx + dx) | 0;
        const p = (yy * w + xx) * 4;
        r += src[p];
        g += src[p + 1];
        b += src[p + 2];
        n++;
      }
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };

  if (params.cellShape === "triangle") {
    return renderTriangles();
  }
  return renderVoronoi();

  // ---- Triangle renderer (canvas bake) ----
  function renderTriangles(): EffectResult {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#0c0e11";
    ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = "round";

    const tri = (a: number, b: number, c: number) => {
      const ax = sx[a];
      const ay = sy[a];
      const bx = sx[b];
      const by = sy[b];
      const cx = sx[c];
      const cy = sy[c];
      let col: [number, number, number];
      if (centroid) {
        col = colorAt((ax + bx + cx) / 3, (ay + by + cy) / 3);
      } else {
        // Average of the three vertex colors — fast and stable on video.
        const ca = colorAt(ax, ay);
        const cb = colorAt(bx, by);
        const cc = colorAt(cx, cy);
        col = [
          Math.round((ca[0] + cb[0] + cc[0]) / 3),
          Math.round((ca[1] + cb[1] + cc[1]) / 3),
          Math.round((ca[2] + cb[2] + cc[2]) / 3),
        ];
      }
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      const fill = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fillStyle = fill;
      // Stroke with the fill color first to seal antialiased seams so the dark
      // backdrop never bleeds through as hairlines (the dark wireframe, if any,
      // is drawn in a later overlay pass).
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fill();
    };

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v00 = j * vcols + i;
        const v10 = v00 + 1;
        const v01 = v00 + vcols;
        const v11 = v01 + 1;
        tri(v00, v10, v11);
        tri(v00, v11, v01);
      }
    }

    if (outline > 0) {
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = outline;
      ctx.beginPath();
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const v00 = j * vcols + i;
          const v10 = v00 + 1;
          const v01 = v00 + vcols;
          const v11 = v01 + 1;
          ctx.moveTo(sx[v00], sy[v00]);
          ctx.lineTo(sx[v10], sy[v10]);
          ctx.lineTo(sx[v11], sy[v11]);
          ctx.lineTo(sx[v00], sy[v00]);
          ctx.lineTo(sx[v01], sy[v01]);
          ctx.lineTo(sx[v11], sy[v11]);
        }
      }
      ctx.stroke();
    }

    const img = ctx.getImageData(0, 0, w, h);
    // Guarantee full opacity.
    const d = img.data;
    for (let p = 3; p < d.length; p += 4) d[p] = 255;
    return { imageData: img };
  }

  // ---- Voronoi renderer (nearest seed per pixel, local search) ----
  function renderVoronoi(): EffectResult {
    // Precompute one color per seed.
    const scR = new Uint8ClampedArray(nseeds);
    const scG = new Uint8ClampedArray(nseeds);
    const scB = new Uint8ClampedArray(nseeds);
    for (let k = 0; k < nseeds; k++) {
      const c = colorAt(sx[k], sy[k]);
      scR[k] = c[0];
      scG[k] = c[1];
      scB[k] = c[2];
    }

    const owner = new Int32Array(w * h);
    for (let y = 0; y < h; y++) {
      const cj = Math.min(rows, Math.max(0, Math.floor(y / cellH)));
      for (let x = 0; x < w; x++) {
        const ci = Math.min(cols, Math.max(0, Math.floor(x / cellW)));
        let best = Infinity;
        let bestK = cj * vcols + ci;
        // Search a 4-vertex-wide neighborhood — jitter can push the nearest seed
        // a full cell away, so this is wider than a naive 3x3 to stay correct.
        const j0 = Math.max(0, cj - 1);
        const j1 = Math.min(vrows - 1, cj + 2);
        const i0 = Math.max(0, ci - 1);
        const i1 = Math.min(vcols - 1, ci + 2);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const k = j * vcols + i;
            const dx = x - sx[k];
            const dy = y - sy[k];
            const dist = dx * dx + dy * dy;
            if (dist < best) {
              best = dist;
              bestK = k;
            }
          }
        }
        owner[y * w + x] = bestK;
      }
    }

    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const k = owner[idx];
        let r = scR[k];
        let g = scG[k];
        let b = scB[k];
        if (outline > 0) {
          // Darken cell borders: this pixel neighbors a different owner.
          const left = x > 0 && owner[idx - 1] !== k;
          const up = y > 0 && owner[idx - w] !== k;
          if (left || up) {
            const f = 1 - 0.55 * Math.min(1, outline);
            r = r * f;
            g = g * f;
            b = b * f;
          }
        }
        const p = idx * 4;
        out[p] = r;
        out[p + 1] = g;
        out[p + 2] = b;
        out[p + 3] = 255;
      }
    }
    return { imageData: new ImageData(out, w, h) };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
