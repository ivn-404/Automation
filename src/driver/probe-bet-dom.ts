/**
 * Dump iframe DOM hints for bet controls (DOM vs canvas).
 */
import { chromium } from 'playwright';

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

  const browser = await chromium.launch({ headless: false });
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

    const frame = page.frames().find((f) => f.url().includes('sugar_wonderland'));
    if (!frame) {
      throw new Error('game frame not found');
    }

    const summary = await frame.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button, [role="button"], a')].map(
        (el) => ({
          tag: el.tagName,
          text: (el.textContent ?? '').trim().slice(0, 80),
          aria: el.getAttribute('aria-label'),
          className: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
        }),
      );
      const allText = document.body?.innerText?.slice(0, 1500) ?? '';
      const inputs = [...document.querySelectorAll('input, select')].map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        aria: el.getAttribute('aria-label'),
      }));
      return {
        buttonCount: buttons.length,
        buttons: buttons.slice(0, 40),
        inputs,
        hasCanvas: !!document.querySelector('canvas'),
        textSample: allText,
      };
    })()`);

    console.log(JSON.stringify(summary, null, 2));
    await page.screenshot({ path: 'test-results/probe-bet-dom.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
