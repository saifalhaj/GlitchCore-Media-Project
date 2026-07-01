"use client";

import { MODES, type Stage } from "@/lib/modes";

/** The effect stack: an ordered list of layers piped source → … → output.
 *  Clicking a mode in the rail sets the *selected* layer's effect. */
export function StackEditor({
  stages,
  selected,
  onSelect,
  onAdd,
  onRemove,
  onMove,
}: {
  stages: Stage[];
  selected: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
}) {
  return (
    <div className="mb-4 border-b border-[var(--hairline)] pb-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[11px] font-medium tracking-wide text-[var(--text-muted)]">
          STACK
        </span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]/70">
          layer {selected + 1}/{stages.length}
        </span>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {stages.map((s, i) => {
          const mode = MODES[s.mode];
          const active = i === selected;
          return (
            <div key={s.id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span className="text-[var(--text-muted)]/50">→</span>}
              <button
                type="button"
                onClick={() => onSelect(i)}
                className="rounded-[var(--radius-sm)] border px-2 py-1 font-mono text-[11px] transition-colors"
                style={{
                  borderColor: active ? mode.color : "var(--hairline)",
                  color: active ? mode.color : "var(--text-muted)",
                  background: active
                    ? `color-mix(in srgb, ${mode.color} 12%, var(--surface-2))`
                    : "var(--surface-2)",
                }}
              >
                <span className="opacity-50">{i + 1}</span> {mode.name}
              </button>
            </div>
          );
        })}
        <span className="text-[var(--text-muted)]/50">→</span>
        <button
          type="button"
          onClick={onAdd}
          className="shrink-0 rounded-[var(--radius-sm)] border border-dashed border-[var(--hairline)] px-2 py-1 font-mono text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          aria-label="Add layer"
        >
          + add
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1.5 px-1">
        <IconBtn label="Move layer left" disabled={selected === 0} onClick={() => onMove(selected, -1)}>
          ◀
        </IconBtn>
        <IconBtn
          label="Move layer right"
          disabled={selected === stages.length - 1}
          onClick={() => onMove(selected, 1)}
        >
          ▶
        </IconBtn>
        <IconBtn
          label="Remove layer"
          disabled={stages.length === 1}
          onClick={() => onRemove(selected)}
        >
          ✕
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--hairline)] font-mono text-[10px] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
