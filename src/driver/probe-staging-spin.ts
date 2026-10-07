/**
 * Calibrate main-UI spin on portrait after enter (clean player flow).
 */
import { chromium } from 'playwright';

import {
  defaultEnvironmentsDir,
  defaultManifestsDir,
  FileEnvironmentLoader,
  FileGameManifestLoader,
  PlaywrightPlatform,
} from '../platform/index.js';
import { UiRegistry } from '../ui/registry/index.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';
import { matchesBetUrl } from '../network/bet-url.js';

async function main(): Promise<void> {
  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: false, slowMo: 25 });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();

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
    await driver.clickCanvas('enter');
    await driver.clickCanvas('acknowledge').catch(() => undefined);
    await page.screenshot({ path: 'test-results/cal-main-ready.png', fullPage: true });

    const canvas = driver.gameCanvas();
    for (const y of [0.72, 0.75, 0.78, 0.8, 0.82, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94]) {
      console.log(`try y=${y}`);
      const betPromise = page.waitForResponse(
        (r) => r.ok() && matchesBetUrl(r.url()),
        { timeout: 6_000 },
      );
      const box = await canvas.boundingBox();
      if (!box) continue;
      await canvas.tap({
        position: { x: box.width * 0.5, y: box.height * y },
        force: true,
      });
      try {
        const response = await betPromise;
        console.log('SUCCESS', { x: 0.5, y }, await response.json());
        await page.screenshot({ path: 'test-results/cal-main-success.png', fullPage: true });
        return;
      } catch {
        console.log('  no bet');
      }
    }
    await page.screenshot({ path: 'test-results/cal-main-failed.png', fullPage: true });
    process.exitCode = 1;
  } catch (error: unknown) {
    console.error('FAILED:', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
