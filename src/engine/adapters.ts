/**
 * Built-in engine adapters. Phaser-specific code stays in src/runtime/phaser-locate.ts;
 * this file only binds it to the common interface.
 */

import { listPhaserInteractive, listPhaserTexts } from '../runtime/phaser-locate.js';
import { registerEngineAdapter, type EngineAdapter } from './engine-adapter.js';

export const phaserEngine: EngineAdapter = {
  id: 'phaser',
  readsSceneGraph: true,
  listInteractive: (page, iframeSelector) => listPhaserInteractive(page, iframeSelector),
  listTexts: (page, iframeSelector) => listPhaserTexts(page, iframeSelector),
};

/** A canvas engine with no readable scene graph (or one we have no adapter for yet). */
export const opaqueCanvasEngine: EngineAdapter = {
  id: 'canvas',
  readsSceneGraph: false,
  listInteractive: async () => [],
  listTexts: async () => [],
};

/** DOM titles: controls are located through locatorKeys, not a scene graph. */
export const domEngine: EngineAdapter = {
  id: 'dom',
  readsSceneGraph: false,
  listInteractive: async () => [],
  listTexts: async () => [],
};

for (const adapter of [phaserEngine, opaqueCanvasEngine, domEngine]) {
  registerEngineAdapter(adapter);
}
