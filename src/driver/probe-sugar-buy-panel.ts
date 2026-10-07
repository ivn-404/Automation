/**
 * Headed probe: Sugar buyFeature open + YES (desktop staging, matches BF specs).
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
import { listPhaserInteractive } from '../runtime/phaser-locate.js';
import { UiRegistry } from '../ui/registry/index.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';
import { matchesBetUrl, matchesBuyUrl } from '../network/bet-url.js';

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

// Manifest + HUD-left + mid-panel candidates (desktop portrait strip ratios).
const OPEN_CANDIDATES = [
  { x: 0.38, y: 0.72 },
  { x: 0.36, y: 0.72 },
  { x: 0.4, y: 0.72 },
  { x: 0.38, y: 0.7 },
  { x: 0.42, y: 0.72 },
  ...grid([0.12, 0.18, 0.24, 0.3, 0.36, 0.42], [0.84, 0.87, 0.9]),
  ...grid([0.35, 0.4, 0.45, 0.5], [0.65, 0.7, 0.75, 0.78]),
  { x: 0.5, y: 0.8 },
];

const CONFIRM_CANDIDATES = [
  { x: 0.5, y: 0.58 },
  { x: 0.5, y: 0.56 },
  { x: 0.5, y: 0.6 },
  { x: 0.5, y: 0.62 },
  { x: 0.5, y: 0.78 },
  { x: 0.5, y: 0.8 },
];

const YES: ControlSignature = {
  id: 'yes',
  hue: 'green',
  band: { y0: 0.45, y1: 0.85, x0: 0.2, x1: 0.8 },
  minAreaRatio: 0.005,
  maxAreaRatio: 0.15,
};

const SPIN: ControlSignature = {
  id: 'spin',
  hue: 'green',
  band: { y0: 0.84, y1: 0.98, x0: 0.38, x1: 0.62 },
  minAreaRatio: 0.0065,
  maxAreaRatio: 0.015,
};

async function main(): Promise<void> {
  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: false, slowMo: 25 });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    hasTouch: true,
  });

  const results: Array<Record<string, unknown>> = [];

  try {
    const platform = new PlaywrightPlatform({ page, environment: env, manifest, ui });
    await platform.openGameHost();
    await platform.openGame();
    // Match BF / AT desktop fixture — not mobile ES-012.
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
    await page.waitForTimeout(2_000);

    // Wait until idle spin is visible (same gate as specs).
    for (let i = 0; i < 20; i += 1) {
      const capture = await driver.captureCanvasForVision();
      if (capture !== undefined && findControlInPng(capture.png, SPIN) !== undefined) {
        console.log('idle spin visible');
        break;
      }
      await driver.clickCanvas('enter', { timeoutMs: 3_000, singleInput: true }).catch(() => undefined);
      await page.waitForTimeout(500);
    }

    const phaserBefore = await listPhaserInteractive(page, driver.iframeSelector);
    console.log(
      `phaser interactive=${phaserBefore.length}`,
      phaserBefore
        .filter((h) => h.yRatio > 0.6)
        .slice(0, 12)
        .map((h) => `${h.xRatio.toFixed(2)},${h.yRatio.toFixed(2)} ${h.width}x${h.height}`),
    );

    for (const open of OPEN_CANDIDATES) {
      console.log('\n=== OPEN', open);
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(300);
      await driver.clickCanvasAt(open, {
        timeoutMs: 8_000,
        singleInput: true,
        label: 'buyFeature',
      });
      await page.waitForTimeout(1_500);

      const capture = await driver.captureCanvasForVision();
      let yesHit: { x: number; y: number } | undefined;
      let yesArea = 0;
      if (capture !== undefined) {
        const found = findControlInPng(capture.png, YES);
        if (found !== undefined) {
          yesHit = capture.toActionRatio(found.center);
          yesArea = found.areaRatio;
          console.log(
            `  YES vision ${yesHit.x.toFixed(3)},${yesHit.y.toFixed(3)} area=${(yesArea * 100).toFixed(2)}%`,
          );
        } else {
          console.log('  YES vision: none');
        }
        await mkdir('test-results/probe-buy', { recursive: true });
        await writeFile(
          `test-results/probe-buy/open-${open.x}-${open.y}.png`,
          capture.png,
        );
      }

      const phaser = await listPhaserInteractive(page, driver.iframeSelector);
      const mid = phaser.filter((h) => h.yRatio > 0.45 && h.yRatio < 0.75 && h.area > 4000);
      if (mid.length > 0) {
        console.log(
          '  phaser mid',
          mid
            .slice(0, 6)
            .map((h) => `${h.xRatio.toFixed(2)},${h.yRatio.toFixed(2)} ${h.width}x${h.height}`),
        );
      }

      const confirms =
        yesHit !== undefined ? [yesHit, ...CONFIRM_CANDIDATES] : CONFIRM_CANDIDATES;
      let bought = false;
      for (const confirm of confirms.slice(0, 4)) {
        const betPromise = page.waitForResponse(
          (response) =>
            response.ok() &&
            (matchesBetUrl(response.url()) ||
              matchesBuyUrl(response.url())),
          { timeout: 6_000 },
        );
        await driver.clickCanvasAt(confirm, {
          timeoutMs: 6_000,
          singleInput: true,
          label: 'buyFeatureConfirm',
        });
        try {
          const res = await betPromise;
          console.log('  SUCCESS buy', { open, confirm, url: res.url() });
          results.push({
            open,
            confirm,
            yesHit,
            yesArea,
            ok: true,
            url: res.url(),
          });
          bought = true;
          break;
        } catch {
          // next
        }
      }

      if (!bought) {
        results.push({ open, yesHit, yesArea, ok: false, midPhaser: mid.length });
        await driver
          .clickCanvas('buyFeatureCancel', { timeoutMs: 3_000, singleInput: true })
          .catch(() => undefined);
        await page.keyboard.press('Escape').catch(() => undefined);
      } else {
        break;
      }
    }

    await mkdir('test-results', { recursive: true });
    await writeFile(
      'test-results/probe-sugar-buy-panel.json',
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    );
    console.log('\nWrote test-results/probe-sugar-buy-panel.json');
    const wins = results.filter((r) => r.ok === true);
    console.log(wins.length > 0 ? wins : 'NO SUCCESS');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
