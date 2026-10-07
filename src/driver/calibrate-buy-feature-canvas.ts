/**
 * Staging canvas buy-feature BUY confirm calibration (headed).
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

import {
  defaultEnvironmentsDir,
  defaultManifestsDir,
  FileEnvironmentLoader,
  FileGameManifestLoader,
  PlaywrightPlatform,
  clearCanvasOverlays,
  primeCanvasSession,
} from '../platform/index.js';
import { UiRegistry } from '../ui/registry/index.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';
import { matchesBetUrl } from '../network/bet-url.js';

function grid(
  xs: readonly number[],
  ys: readonly number[],
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const y of ys) {
    for (const x of xs) {
      out.push({ x, y });
    }
  }
  return out;
}

const CONFIRM_CANDIDATES = grid(
  [0.35, 0.42, 0.5, 0.58, 0.65],
  [0.72, 0.75, 0.78, 0.8, 0.82, 0.84, 0.86, 0.88],
);

async function tap(
  driver: PlaywrightGameDriver,
  point: { x: number; y: number },
): Promise<void> {
  const canvas = driver.gameCanvas();
  await canvas.waitFor({ state: 'visible' });
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('no canvas box');
  }
  await canvas.tap({
    position: { x: box.width * point.x, y: box.height * point.y },
    force: true,
  });
  await canvas.click({
    position: { x: box.width * point.x, y: box.height * point.y },
    force: true,
  });
}

async function openBuyPanel(
  driver: PlaywrightGameDriver,
  manifest: import('../core/models/index.js').GameManifest,
): Promise<void> {
  await clearCanvasOverlays(driver, manifest, 2, { forceGridSpam: true });
  await driver.clickCanvas('buyFeature');
  await driver.gameCanvas().waitFor({ state: 'visible' });
}

async function closeBuyPanel(
  driver: PlaywrightGameDriver,
  manifest: import('../core/models/index.js').GameManifest,
): Promise<void> {
  await driver.clickCanvas('closeOverlay').catch(() => undefined);
  await clearCanvasOverlays(driver, manifest, 1, { forceGridSpam: true });
}

async function main(): Promise<void> {
  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    hasTouch: true,
  });

  try {
    const platform = new PlaywrightPlatform({ page, environment: env, manifest, ui });
    await platform.openGameHost();
    await platform.openGame();
    await platform.prepareMobilePortraitSession();

    const driver = new PlaywrightGameDriver({
      page,
      ui,
      manifest,
      defaultTimeoutMs: env.defaultTimeoutMs,
    });
    await driver.attach();
    await primeCanvasSession({ page, driver, manifest });

    for (const point of CONFIRM_CANDIDATES) {
      console.log('try buy confirm', point);
      await openBuyPanel(driver, manifest);

      const betPromise = page.waitForResponse(
        (response) => response.ok() && matchesBetUrl(response.url()),
        { timeout: 12_000 },
      );
      await tap(driver, point);

      try {
        await betPromise;
        console.log('SUCCESS buyFeatureConfirm', point);
        await writeFile(
          'test-results/cal-buy-feature-confirm-result.json',
          `${JSON.stringify({ point }, null, 2)}\n`,
          'utf8',
        );
        await page.screenshot({
          path: 'test-results/cal-buy-feature-success.png',
          fullPage: true,
        });
        return;
      } catch (error: unknown) {
        console.log('  no bet', error instanceof Error ? error.message : error);
        await closeBuyPanel(driver, manifest);
      }
    }

    process.exitCode = 1;
    await page.screenshot({ path: 'test-results/cal-buy-feature-failed.png', fullPage: true });
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
