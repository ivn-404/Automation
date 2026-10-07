/**
 * One-shot Sugar buy probe (desktop staging) — find open + confirm that fire /bet buyFeat.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

import {
  defaultEnvironmentsDir,
  defaultManifestsDir,
  FileEnvironmentLoader,
  FileGameManifestLoader,
  PlaywrightPlatform,
  clearCanvasOverlays,
  primeCanvasSession,
} from '../platform/index.js';
import { findControlInPng, type ControlSignature } from '../eye/canvas-vision.js';
import { UiRegistry } from '../ui/registry/index.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';
import { matchesBetUrl, matchesBuyUrl } from '../network/bet-url.js';

const SPIN: ControlSignature = {
  id: 'spin',
  hue: 'green',
  band: { y0: 0.84, y1: 0.98, x0: 0.38, x1: 0.62 },
  minAreaRatio: 0.0065,
  maxAreaRatio: 0.015,
};

const YES: ControlSignature = {
  id: 'yes',
  hue: 'green',
  band: { y0: 0.45, y1: 0.85, x0: 0.2, x1: 0.8 },
  minAreaRatio: 0.005,
  maxAreaRatio: 0.15,
};

const OPENS = [
  { x: 0.5, y: 0.78 },
  { x: 0.48, y: 0.77 },
  { x: 0.5, y: 0.76 },
  { x: 0.42, y: 0.78 },
  { x: 0.38, y: 0.72 },
];

const CONFIRMS = [
  { x: 0.5, y: 0.58 },
  { x: 0.5, y: 0.56 },
  { x: 0.5, y: 0.62 },
  { x: 0.35, y: 0.78 },
  { x: 0.5, y: 0.78 },
];

async function tapAndClick(
  driver: PlaywrightGameDriver,
  point: { x: number; y: number },
  label: string,
): Promise<void> {
  // Match calibrate-buy-feature-canvas: both pointer paths.
  await driver.clickCanvasAt(point, {
    timeoutMs: 8_000,
    singleInput: false,
    label,
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

  const browser = await chromium.launch({ headless: false, slowMo: 20 });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    hasTouch: true,
  });

  const outDir = 'test-results/probe-buy-once';
  await mkdir(outDir, { recursive: true });
  const log: Array<Record<string, unknown>> = [];

  try {
    const platform = new PlaywrightPlatform({ page, environment: env, manifest, ui });
    await platform.openGameHost();
    await platform.openGame();
    await platform.prepareGameView('desktop');

    const driver = new PlaywrightGameDriver({
      page,
      ui,
      manifest,
      defaultTimeoutMs: env.defaultTimeoutMs,
    });
    await driver.attach();
    await primeCanvasSession({ page, driver, manifest });
    await clearCanvasOverlays(driver, manifest, 2);
    await page.waitForTimeout(1_500);

    for (let i = 0; i < 30; i += 1) {
      const capture = await driver.captureCanvasForVision();
      if (capture !== undefined && findControlInPng(capture.png, SPIN) !== undefined) {
        console.log('idle spin visible at attempt', i);
        await writeFile(`${outDir}/idle.png`, capture.png);
        break;
      }
      await driver
        .clickCanvasAt({ x: 0.5, y: 0.82 }, {
          timeoutMs: 3_000,
          singleInput: false,
          label: 'enter',
        })
        .catch(() => undefined);
      await page.waitForTimeout(600);
    }

    for (const open of OPENS) {
      console.log('\n=== OPEN', open);
      await driver
        .clickCanvasAt({ x: 0.86, y: 0.28 }, {
          timeoutMs: 3_000,
          singleInput: true,
          label: 'buyFeatureCancel',
        })
        .catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(400);

      const before = await driver.captureCanvasForVision();
      if (before !== undefined) {
        await writeFile(`${outDir}/before-${open.x}-${open.y}.png`, before.png);
      }

      const purchasePromise = page.waitForResponse(
        (response) => {
          if (!response.ok()) {
            return false;
          }
          const url = response.url();
          if (matchesBuyUrl(url)) {
            return true;
          }
          if (!matchesBetUrl(url)) {
            return false;
          }
          try {
            const body = response.request().postDataJSON() as {
              buyFeat?: number;
              action?: string;
            } | null;
            return (
              body !== null &&
              (body.action === 'buy' || Number(body.buyFeat) > 0)
            );
          } catch {
            return false;
          }
        },
        { timeout: 16_000 },
      );

      await tapAndClick(driver, open, 'buyFeature');
      await page.waitForTimeout(1_200);

      const afterOpen = await driver.captureCanvasForVision();
      let yesHit: { x: number; y: number } | undefined;
      if (afterOpen !== undefined) {
        await writeFile(`${outDir}/after-open-${open.x}-${open.y}.png`, afterOpen.png);
        const found = findControlInPng(afterOpen.png, YES);
        if (found !== undefined) {
          yesHit = afterOpen.toActionRatio(found.center);
          console.log(
            '  YES',
            yesHit.x.toFixed(3),
            yesHit.y.toFixed(3),
            `area=${(found.areaRatio * 100).toFixed(2)}%`,
          );
        } else {
          console.log('  YES none');
        }
      }

      // Early purchase on open tap?
      const early = await Promise.race([
        purchasePromise.then((r) => r).catch(() => undefined),
        page.waitForTimeout(1_500).then(() => undefined),
      ]);
      if (early !== undefined) {
        console.log('  SUCCESS on open tap', open, early.url());
        log.push({ open, confirm: null, ok: true, via: 'open-tap', url: early.url() });
        await writeFile(`${outDir}/result.json`, `${JSON.stringify(log, null, 2)}\n`);
        return;
      }

      const confirms =
        yesHit !== undefined ? [yesHit, ...CONFIRMS] : CONFIRMS;
      for (const confirm of confirms) {
        console.log('  try confirm', confirm);
        await tapAndClick(driver, confirm, 'buyFeatureConfirm');
        const bought = await Promise.race([
          purchasePromise.then((r) => r).catch(() => undefined),
          page.waitForTimeout(2_500).then(() => undefined),
        ]);
        if (bought !== undefined) {
          console.log('  SUCCESS', { open, confirm, url: bought.url() });
          log.push({ open, confirm, yesHit, ok: true, url: bought.url() });
          const shot = await driver.captureCanvasForVision();
          if (shot !== undefined) {
            await writeFile(`${outDir}/success.png`, shot.png);
          }
          await writeFile(`${outDir}/result.json`, `${JSON.stringify(log, null, 2)}\n`);
          return;
        }
      }

      log.push({ open, yesHit, ok: false });
      await writeFile(`${outDir}/result.json`, `${JSON.stringify(log, null, 2)}\n`);
    }

    console.log('NO SUCCESS');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
