/**
 * Engine layer — scene-graph access behind one interface (see engine-adapter.ts).
 */

import './adapters.js';

export {
  engineFor,
  engineIdFor,
  registerEngineAdapter,
  type EngineAdapter,
  type EngineObjectHit,
  type EngineTextHit,
} from './engine-adapter.js';
export { domEngine, opaqueCanvasEngine, phaserEngine } from './adapters.js';
