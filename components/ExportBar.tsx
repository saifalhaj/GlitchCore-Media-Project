"use client";

import { useState, type RefObject } from "react";
import type { ModeId } from "@/lib/effects/types";
import { composite, downloadCanvas } from "@/lib/image";

export function ExportBar({
  mode,
  baseRef,
  overlayRef,
  asciiText,
  recipeUrl,
  disabled,
}: {
  mode: ModeId;
  baseRef: RefObject<HTMLCanvasElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  asciiText: string | null;
  recipeUrl: string;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const downloadPng = () => {
    const base = baseRef.current;
    if (!base) return;
    const flat = composite(base, mode === "yolo" ? overlayRef.current : null);
    downloadCanvas(flat, `glitchcore-${mode}.png`);
  };

  const copyText = async () => {
    if (!asciiText) return;
    try {
      await navigator.clipboard.writeText(asciiText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked (e.g. insecure context) — no-op, button stays available
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
        everything runs locally — nothing is uploaded
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          disabled={disabled}
          className="rounded-[var(--radius-sm)] border border-[var(--hairline)] px-3.5 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Copy a link that reproduces this mode and its settings"
        >
          {linkCopied ? "Link copied" : "Copy link"}
        </button>
        {mode === "ascii" && (
          <button
            type="button"
            onClick={copyText}
            disabled={disabled || !asciiText}
            className="rounded-[var(--radius-sm)] border border-[var(--hairline)] px-3.5 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy as text"}
          </button>
        )}
        <button
          type="button"
          onClick={downloadPng}
          disabled={disabled}
          className="rounded-[var(--radius-sm)] px-3.5 py-2 text-sm font-medium text-[var(--bg)] transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          Download PNG
        </button>
      </div>
    </div>
  );
}
