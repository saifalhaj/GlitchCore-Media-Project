// Shareable "recipes": the whole effect stack (each layer's mode + params) plus
// the selected layer, encoded into the URL query. No server, no DB — the string
// is the state.

import { MODES, MODE_ORDER, makeStage, type Params, type Stage } from "./modes";
import type { ModeId } from "./effects/types";

const KEY = "r";

export type EditorState = { chain: Stage[]; selected: number };

export function encodeEditor(state: EditorState): string {
  // ponytail: base64url of JSON — a stack is a few hundred bytes. Swap for a
  // CompressionStream pass only if stacks ever get large enough to matter.
  const payload = {
    se: state.selected,
    c: state.chain.map((s) => ({ m: s.mode, p: s.params })),
  };
  return b64urlEncode(JSON.stringify(payload));
}

/** Build a full URL for the current state (empty string during SSR). */
export function editorToUrl(state: EditorState): string {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href);
  u.searchParams.set(KEY, encodeEditor(state));
  return u.toString();
}

/** Read + validate a recipe from the current URL, or null if absent/invalid. */
export function readEditorFromLocation(): EditorState | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(KEY);
  return raw ? decodeEditor(raw) : null;
}

export function decodeEditor(raw: string): EditorState | null {
  let obj: unknown;
  try {
    obj = JSON.parse(b64urlDecode(raw));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const c = (obj as { c?: unknown }).c;
  if (!Array.isArray(c)) return null;

  const chain: Stage[] = [];
  for (const item of c) {
    const m = (item as { m?: unknown })?.m;
    if (typeof m !== "string" || !MODE_ORDER.includes(m as ModeId)) continue;
    chain.push({
      id: crypto.randomUUID(),
      mode: m as ModeId,
      params: sanitizeParams(m as ModeId, (item as { p?: unknown })?.p),
    });
  }
  if (chain.length === 0) return null;

  const seRaw = Number((obj as { se?: unknown }).se);
  const selected = Number.isInteger(seRaw) ? Math.min(chain.length - 1, Math.max(0, seRaw)) : 0;
  return { chain, selected };
}

/** Untrusted input from a URL — clamp/coerce every value to its control's shape. */
function sanitizeParams(id: ModeId, raw: unknown): Params {
  const out: Params = { ...MODES[id].defaults };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const cont of MODES[id].controls) {
    const v = src[cont.key];
    if (v === undefined) continue;
    if (cont.kind === "toggle") {
      out[cont.key] = Boolean(v);
    } else if (cont.kind === "select") {
      if (typeof v === "string" && cont.options.some((o) => o.value === v)) out[cont.key] = v;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      out[cont.key] =
        cont.kind === "slider" ? Math.min(cont.max, Math.max(cont.min, n)) : Math.max(0, Math.floor(n));
    }
  }
  return out;
}

/** Fallback default stack: a single ASCII layer. */
export function defaultEditor(): EditorState {
  return { chain: [makeStage("ascii")], selected: 0 };
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
