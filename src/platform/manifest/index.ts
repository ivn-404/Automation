/**
 * Platform manifest module — schema helpers and file loader.
 */

export {
  GAME_MANIFEST_SCHEMA_VERSION,
  GameManifestValidationError,
  parseGameManifest,
} from './parse-game-manifest.js';

export {
  FileGameManifestLoader,
  GameManifestNotFoundError,
  defaultManifestsDir,
  type FileGameManifestLoaderOptions,
} from './file-game-manifest-loader.js';
