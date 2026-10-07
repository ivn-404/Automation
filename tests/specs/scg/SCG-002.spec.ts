/**
 * SCG-002 — Scratch Game
 *
 * Manual Test Case ID: SCG-002
 * Catalog: Scratch Card Panel (MAIN CANVAS & OUTSIDE MAIN CANVAS)
 * Intent: mobile portrait draws the drawer inside the main canvas; the desktop
 * layout (non-touch browser, wide iframe) draws it in the side canvas outside the
 * main canvas. A card bought from the outside panel must reach the scratch hub
 * (StartRound / Cashout).
 */

import type { Locator, Page } from '@playwright/test';

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  attachDrawer,
  attachRound,
  buyAndScratchAll,
  enterScratchHud,
  expectChecks,
  scratchCheck,
  startScratchCase,
} from '../../support/scratch-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import type { PlaywrightGameDriver } from '../../../src/driver/playwright-game-driver.js';

const MANUAL_TEST_ID = 'SCG-002' as const;

type Box = { x: number; y: number; width: number; height: number };

/**
 * Largest visible portrait canvas that is not the side panel. The driver's
 * last-visible pick is the side canvas here, and a landscape backdrop stage can sit behind both.
 */
async function mainCanvasBox(driver: PlaywrightGameDriver, selector: string, side: Box | null): Promise<Box | null> {
  const canvases = driver.getFrame().locator(selector);
  let best: Box | null = null;
  for (let i = 0; i < (await canvases.count()); i += 1) {
    const box = await canvases.nth(i).boundingBox().catch(() => null);
    if (box === null || box.width <= 40 || box.height <= box.width) {
      continue;
    }
    if (side !== null && Math.abs(box.x - side.x) < 1 && Math.abs(box.y - side.y) < 1 && Math.abs(box.width - side.width) < 1) {
      continue;
    }
    if (best === null || box.width * box.height > best.width * best.height) {
      best = box;
    }
  }
  return best;
}

/** The side panel slides out from behind the main canvas; read it once it stops moving. */
async function settledBox(locator: Locator, page: Page, timeoutMs = 8_000): Promise<Box | null> {
  const deadline = Date.now() + timeoutMs;
  let previous = await locator.boundingBox().catch(() => null);
  let stableReads = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(400);
    const current = await locator.boundingBox().catch(() => null);
    const same =
      previous !== null &&
      current !== null &&
      Math.abs(current.x - previous.x) < 1 &&
      Math.abs(current.y - previous.y) < 1 &&
      Math.abs(current.width - previous.width) < 1;
    stableReads = same ? stableReads + 1 : 0;
    previous = current;
    if (stableReads >= 2) {
      return current;
    }
  }
  return previous;
}

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  // A touch-capable browser is treated as a phone: the landscape desktop layout
  // shows "Rotate to portrait" instead of the side panel.
  test.use({ hasTouch: false });

  test(`${MANUAL_TEST_ID} Scratch Card Panel (MAIN CANVAS & OUTSIDE MAIN CANVAS)`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    const sideSelector = sgapSession.manifest.scratchCard?.sideCanvasSelector;
    test.skip(sideSelector === undefined, 'Manifest has no side-canvas selector for the outside panel');
    const sideCanvas = sgapDriver.getFrame().locator(sideSelector!).first();
    const checks: VerificationResult[] = [];

    await scratch.open();
    const mobileLocation = await scratch.drawerLocation();
    const mobileSide = await sideCanvas.boundingBox().catch(() => null);
    await attachDrawer(testInfo, scratch, 'scratch-panel-main-canvas.png');
    checks.push(
      scratchCheck(mobileLocation === 'main-canvas', `Mobile portrait: drawer in ${mobileLocation}`, 'main-canvas', mobileLocation),
      scratchCheck(
        mobileSide === null || mobileSide.width <= 40 || mobileSide.height <= 40,
        'Mobile portrait: side canvas stays hidden',
        'hidden',
        mobileSide,
      ),
    );

    await sgapSession.platform.prepareLandscapeDesktopView();
    await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
    await enterScratchHud(page, sgapDriver);
    await page.waitForTimeout(1_500);

    await scratch.open();
    const desktopLocation = await scratch.drawerLocation();
    const side = await settledBox(sideCanvas, page);
    const main = await mainCanvasBox(sgapDriver, sgapSession.manifest.canvasActions?.canvasSelector ?? 'canvas', side);
    await testInfo.attach('scratch-panel-outside-main-canvas.png', { body: await page.screenshot(), contentType: 'image/png' });
    const outside =
      side !== null &&
      main !== null &&
      (side.x + side.width <= main.x + 2 || side.x >= main.x + main.width - 2);
    checks.push(
      scratchCheck(desktopLocation === 'side-canvas', `Desktop: drawer in ${desktopLocation}`, 'side-canvas', desktopLocation),
      scratchCheck(outside, 'Desktop: side panel does not overlap the main canvas', 'outside', { side, main }),
    );

    const { started, settled } = await buyAndScratchAll(scratch);
    await attachRound(testInfo, 'scratch-outside-start-round.json', started);
    checks.push(
      scratchCheck(started.card !== undefined, `Outside panel BUY CARD → StartRound "${started.message}"`),
      scratchCheck(/scratch complete/iu.test(settled.message), `Outside panel SCRATCH ALL → Cashout "${settled.message}"`),
    );

    await expectChecks(testInfo, checks);
  });
});
