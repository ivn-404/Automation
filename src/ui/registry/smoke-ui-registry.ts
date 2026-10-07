/**
 * Smoke script: UiRegistry resolves manifest locator keys to selectors.
 * Run after build: node dist/ui/registry/smoke-ui-registry.js
 */
import {
  defaultManifestsDir,
  FileGameManifestLoader,
} from '../../platform/manifest/index.js';
import { LocatorKeyNotFoundError, UiRegistry } from './index.js';

async function main(): Promise<void> {
  const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
  const manifest = await loader.load('example');

  const ui = new UiRegistry(manifest);

  const iframe = ui.resolveIframe();
  const spin = ui.resolve('spinButton');

  console.log(
    JSON.stringify(
      {
        gameId: ui.gameId,
        keys: ui.listKeys(),
        iframe,
        spin,
        // What you pass to Playwright later (driver layer):
        playwrightUsage: {
          iframeSelector: iframe.selector,
          spinButtonSelector: spin.selector,
        },
      },
      null,
      2,
    ),
  );

  try {
    ui.resolve('missingKey');
    throw new Error('Expected LocatorKeyNotFoundError');
  } catch (error) {
    if (!(error instanceof LocatorKeyNotFoundError)) {
      throw error;
    }
  }

  console.log('UiRegistry smoke passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
