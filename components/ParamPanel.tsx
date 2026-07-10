"use client";

import type { Control, ModeDef, ParamValue, Params } from "@/lib/modes";
import type { BlendMode } from "@/lib/image";

const BLEND_MODES: BlendMode[] = ["normal", "multiply", "screen"];

function fmt(v: number, step: number, unit?: string) {
  const s = step < 1 ? v.toFixed(2) : String(Math.round(v));
  return unit ? `${s}${unit}` : s;
}

export function ParamPanel({
  mode,
  params,
  opacity,
  blend,
  onOpacity,
  onBlend,
  onChange,
  onReset,
}: {
  mode: ModeDef;
  params: Params;
  opacity: number;
  blend: BlendMode;
  onOpacity: (v: number) => void;
  onBlend: (m: BlendMode) => void;
  onChange: (key: string, value: ParamValue) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <span className="font-mono text-[11px] tracking-wide text-[var(--text-muted)]">
          {mode.name} dials
        </span>
        <button
          type="button"
          onClick={onReset}
          className="font-mono text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          reset
        </button>
      </div>

      {/* Layer-level compositing: opacity + blend mode against the layer's input. */}
      <div className="mt-4 border-b border-[var(--hairline)] pb-5">
        <label className="block">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Blend with original</span>
            <span className="font-mono text-xs text-[var(--text)]">
              {Math.round(opacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => onOpacity(Number(e.target.value))}
            aria-label="Layer opacity — lower values let the original show through"
          />
        </label>
        <div className="mt-2.5 flex gap-1" role="radiogroup" aria-label="Blend mode">
          {BLEND_MODES.map((m) => {
            const active = m === blend;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onBlend(m)}
                className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 font-mono text-[11px] transition-colors"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--hairline)",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  background: active
                    ? "color-mix(in srgb, var(--accent) 10%, var(--surface-2))"
                    : "var(--surface-2)",
                }}
              >
                {m}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-muted)]/70">
          100% normal replaces the frame · lower opacity or multiply/screen
          overlays the effect on the original
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {mode.controls.map((c) => (
          <ControlRow
            key={c.key}
            control={c}
            value={params[c.key]}
            onChange={(v) => onChange(c.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

function ControlRow({
  control,
  value,
  onChange,
}: {
  control: Control;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}) {
  if (control.kind === "slider") {
    return (
      <label className="block">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">{control.label}</span>
          <span className="font-mono text-xs text-[var(--text)]">
            {fmt(value as number, control.step, control.unit)}
          </span>
        </div>
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value as number}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  }

  if (control.kind === "seed") {
    return (
      <label className="block">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">{control.label}</span>
          <span className="font-mono text-xs text-[var(--text)]">
            {String(value)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={99999}
            step={1}
            value={value as number}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <button
            type="button"
            onClick={() => onChange(Math.floor(Math.random() * 100000))}
            className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--hairline)] px-2.5 py-1 font-mono text-[11px] text-[var(--text)] transition-colors hover:border-[var(--accent)]"
            aria-label="Re-roll seed"
          >
            re-roll
          </button>
        </div>
      </label>
    );
  }

  if (control.kind === "select") {
    return (
      <label className="block">
        <span className="mb-1.5 block text-xs text-[var(--text-muted)]">
          {control.label}
        </span>
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          {control.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (control.kind === "color") {
    const hex = typeof value === "string" ? value : "#000000";
    return (
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">{control.label}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[var(--text-muted)]">{hex}</span>
          <span
            className="relative h-6 w-9 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--hairline)]"
            style={{ background: hex }}
          >
            <input
              type="color"
              value={hex}
              onChange={(e) => onChange(e.target.value)}
              aria-label={control.label}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </span>
        </span>
      </label>
    );
  }

  // toggle
  const on = Boolean(value);
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--text-muted)]">{control.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={control.label}
        onClick={() => onChange(!on)}
        className="relative h-6 w-11 shrink-0 rounded-full border transition-colors"
        style={{
          borderColor: on ? "var(--accent)" : "var(--hairline)",
          background: on ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "var(--surface-2)",
        }}
      >
        <span
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all"
          style={{
            left: on ? "calc(100% - 20px)" : "4px",
            background: on ? "var(--accent)" : "var(--text-muted)",
          }}
        />
      </button>
    </div>
  );
}
