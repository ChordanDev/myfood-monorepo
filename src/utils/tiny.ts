// Minimal tiny replacement: only implements the parts we use in the app
// Supports: tiny(color).setAlpha(alpha).toRgbString()

type RGB = { r: number; g: number; b: number; a: number };

function clamp(v: number, a = 0, b = 255) {
  return Math.max(a, Math.min(b, Math.round(v)));
}

function parseHex(hex: string): RGB {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b, a: 1 };
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  // fallback
  return { r: 0, g: 0, b: 0, a: 1 };
}

function parseRgbString(input: string): RGB {
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const parts = m[1].split(',').map((s) => s.trim());
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts[3] !== undefined ? Number(parts[3]) : 1;
  return { r: clamp(r), g: clamp(g), b: clamp(b), a: isNaN(a) ? 1 : a };
}

function parseColor(input: any): RGB {
  if (!input) return { r: 0, g: 0, b: 0, a: 1 };
  if (typeof input !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
  const s = input.trim();
  if (s.startsWith('#')) return parseHex(s);
  if (s.startsWith('rgb')) return parseRgbString(s);
  // try to parse hex without #
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseHex('#' + s);
  // unknown: fallback to black
  return { r: 0, g: 0, b: 0, a: 1 };
}

export default function tiny(input: string) {
  const base = parseColor(input);
  const obj = {
    setAlpha(alpha: number) {
      const a = Math.max(0, Math.min(1, Number(alpha) || 0));
      const rgb = { ...base, a };
      return {
        toRgbString() {
          return `rgba(${clamp(rgb.r)}, ${clamp(rgb.g)}, ${clamp(rgb.b)}, ${rgb.a})`;
        },
      };
    },
  };
  return obj;
}
