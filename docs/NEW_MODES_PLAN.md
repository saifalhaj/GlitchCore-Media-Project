# GlitchCore — New Modes Plan (deep, cross-checkable)

> Working design doc for every candidate new **mode** in GlitchCore, plus the shared
> infrastructure they depend on. Every file/line reference below was checked against the
> current source so you can cross-check entry-by-entry. Nothing here is implemented yet —
> this is the plan.
>
> Provenance: reference analysis of four X/Contra design references + a frame-by-frame
> reverse-engineer of the UFC "detection HUD" video, then two multi-agent design passes
> (per-mode deep specs + adversarial codebase grounding + a completeness critic).

---

## 0. How to read this

- **Archetype** decides everything (does it run on video? does it need a model?). There are
  four — see §2.
- Each mode lists the **exact registration touchpoints**; the canonical checklist is in §3 and
  the full matrix is in the Appendix.
- Where the per-mode designer and the critic disagreed on *new mode vs extend existing*, both
  positions and a recommendation are given in that mode's **Verdict** line.

---

## 1. Current state (what already exists — for cross-check)

Six modes today, in `lib/modes.ts` `MODE_ORDER`:

| id | name | archetype | file | runs on video? |
|----|------|-----------|------|----------------|
| `ascii` | ASCII | sync-pixel | `lib/effects/ascii.ts` | ✅ |
| `glitch` | Glitchcore | sync-pixel | `lib/effects/glitch.ts` | ✅ |
| `yolo` | YOLO | async-model | `lib/effects/yolo.ts` | ❌ still-only |
| `halftone` | Halftone | sync-pixel | `lib/effects/halftone.ts` | ✅ |
| `edges` | Edge Map | sync-pixel | `lib/effects/edges.ts` | ✅ |
| `depth` | Depth | async-model | `lib/effects/depth.ts` | ❌ still-only |

Key facts (verified in source):

- `ModeId` union — `lib/effects/types.ts:5`.
- `Control` union has exactly **slider / select / toggle / seed** — `lib/modes.ts:16`. **No color or
  text control exists.**
- `PIXEL_MODES = ["ascii","glitch","halftone","edges"]` and `runPixelEffect` switch — `lib/modes.ts:192,209`.
- Model modes dispatch through `produceStage` (`lib/pipeline.ts:13`) and are **skipped on video**:
  `runPixelChain` does `if (!isPixelMode(s.mode)) continue` — `lib/modes.ts:243`. `VideoStage` shows a
  "model layers skipped" badge.
- Layer compositing is `blendImageData(result, source, opacity, blend)` — `lib/image.ts:116`; alpha 0 survives at opacity 1 + `normal`.
- Overlay/vector draw pattern: `drawDetectionsCtx` — `lib/image.ts:82`; bake pattern (`putImageData`→draw→`getImageData`) — `lib/effects/yolo.ts:212`.
- Deterministic PRNG `mulberry32` — `lib/effects/types.ts:83`; `luminance()` — `:72`; `turbo()` colormap — `lib/colormap.ts:9`; Sobel — `lib/effects/edges.ts`.
- Mode accent colors — `styles/tokens.css` (`--mode-ascii` … `--mode-depth`).
- Presets — `PRESETS: Record<ModeId, Preset[]>` in `lib/presets.ts`; `Preset = {name, params, opacity?, blend?}`.
- Recipe validation — `sanitizeParams` in `lib/recipe.ts:70` (branches per control kind).

---

## 2. The four mode archetypes

Every proposed mode falls into one bucket; the bucket dictates video support and infra.

| Archetype | Contract | Video? | Examples (existing → new) |
|-----------|----------|--------|---------------------------|
| **sync-pixel** | pure `(ImageData, params) => EffectResult`, stateless | ✅ real-time | ascii/glitch/halftone/edges → **vision, words, falsecolor, crt, contour, lowpoly, mirror, pixelate, posterize** |
| **async-model** | `async (ImageData, params) => Promise<ImageData>` via ONNX | ❌ still-only | yolo/depth → **cutout, pose, depth3d** |
| **temporal** *(new archetype)* | `(source, params, ctx:{history, prevOutput}) => EffectResult`; needs a frame buffer | ✅ video-only | *(none today)* → **slitscan, trails** |
| **overlay-vector** | sync-pixel that bakes vector marks over the frame (a style, not a separate bucket) | ✅ | drawDetectionsCtx pattern → **vision** (and still-only **pose**) |

> **Strategic split (from the critic):** the reference aesthetics — (a) surveillance HUD, (b)
> editorial dither/halftone, (c) word-raster, (d) glitch/vaporwave — are **all reachable as
> sync-pixel modes that run live on video.** The model-backed modes (cutout, pose, depth3d) are
> still-image companions and must not dominate the roadmap. Notably, **`vision` fakes detection
> procedurally, so it runs on video where real YOLO cannot** — that's the whole trick.

---

## 3. Canonical "add a mode" checklist (verified line refs)

**Every mode:**
1. `lib/effects/types.ts:5` — add id to `ModeId`.
2. `lib/effects/types.ts` — add `<Name>Params` type.
3. `lib/effects/<id>.ts` — the effect implementation.
4. `lib/modes.ts:48` — add to `MODE_ORDER`.
5. `lib/modes.ts:57` — add `MODES.<id>` (`{id,name,tagline,color,controls,defaults}`).
6. `lib/modes.ts:251` — add `DEFAULT_PARAMS.<id>`.
7. `styles/tokens.css` — add `--mode-<id>` accent.
8. `lib/presets.ts` — add `PRESETS.<id>`.

**Sync-pixel also:** `lib/modes.ts:192` add a `case` in `runPixelEffect`; `lib/modes.ts:209` add to
`PixelMode` type + `PIXEL_MODES`.

**Async-model also:** `lib/pipeline.ts:16` add an `else if (stage.mode === "<id>")` branch that
`await`s the loader; provide the ONNX loader file; it will **not** run on video.

**Temporal also:** requires the new frame-buffer infra (§4.5); register in a new `TEMPORAL_MODES`
set and the temporal dispatch.

`ModeRail`, `StackEditor`, `PresetPicker`, `ParamPanel` auto-discover from `MODES` — no edits.

---

## 4. Shared infrastructure (build Tier 0 first)

These small investments each unlock a *cluster* of modes. Sequence them before the modes that
depend on them.

### 4.1 `color` Control kind — **effort M**
Unlocks: vision colors, halftone/ascii custom ink+paper, falsecolor/duotone custom inks, words highlight, contour bands.
- `lib/modes.ts:16` — add `| { kind: "color"; key: string; label: string }` to `Control`.
- `components/ParamPanel.tsx` — add a `control.kind === "color"` branch **after the `select` branch (ends ~line 171)**: `<input type="color" value={value} onChange={e=>onChange(e.target.value)}>` + a mono hex readout. (Native color input yields lowercase `#rrggbb`, no alpha — exactly what effects want.)
- `lib/recipe.ts:70` — add a `color` coercion branch validating `#rrggbb`, else fall back to default (URL-recipe safety).

### 4.2 `text` Control kind — **effort S**
Unlocks: words `vocabulary`, any future caption/type mode.
- `lib/modes.ts:16` — `| { kind: "text"; key; label; placeholder?; maxLen? }` (default `maxLen` 120).
- `components/ParamPanel.tsx` — `<input type="text">` (or `<textarea>` for multiline); **must be debounced** — the chain re-runs on every keystroke.
- `lib/recipe.ts:70` — coercion with a hard length cap so base64url recipes stay bounded.

### 4.3 `lib/color.ts` hex utils — **effort S**
`hexToRgb`, `rgbToHex`, `normalizeHex(v, fallback)`. Used by 4.1's coercion and every color-aware
effect (`hexToRgb(params.inkColor) ?? INK_FALLBACK`).

### 4.4 Dissolve / coverage-mask primitive `lib/mask.ts` — **effort L**
The "editorial dissolve" (dots/words thin to transparent at edges). Used by halftone, ascii, words.
- `buildCoverage(src, {source:"none"|"luminance"|"radial"|"subject", amount, falloff, subjectMask?}) => Float32Array` in `[0,1]` (0 = drop→transparent).
- Effects multiply their per-mark alpha by the coverage value. Alpha 0 already survives the pipeline (`blendImageData` returns the effect untouched at opacity 1 + `normal`).

### 4.5 Temporal frame-history / feedback buffer — **effort L**
The single dependency for **slitscan** + **trails**. Today the pipeline is stateless
(`runPixelChain` is pure; `VideoStage.renderFrame` rebuilds `src` each frame).
- `lib/effects/types.ts` — `type FrameContext = { history: ImageData[]; prevOutput: ImageData|null; frameIndex: number }` and `TemporalPixelFn<P>`.
- `lib/modes.ts` — `TEMPORAL_MODES` set + `isTemporalMode` + a temporal dispatch alongside `runPixelEffect`.
- `components/VideoStage.tsx` — own a small ring buffer of recent input frames + per-stage `prevOutput`; pass a `FrameContext` into the chain. Degrade to identity on the still path (no history).

### 4.6 Generic ONNX model-runner `lib/effects/modelSession.ts` — **effort M**
`yolo.ts` and `depth.ts` `getSession()` are near-identical (cached promise, wasmPaths CDN pin,
HEAD-check → `MODEL_UNAVAILABLE`, webgpu→wasm fallback). Factor it so **cutout** and **pose**
reuse it verbatim. Refactor yolo/depth onto it (no behavior change).

### 4.7 Custom ink/paper/transparent-paper retrofit for Halftone + ASCII — **effort M**
The **editorial-dither upgrade** (references b + c). Halftone hardcodes `INK/PAPER/SHADOW/HIGHLIGHT`
(`halftone.ts:10-13`); ASCII hardcodes bg `#0b0c0e` + fg. Add `inkColor/paperColor/paperMode` params
(defaults preserve today's look so existing recipes are unchanged), resolve via `lib/color.ts`.
Combined with 4.4 this reproduces the Praveen/Hex/Autumn single-ink dither. **Note:** halftone
*already* implements Floyd–Steinberg + Bayer + dot-halftone — so the "dither look" is a
**color+dissolve upgrade to halftone, not a new mode** (see §7 reconciliation).

---

## 5. Mode roster overview

Legend — **V** = runs on video, **⚙** = needs ONNX model, **▲** = needs new infra.

| # | id | name | archetype | V | ⚙ | ▲ | effort | tier |
|---|----|------|-----------|---|---|---|--------|------|
| 1 | `vision` | Detection HUD / Vision | sync-pixel (overlay) | ✅ | – | color(opt) | M | **1 ⭐** |
| 2 | `words` | Word Raster | sync-pixel | ✅ | – | text | M | 2 |
| 3 | `falsecolor` | False-color / Gradient-map (thermal+duotone) | sync-pixel | ✅ | – | color(opt) | S | 1 |
| 4 | `crt` | CRT / VHS | sync-pixel | ✅ | – | – | M | 1 |
| 5 | `contour` | Contour / Topographic | sync-pixel | ✅ | – | – | M | 2 |
| 6 | `lowpoly` | Low-Poly / Voronoi | sync-pixel | ✅ | – | – | M | 3 |
| 7 | `mirror` | Kaleidoscope | sync-pixel | ✅ | – | – | S | 1 |
| 8 | `pixelate` | Pixelate / Mosaic | sync-pixel | ✅ | – | – | S | 1 |
| 9 | `posterize` | Posterize / Threshold | sync-pixel | ✅ | – | color(opt) | S | 2 |
| 10 | `slitscan` | Slit-Scan | temporal | ✅ | – | frame-buf | L | 3 |
| 11 | `trails` | Trails / Feedback | temporal | ✅ | – | frame-buf | M | 3 |
| 12 | `pose` | Pose / Skeleton | async-model | ❌ | ✅ | model-runner | M | 4 |
| 13 | `depth3d` | Depth 3D | async-model | ❌ | reuse depth | – | L | 4 |
| 14 | `cutout` | Cutout / Matte | async-model | ❌ | ✅ | model-runner | L | 4 |

Plus **existing-mode upgrades** (not new modes): Halftone + ASCII custom ink/paper/dissolve (§4.4, §4.7).

---

## 6. Per-mode deep specs

### 6.1 `vision` — Detection HUD / Vision ⭐ (flagship)

**Tagline:** "Fake real-time object-detection HUD — an AI is watching." **Archetype:** sync-pixel
(overlay-vector). **Video:** ✅ real-time. **Model:** none (the point — it *fakes* detection so it
runs where real YOLO can't). **Verdict:** NEW mode, do **not** bolt onto YOLO (YOLO is async + video-skipped).

Reverse-engineered from the reference clip (720×1280, 7.36 s, 30 fps). Verified facts:
- **Full density from frame 0, no intro/outro.**
- **Hybrid, not pure flicker:** a *persistent tracked core* of boxes whose integer IDs stay locked to
  a body feature across frames (e.g. `294` upper back, `261` head) **plus** a large *churning ephemeral*
  population that pops in/out. Labels are decorative but **stable per box**.
- **Connectors are hub-and-spoke**, fanning from a knot on the near fighter's torso/hip — **not** a
  Delaunay mesh; most peripheral boxes have zero links.
- **Accents:** translucent **cyan fills** (~35–50%) + a few **solid gray label chips**.
- **"Pink" lines are an illusion** — one white pigment at reduced alpha; red cloth shows through.
  Reproduce by drawing lines with `globalAlpha < 1`, **not** a pink stroke.

**Algorithm (`lib/effects/vision.ts`, per frame):**
1. Bake source to an offscreen canvas (yolo `detectAndBake` pattern).
2. **Flicker bucket:** `bucket = floor(Date.now()/(1000/flickerRate))`; ephemeral RNG seeded `seed^bucket`, core seeded `seed` (survives buckets). (Animates on video via rAF; static-but-coherent on stills.)
3. **Node placement by `anchor`:** `random` | `energy` (default — a cheap Sobel/luma saliency map, reuse `edges.ts` kernel, CDF-sample nodes onto high-detail regions so they stick to the fighters) | `yolo` (still-only realism, §6.14).
4. **Boxes:** size log-uniform `boxMinPx…boxMaxPx` (wide spread), `jitter` per-frame offset; core nodes get stable IDs, ephemeral get `seed^bucket^i`.
5. **Connectors:** pick `hubCount` highest-energy hubs; link each to nearest nodes within `maxLinkDist × diag`; leave the rest unconnected. Draw at `lineOpacity < 1` (pink illusion).
6. **Accents:** prob `accentProb` → cyan fill (bias to hub-adjacent); prob `chipProb` → gray chip + dark text.
7. Return baked `ImageData`; stage opacity/blend composite for free.

**Params:** `density`(40,5–120) · `coreFraction`(.35) · `boxMinPx`(14) · `boxMaxPx`(130) · `jitter`(.35) · `flickerRate`(10 Hz) · `connectorCount`(26) · `hubCount`(2) · `maxLinkDist`(.55) · `connectorTopology`(select hubSpoke/…) · `accentProb`(.12) · `chipProb`(.10) · `labelDigits`(3) · `nodeMarkers`(toggle) · `strokeWidth`(1) · `anchor`(select energy/random/yolo) · `seed` · **colors** `boxColor/lineColor/accentColor` (ship as select swatches; upgrade to §4.1 color) + `boxOpacity/lineOpacity/accentOpacity`.

**New draw helper:** `drawHudCtx(ctx, imgW, nodes, links, opts)` beside `drawDetectionsCtx` in `lib/image.ts` (`drawDetectionsCtx` is too YOLO-specific to overload).

**Presets:** *Surveillance* (reference look) · *Targeting/Threat* (fewer bold boxes, red accent, nodeMarkers) · *Swarm* (density 100, flicker 20, jitter .6) · *Ghost HUD* (low opacity, stage screen @ .5).

**Effort:** M (S to register + M for `vision.ts`/`drawHudCtx`). Recommended first slice: register with `anchor=random` + a minimal knob set + the Surveillance preset, confirm it records over video via the existing `runPixelChain`/`VideoStage` path (no VideoStage edits), then add color/accents/energy-anchoring.

---

### 6.2 `words` — Word Raster (sync-pixel, effort M)

**Tagline:** "Semantic ASCII — the image as a grid of whole words, toned by opacity, dissolving at the edges." **Video:** ✅. **Model:** none. **Verdict:** NEW mode (a *fork* of `ascii.ts`), needs the `text` control (§4.2). *(Critic wanted it as an ASCII extension; designer's case wins — opposite aesthetic (light paper + warm highlight vs dark terminal), own presets/accent, and merging bloats `AsciiParams` with 6 irrelevant controls.)*

**Inspiration:** Anthropic "global workspace" word-mosaic illustrations.

**Algorithm:** fork ascii's block-average luminance sampler (`ascii.ts:52-70`); wide cells (`rowAspect ~0.5`); per cell → `ink = 1-norm` drives **opacity or font-weight** (never glyph choice); pick a word from the vocabulary pool; **edge dissolve** drops cells toward the border (`dropProb = dissolve·edgeDist·(…)`); brightest cells use the highlight color; keep `EffectResult.text` for copy-as-text.

**Params:** `vocabulary`(**text**) · `source`(vocab/numbers/lorem) · `columns`(48) · `toneMode`(opacity/weight) · `highlight`(select swatch) · `highlightThreshold`(.72) · `dissolve`(.6) · `paper`(cream/white/dark/transparent) · `invert` · `seed`.

**Presets:** *Workspace* (Anthropic homage) · *Ledger* (numbers) · *Manifesto* (dark, dense) · *Whisper* (transparent, screen).

**Perf caveat:** many `measureText`/`fillText` per frame — keep default columns modest for video.

---

### 6.3 `falsecolor` — False-color / Gradient-map (sync-pixel, effort S) — *merges thermal + duotone*

**Tagline:** "Luminance mapped through a thermal/duotone ramp — predator vision & single-ink looks." **Video:** ✅. **Model:** none. **Verdict:** NEW mode, unifying the designer's `thermal` with the critic's `duotone`/`gradient-map` (all are "map luma → a color ramp"). Reuse `lib/colormap.ts`.

**Algorithm:** per pixel `t = clamp(luminance·gain + bias)`; optional `levels` quantize (isotherm bands / posterized duotone); map `t` through `palette`: `ironbow`/`whitehot`/`medical` (thermal) or a **2-stop shadow→highlight ink lerp** (duotone) or `turbo`; `invert` for black-hot. Duotone inks want §4.1 color (ship with named swatches first).

**Params:** `palette`(ironbow/whitehot/medical/turbo/duotone) · `gain`(1.4) · `bias`(0) · `levels`(0=off) · `invert` · (later) `shadowColor`/`highlightColor` color pickers.

**Presets:** *Ironbow* · *White-hot* · *Black-hot recon* · *Isotherm bands* · *Cobalt duotone* (editorial single-ink).

> This is the cleanest way to deliver reference-(b) "editorial single-ink" *and* the surveillance
> thermal look with one small mode instead of two.

---

### 6.4 `crt` — CRT / VHS (sync-pixel, effort M)

**Tagline:** "Analog TV death: phosphor mask, chroma bleed, curved glass, rolling tracking error, snow." **Video:** ✅. **Model:** none. **Verdict:** NEW mode (analog-signal sim ≠ glitch's digital corruption) **but factor a shared scanline/chroma primitive** so it doesn't duplicate glitch's `scanlineOpacity`.

**Algorithm (seeded, per frame):** barrel/curved-glass resample → YCbCr chroma-bandwidth bleed → phosphor mask (shadow-mask / aperture-grille) → scanlines → vignette → animated roll/tracking tear → noise/snow.

**Params:** `maskType`(none/aperture-grille/shadow-mask) · `maskDepth` · `chromaBleed` · `scanlineIntensity` · `barrel` · `vignette` · `noise` · `rollSpeed` · `tracking` · `seed`.

**Presets:** *Broadcast VHS* · *Trinitron PVM* · *Dead Channel* · *Camcorder ’92*.

---

### 6.5 `contour` — Contour / Topographic (sync-pixel, effort M)

**Tagline:** "Luminance quantized into elevation bands, boundaries traced as iso-lines." **Video:** ✅. **Model:** none. **Verdict:** designer says NEW mode (level-set operator genuinely ≠ Edge Map's Sobel gradient); critic says make it an *iso render-style of `edges`*. **Recommendation:** ship as a NEW mode (distinct params: `levels/fill/palette`), but if you prefer minimalism, an `edges` `style: gradient|iso` select is a valid alternative.

**Algorithm:** luma buffer → optional box-blur (`smoothing`, crucial to stop video shimmer) → quantize to `levels` bands → mark pixels where band changes vs right/bottom neighbor → dilate by `lineWidth` → fill by `fill`(none/banded/source), color by `palette`(mono/turbo/ink/terrain, reuse `colormap.ts`).

**Presets:** *Topo map* (terrain) · *Contour lines* (mono, over photo @ multiply) · *Elevation heat* (turbo) · *Blueprint* (invert).

---

### 6.6 `lowpoly` — Low-Poly / Voronoi (sync-pixel, effort M)

**Tagline:** "Shatters the image into flat-shaded triangles snapped to its own edges." **Video:** ✅ (needs a coarse grid to hold 25 fps — the one perf watch item). **Model:** none. **Verdict:** NEW mode.

**Algorithm:** sample feature points (edge-biased via Sobel + `jitter`, seeded) → triangulate (Delaunay) or Voronoi cells → fill each cell with its average/centroid source color → optional wireframe `outline`.

**Params:** `density`(18) · `jitter`(.7) · `edgeBias`(.6) · `cellShape`(triangle/voronoi) · `colorSampling`(average/centroid) · `outline`(0–2) · `seed`.

**Presets:** *Crystal* · *Facet + wire* · *Voronoi shards* · *Stained glass*.

---

### 6.7 `mirror` — Kaleidoscope (sync-pixel, effort S) — quick win

**Tagline:** "Fold any frame into a kaleidoscope — mirror & rotational symmetry." **Video:** ✅. **Model:** none. **Verdict:** NEW mode (pure coordinate remap; composes on top of other stages).

**Algorithm:** for each output pixel, map into a wedge of angular width `2π/segments` about `(centerX,centerY)`, reflect into the base wedge, `zoom`/rotate by `angle`, sample source. `pattern`: kaleido / quad-mirror / mirror-x/y.

**Params:** `pattern` · `segments`(8) · `angle` · `centerX`(.5) · `centerY`(.5) · `zoom`(1.3).

**Presets:** *Mandala* · *Quad fold* · *Hexascope* · *Prism split* (screen over glitch).

---

### 6.8 `pixelate` — Pixelate / Mosaic (sync-pixel, effort S) — quick win *(critic-added)*

**Tagline:** "Block-average mosaic — the classic censor/vaporwave pixelation." **Video:** ✅. **Model:** none. **Verdict:** NEW mode; near-zero effort; conspicuously missing next to lowpoly.

**Algorithm:** downsample to `blockSize` blocks (average or nearest), upscale nearest; optional `shape`(square/hex/dot-grid), optional subject-only via §4.4 mask.

**Params:** `blockSize`(12) · `shape`(square/hex/circle) · `smooth`(toggle) · `outline`(grid lines toggle).

**Presets:** *Censor* · *Vaporwave blocks* · *Bayer dot-grid* · *Chunky hex*.

---

### 6.9 `posterize` — Posterize / Threshold (sync-pixel, effort S) *(critic-added)*

**Tagline:** "Hard tonal banding / 2-tone silk-screen poster." **Video:** ✅. **Model:** none. **Verdict:** NEW mode *or* a `levels` style inside `falsecolor` — **recommend folding into `falsecolor`** (it's the `levels` param + a 2-color duotone), to avoid a near-duplicate. Keep on the list only if you want a dedicated protest-poster preset surface.

---

### 6.10 `slitscan` — Slit-Scan (temporal, effort L)

**Tagline:** "Every row is a different moment — motion smears across time." **Video:** ✅ (only meaningful on video). **Model:** none. **Infra:** requires the frame-history buffer (§4.5). **Verdict:** NEW temporal mode — cannot fit the pure `(source,params)` contract; the real work is the buffer infra.

**Algorithm:** output row/column band `k` samples from `history[clamp(k·span/… )]`; `axis`(rows/cols), `direction`, `curve`(linear/wave/center-out), `bandHeight`, `freeze`.

**Presets:** *Time smear* · *Melt* (wave) · *Wave curtain* · *Frozen echo*.

---

### 6.11 `trails` — Trails / Feedback (temporal, effort M)

**Tagline:** "Feedback echo & datamosh smear — each frame decays into the next." **Video:** ✅. **Model:** none. **Infra:** frame-history/`prevOutput` buffer (§4.5, shared with slitscan). **Verdict:** NEW temporal mode; don't fold into glitch (glitch must stay stateless).

**Algorithm:** `out = blend(current, decay(prevOutput, persistence), trailBlend)`; optional directional `smearPx`; optional frame-difference highlight (`diffHighlight`, `diffTint` select).

**Presets:** *Light trails* (lighten) · *Datamosh smear* (screen + smear) · *Ghost dissolve* (onion-skin) · *Motion scanner* (diff highlight).

---

### 6.12 `pose` — Pose / Skeleton (async-model, effort M) — still-only

**Tagline:** "Real human keypoint skeletons — joints & bones as a HUD-styled overlay." **Video:** ❌ (model-skipped + per-frame inference over budget). **Model:** MoveNet MultiPose Lightning ONNX (~5–9 MB). **Verdict:** NEW mode; pairs with `vision` (real skeleton on stills, faked HUD on video).

**Algorithm:** mirror depth/yolo loader (via §4.6 model-runner); letterbox → int32 256×256 tensor (the one I/O wrinkle: not float-normalized); decode `[1,6,56]` → 6×COCO-17 keypoints; inverse-letterbox to source px; bake with a new `drawSkeletonCtx` beside `drawDetectionsCtx` (COCO-17 bone edge list; joints as dots).

**Params:** `minKeypointScore`(.3) · `jointRadius`(4) · `boneWidth`(3) · `colorScheme`(accent/thermal/mono) · `showJoints` · `showConfidence`.

**Presets:** *Skeleton* · *Wireframe* · *Mocap HUD* (thermal) · *Ghost rig*.

**Risk:** sourcing a clean ONNX export of MoveNet (ships TF/TFLite) + the letterbox coordinate mapping.

---

### 6.13 `depth3d` — Depth 3D (async-model, reuse depth model, effort L) — still-only

**Tagline:** "Monocular depth reprojected into parallax, anaglyph, dot-terrain, or fog." **Video:** ❌ (model-backed; and parallax "wiggle" would need an animation loop = temporal infra). **Model:** reuses existing `depth-anything-v2-small.onnx` (no new download). **Verdict:** NEW mode sharing a `computeDepthField()` refactor of `depth.ts`; critic prefers a *render-style of `depth`* — either is fine, keep it low priority.

**Algorithm:** compute depth field once (refactor `estimateDepth` → `computeDepthField` so both share the session); then `style`: **parallax** (horizontal displacement by depth, edge-clamp gaps) · **anaglyph** (stereo red/cyan) · **pointcloud** (depth-sized dots, far→near paint, optional `displaceY` terrain) · **fog** (lerp to `fogTone` by far-ness — cheapest, highest-value).

**Params:** `style` · `strength` · `viewAngle` · `density` · `dotSize` · `displaceY` · `fogTone` · `fogDensity` · `background` · `invert`.

**Presets:** *Parallax pop* · *Anaglyph 3D* · *Dot terrain* · *Depth fog*.

**Note:** possible follow-up — cache the depth field in a `WeakMap` keyed by source and add a *sync* `depth3d-restyle` companion that animates fog/parallax on video with zero inference.

---

### 6.14 `cutout` — Cutout / Matte (async-model, effort L) — still-only

**Tagline:** "In-browser subject isolation — transparent, spotlight, or solid background." **Video:** ❌ (model-skipped; RMBG @1024² far over the video budget). **Model:** RMBG-1.4 ISNet ONNX (~44 MB quantized; U²Netp ~4.5 MB lighter fallback). **Verdict:** NEW mode; **enables the isolated-subject halftone look** — the user stacks Cutout (below) + Halftone/Edges (above); transparent regions carry through `blendImageData`. Also the `subjectMask` source for §4.4 dissolve.

**Algorithm:** mirror `depth.ts` loader (via §4.6); ISNet-normalize @1024²; min/max-normalize the alpha matte; stretch to source; `matteThreshold` smoothstep + `feather` box-blur; composite by `output`: transparent (`destination-in` matte) / spotlight (blurred+dimmed bg plate) / solid (`bgColor` swatch, later §4.1 color).

**Params:** `output` · `matteThreshold` · `feather` · `bgBlur` · `bgDim` · `bgColor` · `invert`.

**Presets:** *Clean cutout* · *Studio white* · *Green screen* · *Spotlight*.

---

## 7. Reconciliation — designer vs critic (read before building)

| Topic | Designer | Critic | **Recommendation** |
|-------|----------|--------|--------------------|
| **"dither" as a new mode** | (n/a) | add Floyd–Steinberg/Bayer mode | **Reject as new mode** — halftone *already* has FS + Bayer + dot-halftone (`halftone.ts`). The gap is **color + dissolve**, delivered by §4.7 + §4.4. Cross-check win. |
| **thermal vs duotone** | separate `thermal` | make a generic falsecolor/gradient-map | **Merge → `falsecolor`** (§6.3) covering thermal + duotone + gradient-map. |
| **words** | new mode | extend ascii | **New mode** (fork of ascii) — opposite aesthetic, own presets; needs `text` control. |
| **contour** | new mode | iso-style of edges | **New mode** (cleaner params); edges-`style` is an acceptable minimalist alt. |
| **posterize** | new mode | (—) | **Fold into `falsecolor`** `levels`; keep standalone only for a poster preset surface. |
| **crt** | new mode | extend glitch | **New mode + shared scanline/chroma primitive** so no duplication. |
| **depth3d** | new mode | render-style of depth | **New mode** sharing `computeDepthField`; low priority. |
| **trails + slitscan** | two modes | one shared buffer | **Agree** — build §4.5 once, two modes consume it. |
| **pose/cutout/depth3d on video** | still-only | still-only | **Agree** — position as still-only companions to `vision`; never force onto the video path. |

---

## 8. Priority roadmap

**Tier 0 — infra (unblocks clusters):**
`color` control (§4.1) · `text` control (§4.2) + `lib/color.ts` (§4.3) — do together, same 3 files ·
temporal frame buffer (§4.5) · model-runner (§4.6, when starting model modes).

**Tier 1 — quick wins, all sync/video, ship first:**
`vision` ⭐ (reference-a hero, video-safe) · `falsecolor` (reuse colormap) · `mirror` · `pixelate` ·
`crt` (extend glitch's scanline) · **Halftone/ASCII editorial upgrade** (§4.7 + §4.4).

**Tier 2 — editorial + structural sync modes:**
`words` (needs text) · `contour` · (posterize folded into falsecolor).

**Tier 3 — heavier sync + temporal:**
`lowpoly` (coarse grid for 25 fps) · `trails` then `slitscan` (consume §4.5).

**Tier 4 — still-only model companions:**
`pose` (cheapest useful model, best `vision` synergy) · `depth3d` (reuse depth) · `cutout` (heaviest, lowest priority).

**Recommended first slice (one week of visible wins):** Tier-0 color/text → `vision` (minimal knobs
+ Surveillance preset, verify it records over video) → `falsecolor` → `mirror`/`pixelate` → the
Halftone color+dissolve upgrade. That lands the surveillance hero + the editorial-ink look + two
toys, all real-time on video, before touching a single model.

---

## Appendix — cross-check touchpoint matrix

For each new mode, the files to edit (beyond creating `lib/effects/<id>.ts` and its `<Name>Params` in
`lib/effects/types.ts`). ✔ = required.

| touchpoint | vision | words | falsecolor | crt | contour | lowpoly | mirror | pixelate | slitscan | trails | pose | depth3d | cutout |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `types.ts:5` ModeId | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `modes.ts:48` MODE_ORDER | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `modes.ts:57` MODES entry | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `modes.ts:251` DEFAULT_PARAMS | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `modes.ts:192` runPixelEffect case | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | – | – | – |
| `modes.ts:209` PIXEL_MODES | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | – | – | – |
| temporal dispatch (§4.5) | – | – | – | – | – | – | – | – | ✔ | ✔ | – | – | – |
| `pipeline.ts:16` async branch | – | – | – | – | – | – | – | – | – | – | ✔ | ✔ | ✔ |
| `styles/tokens.css` --mode-* | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `presets.ts` PRESETS | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `image.ts` new draw helper | drawHudCtx | – | – | – | – | – | – | – | – | – | drawSkeletonCtx | – | – |
| new Control (color/text) | color* | text | color* | – | – | – | – | – | – | – | – | – | – |
| ONNX asset in `/public/models` | – | – | – | – | – | – | – | – | – | – | ✔ | reuse | ✔ |
| new infra dependency | – | §4.2 | – | shared scanline | – | – | – | – | §4.5 | §4.5 | §4.6 | depth refactor | §4.6 |

`*` color control optional for v1 (ship with select swatches first).

---

*End of plan. Modes and infra are sequenced so each Tier-0 investment is paid back by the Tier-1
modes that depend on it; the surveillance HUD + editorial-ink upgrade are the highest value-to-effort
and should ship first.*
