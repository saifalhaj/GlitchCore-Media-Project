"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CanvasStage, type Stats } from "@/components/CanvasStage";
import { ExportBar } from "@/components/ExportBar";
import { ModeRail } from "@/components/ModeRail";
import { ParamPanel } from "@/components/ParamPanel";
import { UploadZone } from "@/components/UploadZone";
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
  const [sample, setSample] = useState<ImageData | null>(null);
  const [activeMode, setActiveMode] = useState<ModeId>("ascii");
  const [params, setParams] = useState<Record<ModeId, Params>>(freshParams);
  const [asciiText, setAsciiText] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const didMount = useRef(false);

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

  const loadImage = async (src: Blob | string, name: string) => {
    try {
      const data = await decodeToImageData(src);
      setSource(data);
      setSourceName(name);
      setSample(resizeImageData(data, 160));
      setStats(null);
    } catch {
      // decode failed — keep whatever we had (upload zone stays if none).
    }
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

  return (
    <div
      className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text)]"
      style={{ "--accent": mode.color } as CSSProperties}
    >
      <Header source={source} sourceName={sourceName} modeName={mode.name} stats={stats} />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-[var(--hairline)] p-3 md:w-28 md:border-b-0 md:border-r md:overflow-y-auto">
          <ModeRail activeMode={activeMode} onSelect={setActiveMode} sample={sample} />
        </aside>

        <main className="relative min-h-0 flex-1">
          <div className="workbench-grid pointer-events-none absolute inset-0" />
          <div className="relative h-full">
            {source ? (
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
              <UploadZone onImage={(b, n) => loadImage(b, n)} />
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
          disabled={!source}
        />
      </footer>
    </div>
  );
}

function Header({
  source,
  sourceName,
  modeName,
  stats,
}: {
  source: ImageData | null;
  sourceName: string;
  modeName: string;
  stats: Stats | null;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 py-2.5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-lg font-bold tracking-tight">
          Glitch<span style={{ color: "var(--accent)" }}>Core</span>
        </span>
        <span className="hidden font-mono text-[11px] text-[var(--text-muted)] sm:inline">
          image effects
        </span>
      </div>

      <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--text-muted)]">
        {source ? (
          <>
            <Readout label="src" value={`${source.width}×${source.height}`} />
            <Readout label="mode" value={modeName} />
            {stats && <Readout label="t" value={`${Math.round(stats.ms)}ms`} />}
            {stats?.detections !== undefined && (
              <Readout label="det" value={`${stats.detections}`} />
            )}
            <span className="hidden max-w-[140px] truncate text-[var(--text-muted)]/70 lg:inline">
              {sourceName}
            </span>
          </>
        ) : (
          <span>no image</span>
        )}
      </div>
    </header>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-[var(--text-muted)]/60">{label}</span>
      <span className="text-[var(--text)]">{value}</span>
    </span>
  );
}
