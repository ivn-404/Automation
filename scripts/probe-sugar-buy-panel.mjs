/**
 * Headed probe: Sugar buyFeature open + YES confirm.
 * Prints vision greens and whether /bet buy fires.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

// Prefer compiled dist when present; fall back to tsx via dynamic import path.
async function loadPlatform() {
  try {
    return await import('../dist/platform/index.js');
  } catch {
    const { register } = await import('tsx/esm/api');
    register();
    return import('../src/platform/index.js');
  }
}

async function loadDriver() {
  try {
    return await import('../dist/driver/playwright-game-driver.js');
  } catch {
    return import('../src/driver/playwright-game-driver.js');
  }
}

async function loadUi() {
  try {
    return await import('../dist/ui/registry/index.js');
  } catch {
    return import('../src/ui/registry/index.js');
  }
}

async function loadVision() {
  try {
    return await import('../dist/eye/canvas-vision.js');
  } catch {
    return import('../src/eye/canvas-vision.js');
  }
}

const OPEN_CANDIDATES = [
  { x: 0.38, y: 0.72 },
  { x: 0.36, y: 0.72 },
  { x: 0.4, y: 0.72 },
  { x: 0.38, y: 0.7 },
  { x: 0.42, y: 0.72 },
  { x: 0.32, y: 0.72 },
  { x: 0.38, y: 0.68 },
  { x: 0.5, y: 0.72 },
  { x: 0.28, y: 0.75 },
  { x: 0.22, y: 0.78 },
];

const CONFIRM_CANDIDATES = [
  { x: 0.5, y: 0.58 },
  { x: 0.5, y: 0.56 },
  { x: 0.5, y: 0.6 },
  { x: 0.5, y: 0.62 },
  { x: 0.42, y: 0.58 },
  { x: 0.58, y: 0.58 },
];

function topGreens(png, findControlInPng, toActionRatio) {
  // Re-scan via multiple bands using findControl is awkward; use driver capture dump instead.
  return [];
}

async function main() {
  process.env.SGAP_LAUNCHER_MODE = 'staging';
  process.env.SGAP_GAME_ID = 'sugar-wonderland';
  process.env.PLAYWRIGHT_BROWSERS_PATH =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    'C:/Users/User/AppData/Local/ms-playwright';

  const platformMod = await loadPlatform();
  const { PlaywrightGameDriver } = await loadDriver();
  const { UiRegistry } = await loadUi();
  const { findControlInPng } = await loadVision();

  const env = await new platformMod.FileEnvironmentLoader({
    environmentsDir: platformMod.defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new platformMod.FileGameManifestLoader({
    manifestsDir: platformMod.defaultManifestsDir(),
  }).load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    hasTouch: true,
  });

  const results = [];

  try {
    const platform = new platformMod.PlaywrightPlatform({
      page,
      environment: env,
      manifest,
      ui,
    });
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
    await platformMod.primeCanvasSession({ page, driver, manifest });
    await platformMod.clearCanvasOverlays(driver, manifest, 2);
    await page.waitForTimeout(1500);

    const YES = {
      id: 'yes',
      hue: 'green',
      band: { y0: 0.48, y1: 0.72, x0: 0.22, x1: 0.78 },
      minAreaRatio: 0.008,
      maxAreaRatio: 0.12,
    };

    for (const open of OPEN_CANDIDATES) {
      console.log('\n=== OPEN', open);
      await platformMod.clearCanvasOverlays(driver, manifest, 1);
      await page.waitForTimeout(400);
      await driver.clickCanvasAt(open, {
        timeoutMs: 8_000,
        singleInput: true,
        label: 'buyFeature',
      });
      await page.waitForTimeout(1600);

      const capture = await driver.captureCanvasForVision();
      let yesHit;
      if (capture) {
        const found = findControlInPng(capture.png, YES);
        if (found) {
          yesHit = capture.toActionRatio(found.center);
          console.log(
            `  YES vision ${yesHit.x.toFixed(3)},${yesHit.y.toFixed(3)} area=${(found.areaRatio * 100).toFixed(2)}%`,
          );
        } else {
          console.log('  YES vision: none');
        }
      }

      // Try confirm points only if we saw YES or always try 0.58 once
      const confirms = yesHit ? [yesHit, ...CONFIRM_CANDIDATES] : CONFIRM_CANDIDATES;
      let bought = false;
      for (const confirm of confirms.slice(0, 4)) {
        const betPromise = page.waitForResponse(
          (r) =>
            r.ok() &&
            r.url().includes('/api/v1/slots/') &&
            (r.url().includes('/bet') || r.url().includes('/buy')),
          { timeout: 7_000 },
        );
        await driver.clickCanvasAt(confirm, {
          timeoutMs: 6_000,
          singleInput: true,
          label: 'buyFeatureConfirm',
        });
        try {
          const res = await betPromise;
          const url = res.url();
          console.log('  SUCCESS buy', { open, confirm, url });
          results.push({ open, confirm, yesHit, ok: true, url });
          bought = true;
          break;
        } catch {
          console.log('  miss confirm', confirm);
        }
      }

      if (!bought) {
        results.push({ open, yesHit, ok: false });
        await driver
          .clickCanvas('buyFeatureCancel', { timeoutMs: 4_000, singleInput: true })
          .catch(() => undefined);
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(800);
      } else {
        // Drain briefly then stop — one success is enough to publish coords
        await page.waitForTimeout(2000);
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
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
