/**
 * PROBE-002 — iframe reachability inventory.
 *
 * Not a QA catalog ID. Answers one question in plain language:
 * can we go inside the game iframe and test controllers via real DOM / Phaser
 * objects, or is the HUD painted on canvas so we must keep coords + /bet?
 *
 * Universal first step for every future game (see docs/PROBE_GATE.md).
 * Run headed, 1 worker, one game at a time.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import { createGameRuntime } from '../../../src/runtime/index.js';
import { listPhaserTexts } from '../../../src/runtime/phaser-locate.js';
import { closeBuyPanel } from '../../../src/eye/index.js';
import { dismissBuyFeaturePanel, openBuyFeaturePanel } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'PROBE-002' as const;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

test.describe('PROBE — iframe inventory', () => {
  test(`${MANUAL_TEST_ID} can we test controllers from inside the iframe?`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PROBE' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    const verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);

      const runtime = createGameRuntime({
        page,
        driver: sgapDriver,
        manifest: sgapSession.manifest,
      });
      const report = await runtime.inspect();
      const text = runtime.formatInspect(report);

      console.log(`\n${text}\n`);

      const outDir = path.join('test-results', 'probe', MANUAL_TEST_ID, sgapSession.manifest.gameId);
      mkdirSync(outDir, { recursive: true });
      const jsonPath = path.join(outDir, 'iframe-inventory.json');
      const mdPath = path.join(outDir, 'iframe-inventory.md');
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      writeFileSync(mdPath, `${text}\n`, 'utf8');
      await testInfo.attach('iframe-inventory.md', { path: mdPath, contentType: 'text/markdown' });
      await testInfo.attach('iframe-inventory.json', {
        path: jsonPath,
        contentType: 'application/json',
      });

      verificationResults.push({
        kind: 'uiSynchronization',
        passed: report.iframeFound && report.sameOriginReadable,
        message: report.iframeFound
          ? report.sameOriginReadable
            ? `Entered iframe and read DOM (surface=${report.surface})`
            : `Iframe found but DOM not readable: ${report.readError ?? 'unknown'}`
          : 'Game iframe not found on host page',
        actual: {
          surface: report.surface,
          canvasCount: report.canvasCount,
          buttonCount: report.buttonCount,
          inputCount: report.inputCount,
          roleButtonCount: report.roleButtonCount,
          elementsWithTestId: report.elementsWithTestId,
          phaserInteractive: report.phaser.interactiveCount,
          phaserNamed: report.phaser.namedInteractiveCount,
          phaserScenes: report.phaser.scenes,
        },
      });

      if (report.surface === 'phaser-named' || report.phaser.interactiveCount >= 10) {
        const calibration: Record<string, unknown>[] = [];
        for (const action of ['spin', 'turbo', 'amplifyBet', 'betPlus', 'betMinus', 'autoplay', 'menu'] as const) {
          const pinned = sgapSession.manifest.canvasActions?.actions[action];
          const live = await runtime.locate(action, { remember: false, allowManifest: false });
          calibration.push({
            action,
            source: live.source,
            phaser: live.hit === undefined ? undefined : { x: round3(live.hit.xRatio), y: round3(live.hit.yRatio) },
            manifest: pinned === undefined ? undefined : { x: pinned.x, y: pinned.y },
            drift:
              live.hit === undefined || pinned === undefined
                ? undefined
                : round3(Math.hypot(live.hit.xRatio - pinned.x, live.hit.yRatio - pinned.y)),
          });
        }
        const calibrationPath = path.join(outDir, 'calibration.json');
        writeFileSync(calibrationPath, `${JSON.stringify(calibration, null, 2)}\n`, 'utf8');
        await testInfo.attach('calibration.json', { path: calibrationPath, contentType: 'application/json' });
        console.log(
          `[${MANUAL_TEST_ID}] calibration ${sgapSession.manifest.gameId}\n` +
            calibration.map((row) => `  ${JSON.stringify(row)}`).join('\n'),
        );

        for (const action of ['spin', 'turbo', 'amplifyBet', 'betPlus', 'betMinus'] as const) {
          const located = await runtime.locate(action, { remember: false });
          verificationResults.push({
            kind: 'uiSynchronization',
            passed: located.found && located.source === 'phaser',
            message: located.detail,
            expected: action,
            actual: located.hit
              ? {
                  x: located.hit.xRatio,
                  y: located.hit.yRatio,
                  size: `${located.hit.width}x${located.hit.height}`,
                  source: located.source,
                }
              : { source: located.source },
          });
        }

        // Informational: where the Buy Feature panel's close glyph sits in the scene graph.
        if (sgapSession.supports('buyFeature') && sgapSession.manifest.canvasActions?.actions.buyFeature !== undefined) {
          let opened = false;
          for (let attempt = 0; attempt < 2 && !opened; attempt += 1) {
            opened = await openBuyFeaturePanel(sgapSession, sgapDriver, page, attempt).catch(() => false);
          }
          const texts = await listPhaserTexts(page, sgapDriver.iframeSelector).catch(() => []);
          const pinnedCancel = sgapSession.manifest.canvasActions?.actions.buyFeatureCancel;
          const closed = opened ? await closeBuyPanel(sgapDriver, 3) : undefined;
          if (opened && !closed) {
            await dismissBuyFeaturePanel(sgapSession, sgapDriver, page);
          }
          const buyPanel = {
            opened,
            topTexts: texts
              .filter((hit) => hit.gameHeight > 0 && (hit.y + hit.height / 2) / hit.gameHeight < 0.4)
              .map((hit) => ({
                text: hit.text.slice(0, 24),
                x: round3((hit.x + hit.width / 2) / hit.gameWidth),
                y: round3((hit.y + hit.height / 2) / hit.gameHeight),
                w: hit.width,
                h: hit.height,
                layer: hit.layer?.order,
              })),
            manifest: pinnedCancel,
            closed,
          };
          const buyPanelPath = path.join(outDir, 'buy-panel.json');
          writeFileSync(buyPanelPath, `${JSON.stringify(buyPanel, null, 2)}\n`, 'utf8');
          await testInfo.attach('buy-panel.json', { path: buyPanelPath, contentType: 'application/json' });
          console.log(`[${MANUAL_TEST_ID}] buy panel ${sgapSession.manifest.gameId} ${JSON.stringify(buyPanel)}`);
        }
      }

      // Informational: inventory completed.
      verificationResults.push({
        kind: 'stateManagement',
        passed: true,
        message: report.summary,
        actual: report.recommendation,
      });

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
