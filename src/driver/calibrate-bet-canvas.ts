/**
 * Staging canvas bet +/- calibration (headed).
 * BET HUD is right of BUY — denser grid + log request body.
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

const PLUS_CANDIDATES = grid(
  [0.78, 0.82, 0.86, 0.9, 0.94],
  [0.66, 0.7, 0.74, 0.78, 0.82],
);

const MINUS_CANDIDATES = grid(
  [0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.86],
  [0.72, 0.74, 0.76, 0.78, 0.8, 0.82],
);

async function spinAndReadRequest(
  page: import('playwright').Page,
  driver: PlaywrightGameDriver,
  manifest: import('../core/models/index.js').GameManifest,
): Promise<{ stake?: string; body?: unknown }> {
  await clearCanvasOverlays(driver, manifest, 3, { forceGridSpam: true });
  const betPromise = page.waitForResponse(
    (response) => response.ok() && matchesBetUrl(response.url()),
    { timeout: 15_000 },
  );
  await driver.clickCanvas('spin');
  const response = await betPromise;
  try {
    const post = response.request().postData();
    if (!post) {
      return {};
    }
    const body = JSON.parse(post) as unknown;
    const stake =
      body && typeof body === 'object'
        ? String(
            (body as Record<string, unknown>).bet ??
              (body as Record<string, unknown>).amount ??
              (body as Record<string, unknown>).totalBet ??
              '',
          ) || undefined
        : undefined;
    return { stake, body };
  } catch {
    return {};
  }
}

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
}

async function main(): Promise<void> {
  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: false, slowMo: 30 });
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

    const canvas = driver.gameCanvas();
    console.log('canvas box', await canvas.boundingBox());

    const baseline = await spinAndReadRequest(page, driver, manifest);
    console.log('baseline', JSON.stringify(baseline.body));
    await clearCanvasOverlays(driver, manifest, 3, { forceGridSpam: true });
    await page.screenshot({ path: 'test-results/cal-bet-baseline.png', fullPage: true });

    let raisedStake = baseline.stake;
    let plusPoint: { x: number; y: number } | undefined;

    for (const point of PLUS_CANDIDATES) {
      console.log('try plus', point);
      await clearCanvasOverlays(driver, manifest, 2, { forceGridSpam: true });
      await tap(driver, point);
      try {
        const after = await spinAndReadRequest(page, driver, manifest);
        console.log('  stake', after.stake);
        if (
          baseline.stake !== undefined &&
          after.stake !== undefined &&
          Number(after.stake) > Number(baseline.stake)
        ) {
          console.log('SUCCESS betPlus', point, { baseline: baseline.stake, after: after.stake });
          plusPoint = point;
          raisedStake = after.stake;
          break;
        }
      } catch (error: unknown) {
        console.log('  spin failed', error instanceof Error ? error.message : error);
        await clearCanvasOverlays(driver, manifest, 3, { forceGridSpam: true });
      }
    }

    if (plusPoint === undefined || raisedStake === undefined) {
      process.exitCode = 1;
      return;
    }

    await writeFile(
      'test-results/cal-bet-plus-result.json',
      `${JSON.stringify({ point: plusPoint, baseline, raisedStake }, null, 2)}\n`,
      'utf8',
    );

    for (const point of MINUS_CANDIDATES) {
      console.log('try minus', point);
      await clearCanvasOverlays(driver, manifest, 2, { forceGridSpam: true });
      await tap(driver, point);
      try {
        const after = await spinAndReadRequest(page, driver, manifest);
        console.log('  stake', after.stake);
        if (
          after.stake !== undefined &&
          Number(after.stake) < Number(raisedStake)
        ) {
          console.log('SUCCESS betMinus', point, { raisedStake, after: after.stake });
          await writeFile(
            'test-results/cal-bet-minus-result.json',
            `${JSON.stringify({ plusPoint, minusPoint: point, raisedStake, after }, null, 2)}\n`,
            'utf8',
          );
          return;
        }
      } catch (error: unknown) {
        console.log('  spin failed', error instanceof Error ? error.message : error);
        await clearCanvasOverlays(driver, manifest, 3, { forceGridSpam: true });
      }
    }

    process.exitCode = 1;
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
