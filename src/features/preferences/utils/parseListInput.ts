export function parseListInput(raw: string): string[] {
  if (raw.length === 0) return [];
  const result: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    result.push(trimmed);
  }
  return result;
}
