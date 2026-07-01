"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CanvasStage, type Stats } from "@/components/CanvasStage";
import { ExportBar } from "@/components/ExportBar";
import { ModeRail } from "@/components/ModeRail";
import { ParamPanel } from "@/components/ParamPanel";
import { UploadZone } from "@/components/UploadZone";
import { VideoStage, type VideoMeta } from "@/components/VideoStage";
import { DEFAULT_PARAMS, MODES, type Params, type ParamValue } from "@/lib/modes";
import type { ModeId } from "@/lib/effects/types";
import { decodeToImageData, resizeImageData } from "@/lib/image";
import { readRecipeFromLocation, recipeToUrl } from "@/lib/recipe";

function freshParams(): Record<ModeId, Params> {
  return Object.fromEntries(
    Object.entries(DEFAULT_PARAMS).map(([k, v]) => [k, { ...v }]),
  ) as Record<ModeId, Params>;
}

export default function Home() {
  const [source, setSource] = useState<ImageData | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [sample, setSample] = useState<ImageData | null>(null);
  const [activeMode, setActiveMode] = useState<ModeId>("ascii");
  const [params, setParams] = useState<Record<ModeId, Params>>(freshParams);
  const [asciiText, setAsciiText] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const didMount = useRef(false);
  const videoObjectUrl = useRef<string | null>(null);

  const mode = MODES[activeMode];

  // Restore a shared recipe (mode + params) from the URL on first load.
  useEffect(() => {
    const r = readRecipeFromLocation();
    if (r) {
      setActiveMode(r.mode);
      setParams(r.params);
    }
  }, []);

  // Keep the URL in sync with state (skip the first run so a shared link's query
  // survives until the user actually changes something). replaceState = no history spam.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    window.history.replaceState(null, "", recipeToUrl(activeMode, params));
  }, [activeMode, params]);

  const clearVideo = () => {
    if (videoObjectUrl.current) URL.revokeObjectURL(videoObjectUrl.current);
    videoObjectUrl.current = null;
    setVideoUrl(null);
    setVideoMeta(null);
  };

  const loadImage = async (src: Blob | string, name: string) => {
    try {
      const data = await decodeToImageData(src);
      clearVideo();
      setSource(data);
      setSourceName(name);
      setSample(resizeImageData(data, 160));
      setStats(null);
    } catch {
      // decode failed — keep whatever we had (upload zone stays if none).
    }
  };

  const loadVideo = (src: Blob, name: string) => {
    if (videoObjectUrl.current) URL.revokeObjectURL(videoObjectUrl.current);
    const url = URL.createObjectURL(src);
    videoObjectUrl.current = url;
    setSource(null);
    setAsciiText(null);
    setStats(null);
    setSample(null); // VideoStage supplies a first-frame sample once decoded
    setVideoName(name);
    setVideoMeta(null);
    setVideoUrl(url);
  };

  const openFile = (f: File) => {
    if (f.type.startsWith("video/")) loadVideo(f, f.name);
    else if (f.type.startsWith("image/")) loadImage(f, f.name);
  };

  // Auto-load the bundled sample so the tool demonstrates itself on first paint.
  useEffect(() => {
    loadImage("/sample.jpg", "sample.jpg");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paste an image from the clipboard anywhere in the app.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) loadImage(file, file.name || "pasted-image");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setParam = (key: string, value: ParamValue) =>
    setParams((p) => ({ ...p, [activeMode]: { ...p[activeMode], [key]: value } }));

  const resetParams = () =>
    setParams((p) => ({ ...p, [activeMode]: { ...MODES[activeMode].defaults } }));

  const dims = source
    ? `${source.width}×${source.height}`
    : videoMeta
      ? `${videoMeta.width}×${videoMeta.height}`
      : null;

  return (
    <div
      className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text)]"
      style={{ "--accent": mode.color } as CSSProperties}
    >
      <Header
        onFile={openFile}
        dims={dims}
        name={source ? sourceName : videoName}
        isVideo={!!videoUrl}
        duration={videoMeta?.duration ?? null}
        modeName={mode.name}
        stats={source ? stats : null}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-[var(--hairline)] p-3 md:w-28 md:border-b-0 md:border-r md:overflow-y-auto">
          <ModeRail activeMode={activeMode} onSelect={setActiveMode} sample={sample} />
        </aside>

        <main className="relative min-h-0 flex-1">
          <div className="workbench-grid pointer-events-none absolute inset-0" />
          <div className="relative h-full">
            {videoUrl ? (
              <VideoStage
                url={videoUrl}
                mode={activeMode}
                params={params[activeMode]}
                onMeta={setVideoMeta}
                onSample={setSample}
              />
            ) : source ? (
              <CanvasStage
                source={source}
                mode={activeMode}
                params={params[activeMode]}
                baseRef={baseRef}
                overlayRef={overlayRef}
                onAsciiText={setAsciiText}
                onStats={setStats}
              />
            ) : (
              <UploadZone onImage={loadImage} onVideo={loadVideo} />
            )}
          </div>
        </main>

        <aside className="shrink-0 border-t border-[var(--hairline)] bg-[var(--surface)] p-4 md:w-80 md:border-t-0 md:border-l md:overflow-y-auto">
          <ParamPanel
            mode={mode}
            params={params[activeMode]}
            onChange={setParam}
            onReset={resetParams}
          />
        </aside>
      </div>

      <footer className="border-t border-[var(--hairline)] bg-[var(--surface)] px-4 py-3">
        <ExportBar
          mode={activeMode}
          baseRef={baseRef}
          overlayRef={overlayRef}
          asciiText={asciiText}
          recipeUrl={recipeToUrl(activeMode, params)}
          canExportImage={!!source}
          isVideo={!!videoUrl}
        />
      </footer>
    </div>
  );
}

function Header({
  onFile,
  dims,
  name,
  isVideo,
  duration,
  modeName,
  stats,
}: {
  onFile: (f: File) => void;
  dims: string | null;
  name: string;
  isVideo: boolean;
  duration: number | null;
  modeName: string;
  stats: Stats | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 py-2.5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-lg font-bold tracking-tight">
          Glitch<span style={{ color: "var(--accent)" }}>Core</span>
        </span>
        <span className="hidden font-mono text-[11px] text-[var(--text-muted)] sm:inline">
          image effects
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-[var(--radius-sm)] border border-[var(--hairline)] px-2.5 py-1 font-mono text-[11px] text-[var(--text)] transition-colors hover:border-[var(--accent)]"
        >
          Open…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--text-muted)]">
        {dims ? (
          <>
            {isVideo && <Readout label="" value="▶ video" />}
            <Readout label="src" value={dims} />
            <Readout label="mode" value={modeName} />
            {isVideo && duration !== null && (
              <Readout label="clip" value={`${duration.toFixed(1)}s`} />
            )}
            {stats && <Readout label="t" value={`${Math.round(stats.ms)}ms`} />}
            {stats?.detections !== undefined && (
              <Readout label="det" value={`${stats.detections}`} />
            )}
            <span className="hidden max-w-[140px] truncate text-[var(--text-muted)]/70 lg:inline">
              {name}
            </span>
          </>
        ) : (
          <span>no media</span>
        )}
      </div>
    </header>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1">
      {label && <span className="text-[var(--text-muted)]/60">{label}</span>}
      <span className="text-[var(--text)]">{value}</span>
    </span>
  );
}
