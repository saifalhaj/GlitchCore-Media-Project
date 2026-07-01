# GlitchCore — image effects

A single-page image tool. Upload one image, run it through five algorithmic
modes, tune each live, export the result. **Everything runs client-side** —
nothing is uploaded, there is no server, no database, no accounts.

Live thumbnails in the mode rail show a fixed sample already run through each
mode, so the switcher doubles as a gallery of what the tool does.

## The five modes

| Mode | What it does |
|------|--------------|
| **ASCII** | Samples the image on a grid, maps cell luminance to a character ramp, rasterizes to canvas (and keeps the raw text for copy-as-text). Mono or sampled color, three ramps, invert. |
| **Glitchcore** | Stacked datamosh: RGB channel shift, pixel sort (Kim Asendorf style), block corruption, scanlines. Seeded so a glitch is reproducible until re-rolled. |
| **YOLO** | Real object detection with **YOLO11n** running in your browser via `onnxruntime-web` (WebGPU with automatic WASM fallback). Boxes + labels on a separate overlay layer. |
| **Halftone** | Ordered dithering (Bayer 4×4 / 8×8), Floyd–Steinberg error diffusion, and true dot halftone. Mono or duotone. |
| **Edge Map** | Sobel gradient magnitude → line art, with threshold, invert, and blend-with-original. |

Each effect is a pure function in [`lib/effects/`](lib/effects) — independently
testable and swappable.

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

## The YOLO model

The detector loads `public/models/yolo11n.onnx` (~10 MB, YOLO11n, 640 input).
It's committed to the repo and served as a static asset. If it's missing, the
YOLO mode shows the source image unaltered with a note — every other mode is
unaffected.

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
