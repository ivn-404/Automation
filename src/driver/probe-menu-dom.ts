/**
 * Probe whether Sugar Wonderland menu/rules is DOM or canvas-only.
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

import {
  defaultEnvironmentsDir,
  defaultManifestsDir,
  FileEnvironmentLoader,
  FileGameManifestLoader,
  PlaywrightPlatform,
  primeCanvasSession,
} from '../platform/index.js';
import { UiRegistry } from '../ui/registry/index.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';

async function main(): Promise<void> {
  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
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
    await driver.clickCanvas('menu');

    const frame = driver.getFrame();
    const report = await frame.locator('body').evaluate(`() => {
      const buttons = [...document.querySelectorAll('button, [role="button"], a, svg, [class*="close"]')]
        .slice(0, 40)
        .map((el) => ({
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 80),
          aria: el.getAttribute('aria-label'),
          className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
        }));
      return {
        buttonCount: buttons.length,
        buttons,
        hasRulesText: document.body.innerText.includes('Rules'),
        canvasCount: document.querySelectorAll('canvas').length,
      };
    }`);

    await writeFile(
      'test-results/probe-menu-dom.json',
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(report, null, 2));
    await page.screenshot({ path: 'test-results/probe-menu-dom.png', fullPage: true });

    // Try common DOM close strategies
    const closeCandidates = [
      frame.getByRole('button', { name: /close/i }),
      frame.locator('[aria-label*="close" i]'),
      frame.locator('button').filter({ hasText: /^×$|^x$/i }),
      frame.locator('[class*="close" i]'),
    ];
    for (const loc of closeCandidates) {
      const count = await loc.count();
      console.log('candidate count', count);
      if (count > 0) {
        await loc.first().click({ timeout: 3_000, force: true }).catch((error: unknown) => {
          console.log('click failed', error instanceof Error ? error.message : error);
        });
      }
    }

    await page.screenshot({ path: 'test-results/probe-menu-after-dom-close.png', fullPage: true });
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
