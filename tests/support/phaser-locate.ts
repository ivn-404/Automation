/**
 * Re-export Phaser locate from the framework runtime layer.
 * Adapt to HealOutcome used by canvas-healing callers.
 */

import type { Page } from 'playwright';

import type { GameManifest } from '../../src/core/models/index.js';
import {
  listPhaserInteractive,
  pickPhaserControl,
  locateControlByPhaser as locateControlByPhaserRuntime,
  type PhaserHit,
} from '../../src/runtime/phaser-locate.js';
import type { HealOutcome } from './canvas-healing.js';

export { listPhaserInteractive, pickPhaserControl, type PhaserHit };

export async function locateControlByPhaser(
  page: Page,
  manifest: GameManifest,
  iframeSelector: string,
  actionName: string,
  options?: { readonly remember?: boolean },
): Promise<HealOutcome & { readonly hit?: PhaserHit }> {
  const result = await locateControlByPhaserRuntime(
    page,
    manifest,
    iframeSelector,
    actionName,
    options,
  );
  if (result.found) {
    return {
      stage: 'vision',
      healed: true,
      detail: result.detail,
      hit: result.hit,
    };
  }
  return {
    stage: 'none',
    healed: false,
    detail: result.detail,
  };
}
