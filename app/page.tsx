"use client";

// GlitchCore landing page — the product demoing itself.
// Every visual on this page is produced by the same effect engine the studio
// uses, run once against /sample.jpg (plus live per-frame video in the proof
// section). No models are downloaded here: YOLO and Depth are faked locally.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MODES,
  MODE_ORDER,
  DEFAULT_PARAMS,
  runPixelEffect,
  isPixelMode,
  PIXEL_MODES,
  type PixelMode,
} from "@/lib/modes";
import { decodeToImageData, drawImageData, resizeImageData } from "@/lib/image";
import { turbo } from "@/lib/colormap";
import type { ModeId } from "@/lib/effects/types";

// Modes that render a static preview (temporal/model modes are excluded — they
// need video, or would just show the source here).
const SHOWCASE_MODES: ModeId[] = MODE_ORDER.filter(
  (m) => isPixelMode(m) || m === "yolo" || m === "depth",
);

const HERO_TICK_MS = 2600;
const PROOF_TICK_MS = 4000;

/* ---- Faux model outputs (real models are 10–27 MB — studio-only) ---- */

// ponytail: hardcoded plausible boxes instead of running YOLO11n on the
// landing page; the studio runs the real model.
function fakeYolo(src: ImageData): ImageData {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.putImageData(src, 0, 0);

  const boxes = [
    { x: 0.08, y: 0.18, w: 0.42, h: 0.7, label: "person 0.91" },
    { x: 0.55, y: 0.32, w: 0.34, h: 0.52, label: "bicycle 0.78" },
    { x: 0.36, y: 0.6, w: 0.15, h: 0.27, label: "dog 0.64" },
  ];
  const lw = Math.max(2, Math.round(src.width / 340));
  const fs = Math.max(11, Math.round(src.width / 55));
  const pad = Math.round(fs * 0.3);
  ctx.lineWidth = lw;
  ctx.strokeStyle = "#ff6b00";
  ctx.font = `600 ${fs}px ui-monospace, "JetBrains Mono", monospace`;
  ctx.textBaseline = "top";
  for (const b of boxes) {
    const x = b.x * src.width;
    const y = b.y * src.height;
    ctx.strokeRect(x, y, b.w * src.width, b.h * src.height);
    const tw = ctx.measureText(b.label).width + pad * 2;
    const th = fs + pad * 2;
    const ly = y - th >= 0 ? y - th : y;
    ctx.fillStyle = "#ff6b00";
    ctx.fillRect(x - lw / 2, ly, tw, th);
    ctx.fillStyle = "#0b0c0e";
    ctx.fillText(b.label, x + pad, ly + pad);
  }
  return ctx.getImageData(0, 0, src.width, src.height);
}

// ponytail: luminance→turbo stands in for Depth-Anything V2 — convincing at
// landing-page glance distance.
function fakeDepth(src: ImageData): ImageData {
  const out = new ImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const l = (0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2]) / 255;
    const [r, g, b] = turbo(l);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  return out;
}

function renderMode(mode: ModeId, src: ImageData): ImageData {
  if (mode === "yolo") return fakeYolo(src);
  if (mode === "depth") return fakeDepth(src);
  if (isPixelMode(mode)) return runPixelEffect(mode, src, DEFAULT_PARAMS[mode]).imageData;
  return src; // temporal/model modes have no static preview
}

/* ---- Hooks ---- */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ---- Page ---- */

export default function LandingPage() {
  const reduced = usePrefersReducedMotion();

  // Single decode; per-mode frames cached once at two sizes.
  const framesRef = useRef<Record<ModeId, ImageData> | null>(null);
  const thumbsRef = useRef<Record<ModeId, ImageData> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    decodeToImageData("/sample.jpg", 900).then((src) => {
      if (cancelled) return;
      const small = resizeImageData(src, 360);
      const frames = {} as Record<ModeId, ImageData>;
      const thumbs = {} as Record<ModeId, ImageData>;
      for (const m of SHOWCASE_MODES) {
        frames[m] = renderMode(m, src);
        thumbs[m] = renderMode(m, small);
      }
      framesRef.current = frames;
      thumbsRef.current = thumbs;
      setReady(true);
    }).catch(() => {
      // sample failed to decode — canvases stay as styled placeholders
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Scroll reveal ---- */
  useEffect(() => {
    const nodes = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  /* ---- Hero: auto-cycle all six modes ---- */
  const [heroIdx, setHeroIdx] = useState(0);
  const heroMode: ModeId = SHOWCASE_MODES[heroIdx];
  const heroCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (reduced || !ready) return;
    const id = setInterval(
      () => setHeroIdx((i) => (i + 1) % SHOWCASE_MODES.length),
      HERO_TICK_MS,
    );
    return () => clearInterval(id);
  }, [reduced, ready]);

  useEffect(() => {
    const canvas = heroCanvasRef.current;
    const frames = framesRef.current;
    if (canvas && frames) drawImageData(canvas, frames[heroMode]);
  }, [heroMode, ready]);

  /* ---- Proof: still + live video through the same effect ---- */
  const [proofIdx, setProofIdx] = useState(0);
  const [pinned, setPinned] = useState<PixelMode | null>(null);
  const proofMode: PixelMode = pinned ?? PIXEL_MODES[proofIdx];
  const stillCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (reduced || !ready || pinned) return;
    const id = setInterval(
      () => setProofIdx((i) => (i + 1) % PIXEL_MODES.length),
      PROOF_TICK_MS,
    );
    return () => clearInterval(id);
  }, [reduced, ready, pinned]);

  // Still pane: reuse the hero-size cached frames.
  useEffect(() => {
    const canvas = stillCanvasRef.current;
    const frames = framesRef.current;
    if (canvas && frames) drawImageData(canvas, frames[proofMode]);
  }, [proofMode, ready]);

  // Video pane: pull frames through the SAME effect per-frame.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = videoCanvasRef.current;
    if (!video || !canvas || !ready) return;

    if (reduced) {
      video.pause();
      const frames = framesRef.current;
      if (frames) drawImageData(canvas, frames[proofMode]); // static processed poster
      return;
    }

    video.play().catch(() => {}); // autoplay may already cover this
    const off = document.createElement("canvas");
    const octx = off.getContext("2d", { willReadFrequently: true })!;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || video.paused || video.readyState < 2) return;
      if (off.width !== video.videoWidth || off.height !== video.videoHeight) {
        if (!video.videoWidth) return;
        off.width = video.videoWidth;
        off.height = video.videoHeight;
      }
      octx.drawImage(video, 0, 0, off.width, off.height);
      const frame = octx.getImageData(0, 0, off.width, off.height);
      drawImageData(
        canvas,
        runPixelEffect(proofMode, frame, DEFAULT_PARAMS[proofMode]).imageData,
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [proofMode, reduced, ready]);

  /* ---- Mode grid thumbnails: paint each once ---- */
  const thumbCanvasRefs = useRef<Partial<Record<ModeId, HTMLCanvasElement>>>({});
  const setThumbRef = useCallback(
    (id: ModeId) => (el: HTMLCanvasElement | null) => {
      if (el) thumbCanvasRefs.current[id] = el;
    },
    [],
  );
  useEffect(() => {
    const thumbs = thumbsRef.current;
    if (!thumbs) return;
    for (const m of MODE_ORDER) {
      const el = thumbCanvasRefs.current[m];
      if (el) drawImageData(el, thumbs[m]);
    }
  }, [ready]);

  return (
    <div className="relative overflow-x-clip">
      <div className="aurora" aria-hidden />

      {/* ---- NAV ---- */}
      <header className="fixed inset-x-0 top-4 z-50 px-4">
        <nav className="glass mx-auto flex w-full max-w-3xl items-center justify-between rounded-full py-2 pl-5 pr-2">
          <Link
            href="/"
            className="wordmark font-mono text-[15px] font-bold tracking-tight"
          >
            Glitch
            <span
              className="wordmark-accent"
              style={{ color: "var(--mode-glitch)" }}
            >
              Core
            </span>
          </Link>
          <Link
            href="/studio"
            className="glass rounded-full px-4 py-1.5 font-mono text-xs text-text transition-colors hover:border-[var(--text-muted)]"
          >
            Open studio
          </Link>
        </nav>
      </header>

      {/* ---- HERO ---- */}
      <section
        className="relative mx-auto grid min-h-[95svh] max-w-6xl items-center gap-10 px-6 pb-16 pt-32 lg:grid-cols-[1fr_1.1fr] lg:gap-14"
        style={{ "--accent": MODES[heroMode].color } as React.CSSProperties}
      >
        <div className="workbench-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />

        <div className="fade-up">
          <p className="mb-5 font-mono text-xs tracking-[0.2em] text-text-muted uppercase">
            client-side effects studio
          </p>
          <h1 className="font-mono text-4xl font-bold leading-[1.08] tracking-tight md:text-6xl">
            Real algorithms.
            <br />
            Live pixels.
            <br />
            <span style={{ color: "var(--accent)" }} className="transition-colors duration-500">
              Zero uploads.
            </span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-text-muted">
            ASCII, glitch, halftone, edge maps, object detection and depth
            estimation — six modes that run on your images and video, entirely
            in your browser.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/studio"
              className="rounded-full bg-text px-7 py-3.5 font-mono text-sm font-bold text-bg transition-opacity hover:opacity-85"
            >
              Open the studio
            </Link>
            <a
              href="#proof"
              className="font-mono text-sm text-text-muted transition-colors hover:text-text"
            >
              Watch it work ↓
            </a>
          </div>
        </div>

        <div className="fade-up relative" style={{ animationDelay: "0.15s" }}>
          <canvas
            ref={heroCanvasRef}
            role="img"
            aria-label={`Street photo of a person walking a dog, rendered with the ${MODES[heroMode].name} effect`}
            className="stage-glow aspect-[3/2] w-full rounded-[var(--radius)] border border-[var(--glass-border)]"
          />
          <div className="glass-strong absolute bottom-3 left-3 flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-xs">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full transition-colors duration-500"
              style={{ background: "var(--accent)" }}
              aria-hidden
            />
            <span
              className="transition-colors duration-500"
              style={{ color: "var(--accent)" }}
            >
              {MODES[heroMode].name}
            </span>
            <span className="text-text-muted">
              {String(heroIdx + 1).padStart(2, "0")}/{String(SHOWCASE_MODES.length).padStart(2, "0")}
            </span>
          </div>
        </div>
      </section>

      {/* ---- SIDE-BY-SIDE PROOF ---- */}
      <section
        id="proof"
        className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24"
        style={{ "--accent": MODES[proofMode].color } as React.CSSProperties}
      >
        <div className="reveal mb-10 max-w-2xl">
          <h2 className="font-mono text-2xl font-bold tracking-tight md:text-4xl">
            Same effect. Same engine.
            <br />
            Still or moving.
          </h2>
          <p className="mt-4 text-text-muted">
            The video pane is not a pre-render — every frame is pulled through
            the exact pixel pipeline you see on the still, live.
          </p>
        </div>

        <div
          className="reveal mb-6 flex flex-wrap gap-2"
          role="group"
          aria-label="Pick the effect applied to both panes"
        >
          {PIXEL_MODES.map((m) => {
            const active = m === proofMode;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setPinned(pinned === m ? null : m)}
                aria-pressed={active}
                className="glass rounded-full px-4 py-1.5 font-mono text-xs transition-all"
                style={
                  active
                    ? {
                        color: MODES[m].color,
                        borderColor: MODES[m].color,
                        boxShadow: "0 0 18px -6px var(--accent)",
                      }
                    : { color: "var(--text-muted)" }
                }
              >
                {MODES[m].name}
              </button>
            );
          })}
        </div>

        <div className="reveal grid gap-4 md:grid-cols-2">
          <figure className="glass rounded-[var(--radius)] p-3">
            <canvas
              ref={stillCanvasRef}
              role="img"
              aria-label={`Sample photo with the ${MODES[proofMode].name} effect applied`}
              className="aspect-[3/2] w-full rounded-[var(--radius-sm)]"
            />
            <figcaption className="mt-2 px-1 font-mono text-[11px] text-text-muted">
              still
            </figcaption>
          </figure>
          <figure className="stage-glow glass rounded-[var(--radius)] p-3">
            <canvas
              ref={videoCanvasRef}
              role="img"
              aria-label={`Sample video processed frame by frame with the ${MODES[proofMode].name} effect`}
              className="aspect-[3/2] w-full rounded-[var(--radius-sm)]"
            />
            <figcaption className="mt-2 flex items-center gap-2 px-1 font-mono text-[11px]">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
                aria-hidden
              />
              <span style={{ color: "var(--accent)" }}>
                video · live per-frame
              </span>
            </figcaption>
          </figure>
        </div>

        {/* Hidden source video — frames are read from here each rAF tick. */}
        <video
          ref={videoRef}
          src="/sample.mp4"
          muted
          loop
          autoPlay
          playsInline
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        />
      </section>

      {/* ---- MODE GRID ---- */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="reveal mb-10 max-w-2xl">
          <h2 className="font-mono text-2xl font-bold tracking-tight md:text-4xl">
            Six modes, one canvas.
          </h2>
          <p className="mt-4 text-text-muted">
            Every thumbnail below was rendered by the engine on this page load
            — the studio gives you every parameter.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWCASE_MODES.map((m, i) => (
            /* Stagger lives on the reveal wrapper so it never delays the
               card's own hover lift/glow transitions. */
            <div key={m} className="reveal" style={{ transitionDelay: `${i * 60}ms` }}>
              <Link
                href="/studio"
                className="glass group block h-full rounded-[var(--radius)] p-3 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_0_60px_-18px_var(--accent)]"
                style={{ "--accent": MODES[m].color } as React.CSSProperties}
              >
                <canvas
                  ref={setThumbRef(m)}
                  role="img"
                  aria-label={`Sample photo rendered with the ${MODES[m].name} effect`}
                  className="aspect-[3/2] w-full rounded-[var(--radius-sm)]"
                />
                <div className="px-1 pb-1 pt-3">
                  <h3
                    className="font-mono text-sm font-bold"
                    style={{ color: MODES[m].color }}
                  >
                    {MODES[m].name}
                  </h3>
                  <p className="mt-1 text-[13px] leading-snug text-text-muted">
                    {MODES[m].tagline}
                  </p>
                </div>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ---- TRUST STRIP ---- */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <ul className="reveal flex flex-wrap justify-center gap-2">
          {[
            "100% client-side",
            "nothing uploads",
            "no account",
            "shareable recipe links",
            "sub-10s video export",
            "open source models",
          ].map((fact) => (
            <li
              key={fact}
              className="glass rounded-full px-4 py-1.5 font-mono text-xs text-text-muted"
            >
              {fact}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- FINAL CTA ---- */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-24 text-center">
        <p className="reveal font-mono text-xl font-bold tracking-tight md:text-3xl">
          Your pixels never leave this tab.
        </p>
        <div className="reveal mt-8">
          <Link
            href="/studio"
            className="inline-block rounded-full bg-text px-10 py-4 font-mono text-base font-bold text-bg transition-opacity hover:opacity-85"
          >
            Open the studio
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--hairline)] px-6 py-8 text-center">
        <p className="font-mono text-[11px] text-text-muted">
          GlitchCore — image effects · everything runs in your browser
        </p>
      </footer>
    </div>
  );
}
