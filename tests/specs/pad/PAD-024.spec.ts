/**
 * PAD-024 — Oversized textures and sprite sheets, read after a bonus has played (or 10 spins
 * when the game has no Buy Feature). Lists:
 *   - atlases larger than 4096 px on a side;
 *   - mostly-empty atlases (frames cover under 50% of the sheet);
 *   - texture frames at least 2× their largest on-screen size (device pixels) in both directions.
 * On-screen sizes are only known for frames shown during this run. Expected: the list is produced.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound, renderInfo } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-024' as const;
const MAX_SIDE = 4096;
const MIN_FILL = 0.5;
const OVERSIZE = 2;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} oversized textures and sprite sheets`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      if (sgapSession.supports('buyFeature')) {
        windows.push((await playBoughtRound(ctx, 'bonus')).window);
      }
      for (let i = 1; i <= count(10, 3); i += 1) windows.push(await measureSpin(ctx, `spin ${i}`));
      const info = await renderInfo(ctx);
      const usage = await ctx.perf.usage();
      expect(info, 'Phaser texture manager readable').toBeDefined();
      const textures = info!.textures;
      const huge = textures.filter((t) => t.width > MAX_SIDE || t.height > MAX_SIDE);
      const sparse = textures.filter((t) => t.frames > 1 && t.usedArea !== undefined && t.width * t.height > 0 && t.usedArea / (t.width * t.height) < MIN_FILL);
      const oversized = (usage?.textures ?? []).filter(
        (u) => u.shownWidth > 0 && u.shownHeight > 0 && u.frameWidth >= OVERSIZE * u.shownWidth && u.frameHeight >= OVERSIZE * u.shownHeight,
      );
      const lines = [
        `Textures: ${textures.length}; frames seen on screen: ${usage?.textures.length ?? 0}`,
        `Atlases over ${MAX_SIDE} px: ${huge.length}`,
        ...huge.map((t) => `  ${t.key} ${t.width}×${t.height}`),
        `Mostly-empty atlases (< ${MIN_FILL * 100}% covered by frames): ${sparse.length}`,
        ...sparse.map((t) => `  ${t.key} ${t.width}×${t.height}, ${(((t.usedArea ?? 0) / (t.width * t.height)) * 100).toFixed(0)}% used, ${t.frames} frames`),
        `Frames ≥ ${OVERSIZE}× their largest on-screen size: ${oversized.length}`,
        ...oversized
          .sort((a, b) => b.frameWidth * b.frameHeight - a.frameWidth * a.frameHeight)
          .map((u) => `  ${u.key} ${u.frameWidth}×${u.frameHeight} shown at most ${Math.round(u.shownWidth)}×${Math.round(u.shownHeight)}`),
      ];
      await testInfo.attach('pad-024-textures.txt', { body: lines.join('\n'), contentType: 'text/plain' });
      await testInfo.attach('pad-024-textures.json', { body: JSON.stringify({ textures, usage: usage?.textures ?? [] }, null, 1), contentType: 'application/json' });
      annotate(testInfo, 'textures', `${huge.length} over ${MAX_SIDE} px, ${sparse.length} mostly empty, ${oversized.length} frames ≥ ${OVERSIZE}× on-screen size`);
    });
  });
});
