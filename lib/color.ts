// Hex color helpers shared by the `color` control's recipe coercion and every
// color-aware effect (e.g. `const [r,g,b] = hexToRgb(params.inkColor)`).

/** Return a normalized lowercase #rrggbb, or the fallback for anything invalid.
 *  Accepts #rgb shorthand. Used as the trust boundary for URL-recipe colors. */
export function normalizeHex(v: unknown, fallback: string): string {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map((c) => c + c).join("");
  }
  return fallback;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex, "#000000");
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
