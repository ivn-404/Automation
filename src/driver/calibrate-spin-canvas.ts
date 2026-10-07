/**
 * Staging canvas spin calibration (headed Playwright).
 * Diagnoses launcher open, then tries spin click candidates.
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

const CANDIDATES: ReadonlyArray<{ x: number; y: number; label: string }> = [
  { x: 0.5, y: 0.75, label: 'center-0.75' },
  { x: 0.5, y: 0.78, label: 'center-0.78' },
  { x: 0.5, y: 0.8, label: 'center-0.80' },
  { x: 0.5, y: 0.82, label: 'center-0.82' },
  { x: 0.5, y: 0.84, label: 'center-0.84' },
  { x: 0.5, y: 0.86, label: 'center-0.86' },
  { x: 0.5, y: 0.88, label: 'center-0.88' },
  { x: 0.5, y: 0.9, label: 'center-0.90' },
  { x: 0.5, y: 0.92, label: 'center-0.92' },
];

async function main(): Promise<void> {
  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    const platform = new PlaywrightPlatform({ page, environment: env, manifest, ui });
    console.log('Opening host + game...');
    await platform.openGameHost();
    await platform.openGame();
    console.log('Game iframe attached.');

    const driver = new PlaywrightGameDriver({
      page,
      ui,
      manifest,
      defaultTimeoutMs: env.defaultTimeoutMs,
    });
    await driver.attach();

    const canvas = driver.gameCanvas();
    await canvas.waitFor({ state: 'visible', timeout: 60_000 });
    const box = await canvas.boundingBox();
    console.log('Canvas bounding box:', box);
    await page.screenshot({ path: 'test-results/calibrate-before-spin.png', fullPage: true });

    for (const candidate of CANDIDATES) {
      console.log(`\nTrying ${candidate.label} → ({ x: ${candidate.x}, y: ${candidate.y} })`);

      const betPromise = page.waitForResponse(
        (response) => response.ok() && matchesBetUrl(response.url()),
        { timeout: 7_000 },
      );

      const currentBox = await canvas.boundingBox();
      if (!currentBox) {
        console.log('  skip — no bounding box');
        continue;
      }

      const position = {
        x: Math.max(1, Math.min(currentBox.width - 1, currentBox.width * candidate.x)),
        y: Math.max(1, Math.min(currentBox.height - 1, currentBox.height * candidate.y)),
      };

      await canvas.tap({ position, force: true });
      await canvas.click({ position, force: true }).catch(() => undefined);

      try {
        const response = await betPromise;
        const body = (await response.json()) as { balance?: number; slot?: { totalWin?: number } };
        console.log('  SUCCESS — bet response received');
        console.log('  URL:', response.url());
        console.log('  balance:', body.balance, 'totalWin:', body.slot?.totalWin);
        console.log('\nPut this in config/manifests/sugar-wonderland.json → canvasActions.actions.spin:');
        console.log(JSON.stringify({ x: candidate.x, y: candidate.y }, null, 2));
        await page.screenshot({ path: 'test-results/calibrate-success.png', fullPage: true });
        await driver.detach();
        await platform.dispose();
        return;
      } catch {
        console.log('  no /api/v1/slots/bet within 7s');
      }
    }

    await page.screenshot({ path: 'test-results/calibrate-failed.png', fullPage: true });
    console.log('\nNo candidate triggered HTTP /api/v1/slots/bet.');
    console.log('Next: check WebSocket bets, or click Spin manually in the headed window while this runs.');
    await driver.detach();
    await platform.dispose();
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
