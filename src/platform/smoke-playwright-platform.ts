/**
 * Smoke: PlaywrightPlatform openGameHost + openGame against a local launcher fixture.
 * Does not hit staging (avoids auth/token dependency).
 * Run: node dist/platform/smoke-playwright-platform.js
 */
import { chromium } from 'playwright';

import { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { UiRegistry } from '../ui/registry/index.js';
import {
  defaultEnvironmentsDir,
  FileEnvironmentLoader,
} from './environment/index.js';
import {
  defaultManifestsDir,
  FileGameManifestLoader,
} from './manifest/index.js';
import { PlaywrightPlatform } from './playwright-platform.js';

const LAUNCHER_FIXTURE = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>SGAP Launcher Smoke</title></head>
  <body>
    <input placeholder="Search games" />
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-lg border p-3">
        <div class="group relative">
          <img alt="Other Game" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <div>Other Game</div>
          <div>99999999</div>
          <button type="button" aria-label="Play in modal" title="Play in modal">Play</button>
        </div>
      </div>
      <div class="rounded-lg border p-3">
        <div class="group relative">
          <img alt="Sugar Wonderland" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <div>Sugar Wonderland</div>
          <div>00010525</div>
          <button type="button" aria-label="Grant free spins for 00010525">FS</button>
          <button type="button" aria-label="Play in modal" title="Play in modal">Play</button>
        </div>
      </div>
    </div>
    <div id="modal"></div>
    <script>
      document.querySelectorAll('button[aria-label="Play in modal"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tile = btn.closest('.rounded-lg');
          const id = tile && tile.textContent.includes('00010525');
          if (!id) return;
          document.getElementById('modal').innerHTML =
            '<iframe title="Game session" srcdoc="<html><body><canvas id=game></canvas><div>canvas game</div></body></html>"></iframe>';
        });
      });
    </script>
  </body>
</html>`;

async function main(): Promise<void> {
  const environments = new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  });
  const staging = await environments.load('staging');

  const manifests = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
  const manifest = await manifests.load('sugar-wonderland');
  const ui = new UiRegistry(manifest);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Local fixture replaces staging baseUrl navigation for offline smoke.
    await page.setContent(LAUNCHER_FIXTURE);

    const platform = new PlaywrightPlatform({
      page,
      environment: staging,
      manifest,
      ui,
    });

    // Skip openGameHost (would hit real staging). Exercise openGame + attach.
    await platform.openGame();

    const driver = new PlaywrightGameDriver({ page, ui, manifest });
    await driver.attach();

    const attached = await driver.isAttached();
    if (!attached) {
      throw new Error('Expected game iframe to be attached after openGame');
    }

    console.log(
      JSON.stringify(
        {
          environment: staging.name,
          baseUrl: staging.baseUrl,
          gameId: manifest.gameId,
          rendering: manifest.metadata?.rendering,
          attached,
          iframe: ui.resolveIframe().selector,
        },
        null,
        2,
      ),
    );

    await driver.detach();
    await platform.dispose();
    console.log('PlaywrightPlatform smoke passed');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
