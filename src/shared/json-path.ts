/**
 * Resolve dotted JSON paths (e.g. "slot.totalWin") without external deps.
 */

export function getByPath(input: unknown, path: string): unknown {
  if (path.trim().length === 0) {
    return undefined;
  }

  const segments = path.split('.');
  let current: unknown = input;

  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function toAmountString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}
