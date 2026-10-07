import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { EyeCatalog } from './types.js';

let cached: EyeCatalog | undefined;

export function eyeRootDir(): string {
  return path.join(process.cwd(), 'assets', 'eye');
}

export function loadEyeCatalog(): EyeCatalog {
  if (cached !== undefined) {
    return cached;
  }
  const raw = JSON.parse(readFileSync(path.join(eyeRootDir(), 'catalog.json'), 'utf8')) as EyeCatalog;
  cached = raw;
  return raw;
}
