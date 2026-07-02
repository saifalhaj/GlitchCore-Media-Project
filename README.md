# GlitchCore — image effects

Upload an image or a short video, run it through six algorithmic modes, tune
each live, export the result. **Everything runs client-side** — nothing is
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

## The five modes

| Mode | What it does |
|------|--------------|
| **ASCII** | Samples the image on a grid, maps cell luminance to a character ramp, rasterizes to canvas (and keeps the raw text for copy-as-text). Mono or sampled color, three ramps, invert. |
| **Glitchcore** | Stacked datamosh: RGB channel shift, pixel sort (Kim Asendorf style), block corruption, scanlines. Seeded so a glitch is reproducible until re-rolled. |
| **YOLO** | Real object detection with **YOLO11n** running in your browser via `onnxruntime-web` (WebGPU with automatic WASM fallback). Boxes + labels on a separate overlay layer. |
| **Halftone** | Ordered dithering (Bayer 4×4 / 8×8), Floyd–Steinberg error diffusion, and true dot halftone. Mono or duotone. |
| **Edge Map** | Sobel gradient magnitude → line art, with threshold and invert. |
| **Depth** | Monocular depth estimation (**Depth-Anything V2 small**, ONNX) in the browser — near is bright. Turbo or grayscale colormap, invertible. |

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

Two models are committed and served as static assets:

- `public/models/yolo11n.onnx` (~10 MB, YOLO11n, 640 input) — detection
- `public/models/depth-anything-v2-small.onnx` (~27 MB, int8 quantized, 518 input) — depth

Both load lazily on first use of their mode, try WebGPU first and fall back to
WASM, and share the cached session. If a model file is missing, that mode shows
the source image unaltered with a drop-in note — every other mode is unaffected.
Depth is compute-heavy; expect a few seconds on WASM (much faster on WebGPU).

> ⚠️ **Licensing:** Ultralytics YOLO models are AGPL-3.0 (or require an
> Ultralytics Enterprise license for closed-source commercial use). Fine for a
> personal / open project; revisit if this ever ships as closed-source
> commercial software.

## Deploy

Push to `main` and import the repo at [vercel.com/new](https://vercel.com/new).
Zero config for this stack — every push to `main` auto-deploys. No environment
variables are required.

## Notes

- Uploaded images are capped to 2048px on the longest side for responsive
  effect processing.
- The mode rail renders static thumbnails (no animation loop), so
  `prefers-reduced-motion` is respected by default.
