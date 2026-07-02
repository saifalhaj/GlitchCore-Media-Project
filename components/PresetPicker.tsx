"use client";

import type { ModeDef, Params } from "@/lib/modes";
import type { BlendMode } from "@/lib/image";
import { PRESETS, presetMatches, type Preset } from "@/lib/presets";

/** The simple face of a mode: its name, what it does, and one-click looks.
 *  Fine-tuning lives under "Advanced" in the studio panel. */
export function PresetPicker({
  mode,
  params,
  opacity,
  blend,
  onApply,
}: {
  mode: ModeDef;
  params: Params;
  opacity: number;
  blend: BlendMode;
  onApply: (p: Preset) => void;
}) {
  const presets = PRESETS[mode.id];
  return (
    <div>
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="font-mono text-sm font-bold tracking-wide" style={{ color: "var(--accent)" }}>
          {mode.name}
        </h2>
      </div>
      <p className="mt-1 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
        {mode.tagline}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {presets.map((p) => {
          const active = presetMatches(p, params, opacity, blend);
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => onApply(p)}
              aria-pressed={active}
              className="rounded-[var(--radius-sm)] border px-3 py-3 text-left text-sm font-medium transition-all active:scale-[0.98]"
              style={{
                borderColor: active ? "var(--accent)" : "var(--glass-border)",
                color: active ? "var(--accent)" : "var(--text)",
                background: active
                  ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                  : "var(--glass)",
                boxShadow: active ? "0 0 18px -8px var(--accent)" : "none",
              }}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
