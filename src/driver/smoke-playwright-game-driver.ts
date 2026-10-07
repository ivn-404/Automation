/**
 * Smoke script: PlaywrightGameDriver attach, click, readText on local iframe HTML.
 * Run after build: node dist/driver/smoke-playwright-game-driver.js
 */
import { chromium } from 'playwright';

import {
  defaultManifestsDir,
  FileGameManifestLoader,
} from '../platform/manifest/index.js';
import { UiRegistry } from '../ui/registry/index.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>SGAP Driver Smoke</title></head>
  <body>
    <iframe
      id="game"
      title="game"
      srcdoc="<!DOCTYPE html><html><body><button data-testid='spin'>Spin</button><span data-testid='balance'>100.00</span></body></html>"
    ></iframe>
  </body>
</html>`;

async function main(): Promise<void> {
  const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
  const manifest = await loader.load('driver-smoke');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.setContent(FIXTURE_HTML);

    const driver = new PlaywrightGameDriver({ page, ui, manifest });
    await driver.attach();

    const attached = await driver.isAttached();
    if (!attached) {
      throw new Error('Driver failed to attach');
    }

    await driver.click('spinButton');
    const balance = await driver.readText('balanceDisplay');

    console.log(
      JSON.stringify(
        {
          gameId: driver.gameId,
          attached,
          balanceAfterClick: balance,
          iframeSelector: ui.resolveIframe().selector,
        },
        null,
        2,
      ),
    );

    await driver.detach();
    console.log('PlaywrightGameDriver smoke passed');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
