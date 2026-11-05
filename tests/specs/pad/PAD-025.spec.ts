/**
 * PAD-025 — Spine assets redundant or unused. Spine files are listed by size from the network
 * inventory (warm reload); animations each skeleton offers are compared with the ones seen
 * playing during 10 spins and a bought bonus. Never-seen animations are *candidates* only (they
 * may belong to outcomes this run did not hit). Hybrid: QA reviews the candidate list.
 * Limited: depends on the Spine runtime exposing skeleton data on the game objects.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, reloadGame, withPad } from '../../support/pad-perf.js';
import { count, kb, playBoughtRound, startAssetAudit } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-025' as const;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} spine assets redundant or unused`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(20 * 60_000);
    let skeletons = 0;
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const audit = startAssetAudit(ctx);
      let report;
      try {
        await reloadGame(ctx);
        await page.waitForTimeout(3_000);
        report = await audit.report();
      } finally {
        await audit.stop();
      }
      for (let i = 1; i <= count(10, 3); i += 1) windows.push(await measureSpin(ctx, `spin ${i}`));
      if (sgapSession.supports('buyFeature')) windows.push((await playBoughtRound(ctx, 'bonus')).window);
      const usage = await ctx.perf.usage();
      const spines = usage?.spines ?? [];
      skeletons = spines.length;
      const spineFiles = report.records
        .filter((r) => r.origin !== 'launcher' && /\.(skel|atlas)(\?|$)|spine/iu.test(r.url))
        .sort((a, b) => b.bytes - a.bytes);
      const lines = [
        `Spine-like files: ${spineFiles.length}`,
        ...spineFiles.map((r) => `  ${kb(r.bytes).padStart(10)} ${r.url}`),
        `Skeletons seen on screen: ${spines.length}`,
        ...spines.flatMap((s) => {
          const unused = s.available.filter((name) => !s.played.includes(name));
          return [
            `  ${s.skeleton}: ${s.available.length} animations, ${s.played.length} seen playing`,
            ...(unused.length > 0 ? [`    never seen (candidates): ${unused.join(', ')}`] : []),
          ];
        }),
      ];
      await testInfo.attach('pad-025-spine.txt', { body: lines.join('\n'), contentType: 'text/plain' });
      const candidates = spines.reduce((n, s) => n + s.available.filter((name) => !s.played.includes(name)).length, 0);
      annotate(testInfo, 'spine', `${spineFiles.length} spine-like files; ${spines.length} skeletons; ${candidates} never-seen animation candidates`);
      annotate(testInfo, 'qa-check', 'Review the never-seen animations: candidates only, not confirmed unused');
      expect(report.total, 'network inventory recorded').toBeGreaterThan(0);
    });
    test.skip(skeletons === 0, 'No Spine skeleton data exposed on the game objects (runtime not readable)');
  });
});
