// Shareable "recipes": the current mode + all params encoded into the URL query,
// so a link reproduces the exact result. No server, no DB — the string is the state.

import { DEFAULT_PARAMS, MODES, MODE_ORDER, type Params } from "./modes";
import type { ModeId } from "./effects/types";

const KEY = "r";

export type Recipe = { mode: ModeId; params: Record<ModeId, Params> };

export function encodeRecipe(mode: ModeId, params: Record<ModeId, Params>): string {
  // ponytail: base64url of JSON — recipes are a few hundred bytes. Swap for a
  // CompressionStream pass only if they ever get large enough to matter in a URL.
  return b64urlEncode(JSON.stringify({ m: mode, p: params }));
}

/** Build a full URL for the current state (empty string during SSR). */
export function recipeToUrl(mode: ModeId, params: Record<ModeId, Params>): string {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href);
  u.searchParams.set(KEY, encodeRecipe(mode, params));
  return u.toString();
}

/** Read + validate a recipe from the current URL, or null if absent/invalid. */
export function readRecipeFromLocation(): Recipe | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(KEY);
  return raw ? decodeRecipe(raw) : null;
}

export function decodeRecipe(raw: string): Recipe | null {
  let obj: unknown;
  try {
    obj = JSON.parse(b64urlDecode(raw));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const mode = (obj as { m?: unknown }).m;
  const p = (obj as { p?: unknown }).p as Record<string, unknown> | undefined;
  if (typeof mode !== "string" || !MODE_ORDER.includes(mode as ModeId)) return null;

  // Rebuild a full params map from defaults, overlaying only validated values.
  const params = {} as Record<ModeId, Params>;
  for (const id of MODE_ORDER) params[id] = sanitizeParams(id, p?.[id]);
  return { mode: mode as ModeId, params };
}

/** Untrusted input from a URL — clamp/coerce every value to its control's shape. */
function sanitizeParams(id: ModeId, raw: unknown): Params {
  const out: Params = { ...DEFAULT_PARAMS[id] };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const c of MODES[id].controls) {
    const v = src[c.key];
    if (v === undefined) continue;
    if (c.kind === "toggle") {
      out[c.key] = Boolean(v);
    } else if (c.kind === "select") {
      if (typeof v === "string" && c.options.some((o) => o.value === v)) out[c.key] = v;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      out[c.key] =
        c.kind === "slider" ? Math.min(c.max, Math.max(c.min, n)) : Math.max(0, Math.floor(n));
    }
  }
  return out;
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
