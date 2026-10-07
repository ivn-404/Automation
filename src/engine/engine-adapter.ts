/**
 * Engine adapter — the one seam between the framework and a game engine's scene graph.
 *
 * Controllers, the eye and test support read HUD objects and texts through this
 * interface; only an adapter knows how a given engine stores them. Phaser is one
 * adapter. A title whose engine exposes no readable scene graph uses the canvas
 * adapter, which reports nothing, so every caller falls back to manifest points,
 * surface-profile vision and the network — the same path a Phaser miss already takes.
 *
 * Resolution: `metadata.engine` when set, else `phaser` for canvas titles and `dom`
 * for DOM titles. New engines register an adapter; no caller changes.
 */

import type { Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import type { PhaserHit, PhaserTextHit } from '../runtime/phaser-locate.js';

/** Interactive scene object, centre in canvas ratios. */
export type EngineObjectHit = PhaserHit;
/** Visible text object, bounds in game-space pixels. */
export type EngineTextHit = PhaserTextHit;

export interface EngineAdapter {
  readonly id: string;
  /** False when the engine exposes nothing to read; callers go straight to their fallbacks. */
  readonly readsSceneGraph: boolean;
  listInteractive(page: Page, iframeSelector: string): Promise<readonly EngineObjectHit[]>;
  listTexts(page: Page, iframeSelector: string): Promise<readonly EngineTextHit[]>;
}

const adapters = new Map<string, EngineAdapter>();

export function registerEngineAdapter(adapter: EngineAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function engineIdFor(manifest: Pick<GameManifest, 'metadata'>): string {
  const explicit = manifest.metadata?.engine?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  return (manifest.metadata?.rendering ?? 'dom') === 'canvas' ? 'phaser' : 'dom';
}

export function engineFor(manifest: Pick<GameManifest, 'gameId' | 'metadata'>): EngineAdapter {
  const id = engineIdFor(manifest);
  const adapter = adapters.get(id);
  if (adapter === undefined) {
    throw new Error(
      `No engine adapter "${id}" for ${manifest.gameId}. Registered: ${[...adapters.keys()].join(', ')}. ` +
        'Set metadata.engine to a registered adapter, or register one in src/engine.',
    );
  }
  return adapter;
}
