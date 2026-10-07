export const SURFACES_LAYER = 'surfaces' as const;

export {
  candidatePoints,
  clearSurfaceProfileCache,
  hudLabelPattern,
  loadSurfaceProfile,
  loadSurfaceProfileById,
  phaserBand,
  phaserBands,
  surfaceProfileIdFor,
  surfacesDir,
  visionSignature,
  visionSignatures,
} from './load-surface-profile.js';

export type {
  LumaBlockerConfig,
  PhaserBandConfig,
  SurfaceBand,
  SurfaceControl,
  SurfaceProfile,
  VisionSignatureConfig,
} from './types.js';
