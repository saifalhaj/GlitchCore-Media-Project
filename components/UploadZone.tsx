"use client";

import { useRef, useState } from "react";

export function UploadZone({
  onImage,
}: {
  onImage: (src: Blob, name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith("image/")) onImage(f, f.name);
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
        className="flex w-full max-w-md flex-col items-center gap-5 rounded-[var(--radius)] border border-dashed px-8 py-14 text-center transition-colors"
        style={{
          borderColor: dragging ? "var(--accent)" : "var(--hairline)",
          background: dragging ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface)",
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 20" />
        </svg>
        <div className="space-y-1">
          <p className="text-base font-medium text-[var(--text)]">
            Drop an image to begin
          </p>
          <p className="font-mono text-xs text-[var(--text-muted)]">
            drag &amp; drop · click browse · or paste
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[var(--bg)] transition-transform active:scale-[0.97]"
          style={{ background: "var(--accent)" }}
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pick(e.target.files)}
        />
      </div>
    </div>
  );
}
