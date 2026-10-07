/**
 * Staging menu close calibration (headed).
 * Opens menu, grids close taps on the panel X region, verifies spin bet fires.
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

/** Panel X sits on the hub's top-right — not the canvas edge. */
const CLOSE_CANDIDATES = [
  ...grid([0.78, 0.8, 0.82, 0.84, 0.86], [0.08, 0.1, 0.12, 0.14, 0.16]),
  ...grid([0.88, 0.9, 0.92], [0.1, 0.12, 0.14]),
  { x: 0.96, y: 0.2 },
];

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
  const position = {
    x: Math.max(1, Math.min(box.width - 1, box.width * point.x)),
    y: Math.max(1, Math.min(box.height - 1, box.height * point.y)),
  };
  await canvas.tap({ position, force: true }).catch(() => undefined);
  await canvas.click({ position, force: true });
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

    for (const point of CLOSE_CANDIDATES) {
      console.log('try menuClose', point);
      await clearCanvasOverlays(driver, manifest, 2, { forceGridSpam: true });
      await page.keyboard.press('Escape').catch(() => undefined);
      await driver.clickCanvas('menu');
      await page
        .screenshot({
          path: `test-results/cal-menu-before-close.png`,
          fullPage: true,
        })
        .catch(() => undefined);

      await tap(driver, point);
      // Do NOT clearCanvasOverlays here — closeOverlay sits on Settings when hub is open.
      const betPromise = page.waitForResponse(
        (response) => response.ok() && matchesBetUrl(response.url()),
        { timeout: 10_000 },
      );
      await driver.clickCanvas('spin');

      try {
        await betPromise;
        console.log('SUCCESS menuClose', point);
        await writeFile(
          'test-results/cal-menu-close-result.json',
          `${JSON.stringify({ point }, null, 2)}\n`,
          'utf8',
        );
        await page.screenshot({ path: 'test-results/cal-menu-success.png', fullPage: true });
        return;
      } catch (error: unknown) {
        console.log('  no bet', error instanceof Error ? error.message : error);
        await page.screenshot({
          path: `test-results/cal-menu-miss-${point.x}-${point.y}.png`,
          fullPage: true,
        }).catch(() => undefined);
        await page.keyboard.press('Escape').catch(() => undefined);
        // Escape alone rarely closes; try denser recovery taps at known X region.
        for (const recovery of [
          { x: 0.84, y: 0.1 },
          { x: 0.82, y: 0.12 },
          { x: 0.86, y: 0.12 },
        ] as const) {
          await tap(driver, recovery).catch(() => undefined);
        }
        await clearCanvasOverlays(driver, manifest, 2, { forceGridSpam: true });
      }
    }

    process.exitCode = 1;
    await page.screenshot({ path: 'test-results/cal-menu-failed.png', fullPage: true });
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
