"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isPixelMode, isTemporalMode, runVideoChain, type Stage } from "@/lib/modes";
import { downloadBlob, drawImageData, resizeImageData } from "@/lib/image";

// ponytail: cap the working frame to 640px on its longest side and record at
// 25fps. Effects run per-frame on the CPU, so this keeps playback near real-time.
const MAX_SIDE = 640;
const FPS = 25;
const MAX_SECONDS = 10; // spec: short sub-10s clips
const HISTORY_MAX = 48; // frames kept for temporal effects (slit-scan / trails)

export type VideoMeta = { width: number; height: number; duration: number };

function pickMime(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const R = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  return R ? (candidates.find((c) => R.isTypeSupported(c)) ?? "") : "";
}

export function VideoStage({
  url,
  stages,
  exportName,
  onMeta,
  onSample,
}: {
  url: string;
  stages: Stage[];
  exportName: string;
  onMeta: (m: VideoMeta) => void;
  onSample: (s: ImageData) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const stagesRef = useRef(stages);
  stagesRef.current = stages;

  // Temporal state: a ring buffer of recent input frames + per-stage feedback.
  const historyRef = useRef<ImageData[]>([]);
  const prevOutRef = useRef<Map<string, ImageData>>(new Map());
  const frameIndexRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const recordable = pickMime() !== "";

  // Only true model stages are skipped on video; temporal stages run live.
  const hasModelStage = stages.some((s) => !isPixelMode(s.mode) && !isTemporalMode(s.mode));
  const lastPixel = [...stages].reverse().find((s) => isPixelMode(s.mode))?.mode;
  const pixelated = lastPixel === "ascii" || lastPixel === "halftone";

  // Draw the current video frame through the pixel stack onto the display canvas.
  const renderFrame = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    const off = offRef.current;
    if (!v || !c || !off || !off.width) return;
    const octx = off.getContext("2d", { willReadFrequently: true });
    if (!octx) return;
    octx.drawImage(v, 0, 0, off.width, off.height);
    const src = octx.getImageData(0, 0, off.width, off.height);
    const hist = historyRef.current;
    hist.push(src);
    if (hist.length > HISTORY_MAX) hist.shift();
    frameIndexRef.current += 1;
    const { imageData } = runVideoChain(src, stagesRef.current, {
      history: hist,
      prevOut: prevOutRef.current,
      frameIndex: frameIndexRef.current,
    });
    drawImageData(c, imageData);
  }, []);

  // Reset temporal buffers when the clip changes.
  useEffect(() => {
    historyRef.current = [];
    prevOutRef.current.clear();
    frameIndexRef.current = 0;
  }, [url]);

  // Drop feedback for stages that no longer exist.
  useEffect(() => {
    const ids = new Set(stages.map((s) => s.id));
    for (const k of [...prevOutRef.current.keys()]) {
      if (!ids.has(k)) prevOutRef.current.delete(k);
    }
  }, [stages]);

  const onLoadedMeta = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(1, Math.round(v.videoWidth * scale));
    const h = Math.max(1, Math.round(v.videoHeight * scale));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    offRef.current = off;
    setReady(true);
    onMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
  }, [onMeta]);

  const onLoadedData = useCallback(() => {
    renderFrame();
    const off = offRef.current;
    if (off && off.width) {
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (octx) onSample(resizeImageData(octx.getImageData(0, 0, off.width, off.height), 160));
    }
  }, [renderFrame, onSample]);

  // rAF drives frames while playing — drawImage(video) always reads the latest
  // decoded frame, so it's reliable in every browser.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      renderFrame();
      if (v.paused || v.ended) return;
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      setPlaying(true);
      loop();
    };
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [renderFrame]);

  // Re-render the current frame when the stack changes while paused.
  useEffect(() => {
    if (ready && videoRef.current?.paused) renderFrame();
  }, [stages, ready, renderFrame]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };

  const record = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || recording) return;
    const mime = pickMime();
    const stream = c.captureStream(FPS);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    const stopAt = Math.min(v.duration || MAX_SECONDS, MAX_SECONDS);

    const onTime = () => {
      setProgress(Math.min(1, v.currentTime / stopAt));
      if (v.currentTime >= stopAt) finish();
    };
    const finish = () => {
      v.removeEventListener("timeupdate", onTime);
      v.pause();
      if (rec.state !== "inactive") rec.stop();
    };

    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      downloadBlob(new Blob(chunks, { type: mime || "video/webm" }), `glitchcore-${exportName}.webm`);
      setRecording(false);
      setProgress(0);
    };

    v.currentTime = 0;
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", finish, { once: true });
    v.play();
    rec.start();
    setRecording(true);
  };

  return (
    <div className="relative grid h-full w-full grid-rows-[1fr_auto] gap-3 overflow-hidden p-4 sm:p-6">
      <div className="grid min-h-0 place-items-center">
        <canvas
          ref={canvasRef}
          className="checker stage-glow max-h-full max-w-full rounded-[var(--radius-sm)]"
          style={{ imageRendering: pixelated ? "pixelated" : "auto" }}
        />
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={onLoadedMeta}
          onLoadedData={onLoadedData}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
        {hasModelStage && (
          <span
            className="pointer-events-none absolute left-6 top-6 rounded-full border bg-[var(--surface)]/90 px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)]"
            style={{ borderColor: "color-mix(in srgb, var(--accent) 50%, transparent)" }}
          >
            model layers (YOLO / Depth) are skipped in video
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready || recording}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-40"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--hairline)]">
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${progress * 100}%`, background: "var(--accent)" }}
          />
        </div>

        <button
          type="button"
          onClick={record}
          disabled={!ready || recording || !recordable}
          className="btn-accent shrink-0 rounded-[var(--radius-sm)] px-3.5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          title={recordable ? `Record up to ${MAX_SECONDS}s to WebM` : "Recording isn't supported in this browser"}
        >
          {recording ? `Recording ${Math.round(progress * 100)}%` : "Export clip"}
        </button>
      </div>
    </div>
  );
}
