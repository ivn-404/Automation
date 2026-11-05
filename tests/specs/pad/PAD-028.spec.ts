/**
 * PAD-028 — Audio files: duplicates and size. Scenario as PAD-022 (cold). Lists audio files with
 * identical content under different URLs and clips over 1 MB. Expected: the list is produced.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { coldAssetSession, count, kb, startAssetAudit } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-028' as const;
const SPINS = count(20, 3);
const MAX_CLIP_BYTES = 1024 * 1024;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} audio duplicates and size`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(SPINS * 60_000 + 15 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const audit = startAssetAudit(ctx);
      try {
        const cold = await coldAssetSession(ctx, audit, SPINS);
        windows.push(...cold.windows);
        const audio = cold.report.records.filter((r) => r.kind === 'audio' && r.origin !== 'launcher');
        const audioHashes = new Set(audio.map((r) => r.sha256));
        const duplicates = cold.report.duplicates.filter((d) => audioHashes.has(d.sha256));
        const large = audio.filter((r) => r.bytes > MAX_CLIP_BYTES);
        const lines = [
          `Audio files: ${audio.length}, ${kb(audio.reduce((n, r) => n + r.bytes, 0))}`,
          ...[...audio].sort((a, b) => b.bytes - a.bytes).map((r) => `  ${kb(r.bytes).padStart(10)} ${r.url}`),
          `Duplicate audio: ${duplicates.length}`,
          ...duplicates.map((d) => `  ${kb(d.bytes)} × ${d.urls.length}: ${d.urls.join('  |  ')}`),
          `Clips over 1 MB: ${large.length}`,
          ...large.map((r) => `  ${kb(r.bytes)} ${r.url}`),
        ];
        await testInfo.attach('pad-028-audio.txt', { body: lines.join('\n'), contentType: 'text/plain' });
        annotate(testInfo, 'audio', `${audio.length} clips; ${duplicates.length} duplicate group(s); ${large.length} over 1 MB`);
        expect(cold.report.total, 'responses recorded').toBeGreaterThan(0);
      } finally {
        await audit.stop();
      }
    });
  });
});
