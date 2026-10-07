// Plain non-negative decimals only: no sign, exponent or thousands separator
const DECIMAL_PATTERN = /^(\d+\.?\d*|\.\d+)$/;

export function parseQuantityInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!DECIMAL_PATTERN.test(normalized)) return null;

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
