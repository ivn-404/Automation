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

/** Like getByPath, but each `[]` fans out over an array (e.g. "slot.tumbles[].multiplier.current"). */
export function getAllByPath(input: unknown, path: string): unknown[] {
  const [head = '', ...rest] = path.split('[]');
  const key = head.replace(/^\./u, '');
  const node = key === '' ? input : getByPath(input, key);
  if (rest.length === 0) {
    return node === undefined ? [] : [node];
  }
  return Array.isArray(node) ? node.flatMap((item) => getAllByPath(item, rest.join('[]'))) : [];
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
