export type EyeLayer = 'host' | 'canvas';

export type EyePolicy = 'continue' | 'dismiss' | 'restartSession' | 'leave';

export type EyeIntent = 'spin' | 'buyFeature' | 'bet' | 'autoplay' | 'idle' | 'resumeFeature';

export interface EyeScreenDefinition {
  readonly id: string;
  readonly layer: EyeLayer;
  readonly policy: EyePolicy;
  readonly readyFor?: readonly string[];
  readonly hostPatterns?: readonly string[];
  readonly hostButtons?: readonly string[];
  readonly canvasActions?: readonly string[];
  readonly neverClick?: readonly string[];
}

export interface EyeCatalog {
  readonly version: number;
  readonly templateMatchMinScore: number;
  readonly maxRecoveryPasses: number;
  readonly screens: readonly EyeScreenDefinition[];
}

export interface EyeObservation {
  readonly screenId: string;
  readonly policy: EyePolicy;
  readonly via: 'host-text' | 'template' | 'ttl' | 'idle';
  readonly score?: number;
  readonly handled: boolean;
}
