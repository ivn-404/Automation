/**
 * Smoke script: load the example game manifest via FileGameManifestLoader.
 * Run after build: node dist/platform/manifest/smoke-load-manifest.js
 */
import { FileGameManifestLoader, defaultManifestsDir } from './index.js';

async function main(): Promise<void> {
  const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
  const ids = await loader.listGameIds();
  const manifest = await loader.load('example');

  console.log(
    JSON.stringify(
      {
        gameIds: ids,
        loaded: {
          gameId: manifest.gameId,
          displayName: manifest.displayName,
          schemaVersion: manifest.schemaVersion,
          controllersEnabled: manifest.controllers.filter((c) => c.enabled).map((c) => c.id),
          iframeSelector: manifest.locatorKeys[manifest.iframeSelectorKey],
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
