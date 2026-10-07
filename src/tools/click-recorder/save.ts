/**
 * Persist recorder evidence as JSON. Does not patch tests or manifests.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { RecorderSessionSnapshot } from './types.js';

export async function saveRecorderEvidence(snapshot: RecorderSessionSnapshot): Promise<string> {
  const outDir = path.join(process.cwd(), 'test-results');
  await mkdir(outDir, { recursive: true });
  const stamp = snapshot.recordedAt.replace(/[:.]/gu, '-');
  const outPath = path.join(outDir, `sgap-click-recorder-${snapshot.gameId}-${stamp}.json`);
  const live = snapshot.clicks.filter((click) => click.state === 'active' || click.state === 'accepted');
  const payload = {
    ...snapshot,
    note: 'Evidence only. Do not copy these locators into tests without QA review.',
    liveClicks: live,
  };
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return outPath;
}
