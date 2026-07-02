"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CanvasStage, type Stats } from "@/components/CanvasStage";
import { ExportBar } from "@/components/ExportBar";
import { ModeRail } from "@/components/ModeRail";
import { ParamPanel } from "@/components/ParamPanel";
import { StackEditor } from "@/components/StackEditor";
import { UploadZone } from "@/components/UploadZone";
import { VideoStage, type VideoMeta } from "@/components/VideoStage";
import { MODES, makeStage, type ParamValue, type Stage } from "@/lib/modes";
import type { ModeId } from "@/lib/effects/types";
import { decodeToImageData, resizeImageData, type BlendMode } from "@/lib/image";
import { editorToUrl, readEditorFromLocation } from "@/lib/recipe";

export default function Home() {
  const [source, setSource] = useState<ImageData | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [sample, setSample] = useState<ImageData | null>(null);

  // The effect stack (>=1 layer) and which layer the panel/rail edits.
  const [chain, setChain] = useState<Stage[]>(() => [
    { id: "s0", mode: "ascii", params: { ...MODES.ascii.defaults }, opacity: 1, blend: "normal" },
  ]);
  const [selected, setSelected] = useState(0);
  const [asciiText, setAsciiText] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const baseRef = useRef<HTMLCanvasElement>(null);
  const didMount = useRef(false);
  const videoObjectUrl = useRef<string | null>(null);

  const current = chain[selected] ?? chain[0];
  const activeMode: ModeId = current.mode;
  const mode = MODES[activeMode];

  // Restore a shared stack from the URL on first load.
  useEffect(() => {
    const state = readEditorFromLocation();
    if (state) {
      setChain(state.chain);
      setSelected(state.selected);
    }
  }, []);

  // Keep the URL in sync with state (skip the first run so a shared link's query
  // survives until the user changes something). replaceState = no history spam.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    window.history.replaceState(null, "", editorToUrl({ chain, selected }));
  }, [chain, selected]);

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
      // decode failed — keep whatever we had.
    }
  };

  const loadVideo = (src: Blob, name: string) => {
    if (videoObjectUrl.current) URL.revokeObjectURL(videoObjectUrl.current);
    const url = URL.createObjectURL(src);
    videoObjectUrl.current = url;
    setSource(null);
    setAsciiText(null);
    setStats(null);
    setSample(null);
    setVideoName(name);
    setVideoMeta(null);
    setVideoUrl(url);
  };

  const openFile = (f: File) => {
    if (f.type.startsWith("video/")) loadVideo(f, f.name);
    else if (f.type.startsWith("image/")) loadImage(f, f.name);
  };

  useEffect(() => {
    loadImage("/sample.jpg", "sample.jpg");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Rail click sets the selected layer's effect (resetting its params).
  const selectMode = (m: ModeId) =>
    setChain((c) =>
      c.map((s, i) => (i === selected ? { ...s, mode: m, params: { ...MODES[m].defaults } } : s)),
    );

  const setParam = (key: string, value: ParamValue) =>
    setChain((c) =>
      c.map((s, i) => (i === selected ? { ...s, params: { ...s.params, [key]: value } } : s)),
    );

  const setOpacity = (v: number) =>
    setChain((c) => c.map((s, i) => (i === selected ? { ...s, opacity: v } : s)));

  const setBlend = (b: BlendMode) =>
    setChain((c) => c.map((s, i) => (i === selected ? { ...s, blend: b } : s)));

  const resetParams = () =>
    setChain((c) =>
      c.map((s, i) => (i === selected ? { ...s, params: { ...MODES[s.mode].defaults } } : s)),
    );

  const addStage = () => {
    setSelected(chain.length);
    setChain((c) => [...c, makeStage("edges")]);
  };

  const removeStage = (i: number) => {
    if (chain.length <= 1) return;
    setChain((c) => c.filter((_, j) => j !== i));
    setSelected((sel) => (i < sel ? sel - 1 : Math.min(sel, chain.length - 2)));
  };

  const moveStage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= chain.length) return;
    setChain((c) => {
      const n = [...c];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    setSelected((sel) => (sel === i ? j : sel === j ? i : sel));
  };

  const dims = source
    ? `${source.width}×${source.height}`
    : videoMeta
      ? `${videoMeta.width}×${videoMeta.height}`
      : null;
  const exportName = chain.length > 1 ? "stack" : activeMode;

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
        stackSize={chain.length}
        stats={source ? stats : null}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-[var(--hairline)] p-3 md:w-28 md:border-b-0 md:border-r md:overflow-y-auto">
          <ModeRail activeMode={activeMode} onSelect={selectMode} sample={sample} />
        </aside>

        <main className="relative min-h-0 flex-1">
          <div className="workbench-grid pointer-events-none absolute inset-0" />
          <div className="relative h-full">
            {videoUrl ? (
              <VideoStage
                url={videoUrl}
                stages={chain}
                exportName={exportName}
                onMeta={setVideoMeta}
                onSample={setSample}
              />
            ) : source ? (
              <CanvasStage
                source={source}
                stages={chain}
                baseRef={baseRef}
                onAsciiText={setAsciiText}
                onStats={setStats}
              />
            ) : (
              <UploadZone onImage={loadImage} onVideo={loadVideo} />
            )}
          </div>
        </main>

        <aside className="max-h-[42dvh] shrink-0 overflow-y-auto border-t border-[var(--hairline)] bg-[var(--surface)] p-4 md:max-h-none md:w-80 md:border-t-0 md:border-l">
          <StackEditor
            stages={chain}
            selected={selected}
            onSelect={setSelected}
            onAdd={addStage}
            onRemove={removeStage}
            onMove={moveStage}
          />
          <ParamPanel
            mode={mode}
            params={current.params}
            opacity={current.opacity ?? 1}
            blend={current.blend ?? "normal"}
            onOpacity={setOpacity}
            onBlend={setBlend}
            onChange={setParam}
            onReset={resetParams}
          />
        </aside>
      </div>

      <footer className="border-t border-[var(--hairline)] bg-[var(--surface)] px-4 py-3">
        <ExportBar
          exportName={exportName}
          baseRef={baseRef}
          asciiText={asciiText}
          recipeUrl={editorToUrl({ chain, selected })}
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
  stackSize,
  stats,
}: {
  onFile: (f: File) => void;
  dims: string | null;
  name: string;
  isVideo: boolean;
  duration: number | null;
  modeName: string;
  stackSize: number;
  stats: Stats | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 py-2.5">
      <div className="flex items-baseline gap-3">
        <span className="wordmark font-mono text-lg font-bold tracking-tight">
          Glitch
          <span className="wordmark-accent" style={{ color: "var(--accent)" }}>
            Core
          </span>
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
            {stackSize > 1 && <Readout label="stack" value={`${stackSize}`} />}
            {isVideo && duration !== null && (
              <Readout label="clip" value={`${duration.toFixed(1)}s`} />
            )}
            {stats && <Readout label="t" value={`${Math.round(stats.ms)}ms`} />}
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
