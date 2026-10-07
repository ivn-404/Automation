/**
 * Smoke script: ControllerRegistry with manifest-aware enablement.
 * Run after build: node dist/controllers/registry/smoke-controller-registry.js
 */
import type { ISpinController } from '../../core/contracts/index.js';
import type { ControllerLockState } from '../../core/models/index.js';
import {
  defaultManifestsDir,
  FileGameManifestLoader,
} from '../../platform/manifest/index.js';
import {
  ControllerDisabledError,
  ControllerRegistry,
} from './index.js';

function stubSpinController(): ISpinController {
  return {
    id: 'spin',
    async isAvailable(): Promise<boolean> {
      return true;
    },
    async getLockState(): Promise<ControllerLockState> {
      return { locked: false };
    },
    async isSpinLocked(): Promise<boolean> {
      return false;
    },
    async spin(): Promise<void> {
      /* skeleton — no game logic */
    },
    async clickSpin(): Promise<void> {
      /* skeleton — no game logic */
    },
    async waitForSpinStart(): Promise<void> {
      /* skeleton — no game logic */
    },
    async waitForSpinComplete(): Promise<void> {
      /* skeleton — no game logic */
    },
  };
}

async function main(): Promise<void> {
  const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
  const manifest = await loader.load('example');

  const registry = new ControllerRegistry();
  registry.setManifest(manifest);
  registry.register(stubSpinController());

  console.log(
    JSON.stringify(
      {
        registered: registry.list(),
        enabled: registry.listEnabled(),
        spinEnabled: registry.isEnabled('spin'),
        buyFeatureEnabled: registry.isEnabled('buyFeature'),
      },
      null,
      2,
    ),
  );

  registry.getEnabled('spin');

  try {
    registry.getEnabled('buyFeature');
    throw new Error('Expected ControllerDisabledError for buyFeature');
  } catch (error) {
    if (!(error instanceof ControllerDisabledError)) {
      throw error;
    }
  }

  console.log('ControllerRegistry smoke passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
