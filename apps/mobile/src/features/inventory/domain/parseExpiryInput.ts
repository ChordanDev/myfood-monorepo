// The day, month and four digit year the user types, as in 28/10/2026
const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Reads the expiry the user typed as the ISO date the API takes. A blank text is no expiry
 * (`undefined`), which the API then infers; anything that is not a real date is `null`.
 */
export function parseExpiryInput(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;

  const match = DATE_PATTERN.exec(trimmed);
  if (!match) return null;

  const [day, month, year] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // A day the month does not have rolls over into the next one
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date.toISOString().slice(0, 10);
}
