# GlitchCore — image effects

Upload an image or a short video, run it through nineteen algorithmic modes,
tune each live, export the result. **Everything runs client-side** — nothing is
uploaded, there is no server, no database, no accounts.

Two routes:

- **/** — a motion-driven landing page where the effect engine demos itself:
  a six-mode hero cycle, a still + live-per-frame-video proof section, and a
  live-rendered mode gallery (all produced on page load from `/sample.jpg`
  and `/sample.mp4`).
- **/studio** — the tool. **One-click presets per mode** are the default UI;
  the dials, per-layer blend controls, and the effect stack live under
  **Advanced**. Live thumbnails in the mode rail show the current media
  already run through each mode, so the switcher doubles as a gallery.

## The nineteen modes

Modes fall into three archetypes — **sync-pixel** (stateless, run live on video),
**temporal** (need frame history, video-only), and **model** (ONNX inference,
still-only, skipped on video).

**Sync-pixel** (all run live on image *and* video):

| Mode | What it does |
|------|--------------|
| **ASCII** | Luminance mapped to a character ramp on a sampled grid; mono/sampled color, ramps, invert, custom ink/paper (or transparent paper). Keeps the text for copy-as-text. |
| **Glitchcore** | Stacked datamosh: RGB shift, pixel sort (Kim Asendorf), block corruption, scanlines. Seeded. |
| **Vision** | A *fake* real-time detection HUD — boxes, tracked IDs, hub-and-spoke connectors, cyan accents. Procedural, so it runs live on video where real YOLO can't. Editable colors. |
| **Halftone** | Bayer 4×4 / 8×8 ordered dither, Floyd–Steinberg, true dot halftone; mono/duotone, custom single ink, and an editorial **dissolve** (fade toward paper / transparent, from the edges or shadows) via `lib/mask.ts`. |
| **False-color** | Luminance through a thermal (ironbow/white-hot/medical/turbo) or duotone ramp; gain, bias, isotherm bands. |
| **Edge Map** | Sobel gradient magnitude → line art; threshold, invert. |
| **Kaleidoscope** | Mirror & rotational symmetry remap — kaleido, quad, single-axis; segments, angle, center, zoom. |
| **Pixelate** | Block-average mosaic — square, dot-grid, or hex. |
| **CRT / VHS** | Analog-TV death: barrel glass, YCbCr chroma bleed, phosphor mask, scanlines, vignette, roll/tracking tear, snow. |
| **Contour** | Luminance quantized into elevation bands with traced iso-lines; mono/turbo/ink/terrain palettes. |
| **Low-poly** | Edge-biased jittered-grid triangles or Voronoi cells, flat-shaded; optional wireframe. |
| **Word raster** | Semantic ASCII — the image as a grid of whole words, toned by opacity/weight, dissolving at the edges (a custom **vocabulary**). |

**Temporal** (video-only; degrade to identity on a still):

| Mode | What it does |
|------|--------------|
| **Slit-scan** | Every band sampled from a different moment in the frame history — motion smears across time. |
| **Trails** | Feedback echo / datamosh smear — each frame decays into the next; lighten/screen/onion, motion highlight. |

**Model** (in-browser ONNX; still-only, WebGPU with automatic WASM fallback):

| Mode | What it does |
|------|--------------|
| **YOLO** | Real object detection (**YOLO11n**) — boxes + labels baked into the frame. |
| **Depth** | Monocular depth (**Depth-Anything V2 small**) — near is bright; turbo/grayscale. |
| **Pose** | Human keypoint skeletons (**MoveNet MultiPose**) — joints & bones as a HUD. |
| **Cutout** | Subject isolation (**RMBG-1.4**) — transparent, spotlight, or solid background. |
| **Depth 3D** | Depth reprojected into fog, parallax, anaglyph, or a point cloud (reuses the Depth model). |

Each effect is a pure function in [`lib/effects/`](lib/effects) — independently
testable and swappable.

## Stacking & sharing

Every effect is a **layer**. Build a chain in the right panel — `Edge Map →
ASCII`, `Depth → Halftone`, `Glitchcore → Halftone`, whatever — piped
source → … → output. The mode rail sets the *selected* layer, **＋ add** appends
one, and you can reorder or remove layers. YOLO bakes its boxes into the frame,
so it composes like any other layer.

Every layer has a **Blend with original** slider plus a **blend mode**
(normal / multiply / screen): at 100% normal the effect replaces the frame;
lower opacity or multiply/screen composite it over the layer's input, so the
original shows through — ASCII glyphs screened over the photo, a translucent
depth tint, softened glitch. Blend settings are part of the shareable recipe
and apply per-frame in video too.

A **compare** toggle on the stage adds a draggable divider (arrow keys work
too) revealing the original on the left and the result on the right.

The **entire stack** (every layer's mode + params) is encoded into the URL, so
**Copy link** produces a link that reproduces the exact result — no server, no
database. Input is validated on load, so a hand-edited link can't break the app.

## Video

Load a video (**Open…** in the header, or drag-drop) and the four pixel effects
apply **per-frame** live in the browser. **Export clip** records a sub-10s WebM
via `MediaRecorder` + `canvas.captureStream()` — no upload, no server. YOLO is
stills-only (per-frame detection is too slow). The working frame is capped to
640px / 25fps to keep playback near real-time; port the effects to WebGL/WebGPU
shaders if you want smoother HD.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** with hand-authored design tokens ([`styles/tokens.css`](styles/tokens.css))
- Raw **Canvas 2D** — every effect is hand-rolled pixel/tensor math, zero image-processing deps
- **onnxruntime-web** for in-browser YOLO inference
- Persistence: none needed (there's no server state).

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

## The ONNX models

Four models are committed and served as static assets:

- `public/models/yolo11n.onnx` (~10 MB, 640 input) — YOLO detection
- `public/models/depth-anything-v2-small.onnx` (~27 MB int8, 518 input) — Depth + Depth 3D
- `public/models/movenet-multipose.onnx` (~19 MB fp32, 256 input) — Pose
- `public/models/rmbg-1.4.onnx` (~44 MB quantized, 1024 input) — Cutout

They load lazily on first use of their mode, try WebGPU first and fall back to
WASM — both at session-create time and, via `lib/effects/modelSession.ts`, if a
kernel fails mid-run (MoveNet's GatherND does this on the WebGPU/jsep backend, so
Pose runs on WASM). If a model file is missing, that mode shows the source
unaltered with a drop-in note — every other mode is unaffected. These are
compute-heavy; expect a few seconds (Cutout/RMBG the most).

> ⚠️ **Model licensing** (fine for a personal / open project; revisit before any
> commercial use):
> - **YOLO11n** — AGPL-3.0 (Ultralytics), or an Enterprise license for closed source.
> - **RMBG-1.4** (Cutout) — Bria's license is **non-commercial**; a commercial
>   license must be obtained from Bria for commercial use.
> - **Depth-Anything V2 small**, **MoveNet** (Pose) — permissive (Apache-2.0).

## Deploy

Push to `main` and import the repo at [vercel.com/new](https://vercel.com/new).
Zero config for this stack — every push to `main` auto-deploys. No environment
variables are required.

## Notes

- Uploaded images are capped to 2048px on the longest side for responsive
  effect processing.
- The mode rail renders static thumbnails (no animation loop), so
  `prefers-reduced-motion` is respected by default.
