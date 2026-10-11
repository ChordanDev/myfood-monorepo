// A JSON import types its strings as `string`. The fixture accessors narrow a union field
// with this, so a value outside the union fails the test that reads it.
export function oneOf<T extends string>(allowed: readonly T[], value: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Unexpected fixture value: ${value}`);
  return match;
}
