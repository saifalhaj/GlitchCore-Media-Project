import type { EffectResult, VisionParams } from "./types";
import { luminance, mulberry32 } from "./types";
import { hexToRgb } from "../color";

// VISION — a FAKE real-time object-detection HUD baked over the source. A
// persistent tracked CORE of boxes (stable integer IDs) plus a churning
// EPHEMERAL population that reshuffles every flicker bucket, hub-and-spoke
// connectors, translucent accent fills, and a few solid gray label chips.
// Runs live on video where real YOLO can't keep up, so it stays O(pixels).

type Node = {
  id: number;
  x: number;
  y: number;
  bw: number;
  bh: number;
  // per-node deterministic stream, consumed for accent + chip decisions
  rng: () => number;
};

export function vision(source: ImageData, params: VisionParams): EffectResult {
  const w = source.width;
  const h = source.height;
  const src = source.data;

  // 1. Bake source into a canvas we draw HUD marks onto.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.putImageData(source, 0, 0);

  const n = Math.max(0, Math.round(params.density));
  if (n === 0) return { imageData: ctx.getImageData(0, 0, w, h) };

  // 2. Flicker bucket + PRNG streams.
  const rate = Math.max(0, params.flickerRate);
  const bucket = rate <= 0 ? 0 : Math.floor(Date.now() / (1000 / rate));
  const seed = params.seed >>> 0;
  const coreRng = mulberry32(seed); // stable across buckets → tracked IDs
  const ephRng = mulberry32((seed ^ bucket) >>> 0); // churns each bucket

  // 3a. Saliency sampler (energy anchor): coarse grid of luma gradient magnitude
  // → CDF we sample node centers from, biasing toward high-detail cells.
  const anchorEnergy = params.anchor === "energy";
  const gridW = Math.max(1, Math.min(48, w));
  const gridH = Math.max(1, Math.round((gridW * h) / w));
  const nCells = gridW * gridH;
  const cellW = w / gridW;
  const cellH = h / gridH;

  let cdf: Float64Array | null = null;
  let total = 0;
  if (anchorEnergy) {
    const luma = new Float64Array(nCells);
    const count = new Float64Array(nCells);
    for (let y = 0; y < h; y++) {
      const gy = Math.min(gridH - 1, Math.floor(y / cellH));
      let p = y * w * 4;
      for (let x = 0; x < w; x++) {
        const gx = Math.min(gridW - 1, Math.floor(x / cellW));
        const ci = gy * gridW + gx;
        luma[ci] += luminance(src[p], src[p + 1], src[p + 2]);
        count[ci] += 1;
        p += 4;
      }
    }
    for (let i = 0; i < nCells; i++) if (count[i] > 0) luma[i] /= count[i];

    const at = (cx: number, cy: number) => {
      const xx = cx < 0 ? 0 : cx >= gridW ? gridW - 1 : cx;
      const yy = cy < 0 ? 0 : cy >= gridH ? gridH - 1 : cy;
      return luma[yy * gridW + xx];
    };
    cdf = new Float64Array(nCells);
    for (let cy = 0; cy < gridH; cy++) {
      for (let cx = 0; cx < gridW; cx++) {
        const gxv = at(cx + 1, cy) - at(cx - 1, cy);
        const gyv = at(cx, cy + 1) - at(cx, cy - 1);
        total += Math.hypot(gxv, gyv);
        cdf[cy * gridW + cx] = total; // prefix sum
      }
    }
  }

  const sampleCenter = (rng: () => number): [number, number] => {
    if (anchorEnergy && cdf && total > 0) {
      const u = rng() * total;
      let lo = 0;
      let hi = nCells - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] < u) lo = mid + 1;
        else hi = mid;
      }
      const cx = lo % gridW;
      const cy = (lo - cx) / gridW;
      return [(cx + rng()) * cellW, (cy + rng()) * cellH];
    }
    // uniform (random anchor, or flat/energy-less image)
    return [rng() * w, rng() * h];
  };

  // 4. Box sizing (log-uniform) + per-frame jitter.
  const bMin = Math.max(2, Math.min(params.boxMinPx, params.boxMaxPx));
  const bMax = Math.max(bMin, params.boxMaxPx);
  const ratio = bMax / bMin; // >= 1, guards the pow()
  const jitter = Math.max(0, params.jitter);

  const makeSize = (rng: () => number): [number, number] => {
    const s = bMin * Math.pow(ratio, rng());
    const aspect = 0.6 + rng() * 0.9; // rectangular-ish, like real detections
    return [s, s * aspect];
  };

  const coreCount = Math.max(
    0,
    Math.min(n, Math.round(n * params.coreFraction))
  );
  const ephCount = n - coreCount;
  const nodes: Node[] = [];

  // Core: stable id (100+i) + base pos/size from coreRng (persists), position
  // wobbles per-bucket via a jitter rng seeded by (id ^ bucket).
  for (let i = 0; i < coreCount; i++) {
    const id = 100 + i;
    const [bx, by] = sampleCenter(coreRng);
    const [bw, bh] = makeSize(coreRng);
    const jr = mulberry32((id ^ bucket) >>> 0);
    const x = bx + jitter * bw * (jr() * 2 - 1);
    const y = by + jitter * bh * (jr() * 2 - 1);
    nodes.push({ id, x, y, bw, bh, rng: jr });
  }

  // Ephemeral: whole population reshuffles each bucket (ephRng); ids churn too.
  for (let i = 0; i < ephCount; i++) {
    const id = (seed ^ bucket ^ i) >>> 0;
    const [bx, by] = sampleCenter(ephRng);
    const [bw, bh] = makeSize(ephRng);
    const pr = mulberry32(id);
    const x = bx + jitter * bw * (pr() * 2 - 1);
    const y = by + jitter * bh * (pr() * 2 - 1);
    nodes.push({ id, x, y, bw, bh, rng: pr });
  }

  // 6. Connectors — hub-and-spoke (NOT a mesh). Hubs = first core nodes; each
  // fans to its nearest neighbours within maxLinkDist, leaving most nodes bare.
  const diag = Math.hypot(w, h);
  const maxDist = Math.max(0, params.maxLinkDist) * diag;
  const hubCount = Math.max(
    0,
    Math.min(Math.round(params.hubCount), nodes.length)
  );
  const connectorCount = Math.max(0, Math.round(params.connectorCount));
  if (hubCount > 0 && connectorCount > 0 && nodes.length > 1) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, params.lineOpacity));
    ctx.strokeStyle = params.lineColor;
    ctx.lineWidth = Math.max(0.5, params.strokeWidth);
    const perHub = Math.max(1, Math.ceil(connectorCount / hubCount));
    let drawn = 0;
    for (let hi = 0; hi < hubCount && drawn < connectorCount; hi++) {
      const hub = nodes[hi];
      const cand: { d: number; node: Node }[] = [];
      for (let j = 0; j < nodes.length; j++) {
        if (j === hi) continue;
        const d = Math.hypot(nodes[j].x - hub.x, nodes[j].y - hub.y);
        if (d <= maxDist) cand.push({ d, node: nodes[j] });
      }
      cand.sort((a, b) => a.d - b.d);
      for (let k = 0; k < perHub && k < cand.length && drawn < connectorCount; k++) {
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(cand[k].node.x, cand[k].node.y);
        ctx.stroke();
        drawn++;
      }
    }
    ctx.restore(); // resets globalAlpha to 1
  }

  // 7. Accent fills — translucent cyan-ish interior on a fraction of nodes.
  const [ar, ag, ab] = hexToRgb(params.accentColor);
  const accentProb = Math.max(0, Math.min(1, params.accentProb));
  ctx.fillStyle = `rgba(${ar},${ag},${ab},0.4)`;
  for (const node of nodes) {
    if (node.rng() < accentProb) {
      ctx.fillRect(node.x - node.bw / 2, node.y - node.bh / 2, node.bw, node.bh);
    }
  }

  // Box strokes.
  ctx.lineWidth = Math.max(0.5, params.strokeWidth);
  ctx.strokeStyle = params.boxColor;
  for (const node of nodes) {
    ctx.strokeRect(node.x - node.bw / 2, node.y - node.bh / 2, node.bw, node.bh);
  }

  // 5. Labels — 3-digit id; a fraction get a solid gray chip, others faint text.
  const [br, bg, bb] = hexToRgb(params.boxColor);
  const fontPx = 11;
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const node of nodes) {
    const label = String(node.id % 1000).padStart(3, "0");
    const lx = node.x - node.bw / 2;
    const top = node.y - node.bh / 2 - fontPx - 2;
    if (node.rng() < 0.25) {
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "#cfd3d8";
      ctx.fillRect(lx, top - 1, tw + 6, fontPx + 3);
      ctx.fillStyle = "#10141a";
      ctx.fillText(label, lx + 3, top);
    } else {
      ctx.fillStyle = `rgba(${br},${bg},${bb},0.75)`;
      ctx.fillText(label, lx + 2, top);
    }
  }

  // 8. Node markers — tiny crosshair at each center.
  if (params.nodeMarkers) {
    ctx.strokeStyle = params.lineColor;
    ctx.lineWidth = 1;
    const r = 3;
    for (const node of nodes) {
      ctx.beginPath();
      ctx.moveTo(node.x - r, node.y);
      ctx.lineTo(node.x + r, node.y);
      ctx.moveTo(node.x, node.y - r);
      ctx.lineTo(node.x, node.y + r);
      ctx.stroke();
    }
  }

  // 9.
  return { imageData: ctx.getImageData(0, 0, w, h) };
}
