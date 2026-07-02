"use client";

import { useState, type RefObject } from "react";
import { downloadCanvas } from "@/lib/image";

export function ExportBar({
  exportName,
  baseRef,
  asciiText,
  recipeUrl,
  canExportImage,
  isVideo,
}: {
  exportName: string;
  baseRef: RefObject<HTMLCanvasElement | null>;
  asciiText: string | null;
  recipeUrl: string;
  canExportImage: boolean;
  isVideo: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const downloadPng = () => {
    const base = baseRef.current;
    if (base) downloadCanvas(base, `glitchcore-${exportName}.png`);
  };

  const copyText = async () => {
    if (!asciiText) return;
    try {
      await navigator.clipboard.writeText(asciiText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked (e.g. insecure context) — no-op
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(recipeUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      // clipboard blocked — no-op
    }
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="hidden font-mono text-[11px] text-[var(--text-muted)] sm:block">
        {isVideo
          ? "video export runs in your browser — nothing is uploaded"
          : "everything runs locally — nothing is uploaded"}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="rounded-[var(--radius-sm)] border border-[var(--hairline)] px-3.5 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)]"
          title="Copy a link that reproduces this whole stack"
        >
          {linkCopied ? "Link copied" : "Copy link"}
        </button>
        {isVideo ? (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            use “Export clip” on the stage →
          </span>
        ) : (
          <>
            {asciiText !== null && (
              <button
                type="button"
                onClick={copyText}
                disabled={!canExportImage}
                className="rounded-[var(--radius-sm)] border border-[var(--hairline)] px-3.5 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copied ? "Copied" : "Copy as text"}
              </button>
            )}
            <button
              type="button"
              onClick={downloadPng}
              disabled={!canExportImage}
              className="btn-accent rounded-[var(--radius-sm)] px-3.5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              Download PNG
            </button>
          </>
        )}
      </div>
    </div>
  );
}
