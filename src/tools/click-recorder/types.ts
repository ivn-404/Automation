/**
 * Click-recorder evidence — human demonstration, not automation code.
 */

export type ClickSurface = 'iframe-canvas' | 'iframe-dom' | 'host-dom' | 'host-canvas';

export type ClickVisualState = 'active' | 'accepted' | 'skipped' | 'reverted';

export type RecorderCommand =
  | 'confirm'
  | 'skip'
  | 'accept'
  | 'close'
  | 'revert-last'
  | 'revert-all';

export interface BoundingBoxSnapshot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverlayReport {
  readonly detected: boolean;
  readonly selector?: string;
  readonly visibility?: string;
  readonly opacity?: string;
  readonly pointerEvents?: string;
  readonly interceptPossible: boolean;
}

export interface LocatorCandidates {
  readonly semantic?: string;
  readonly role?: string;
  readonly text?: string;
  readonly testId?: string;
  readonly id?: string;
  readonly css?: string;
  readonly preferred: 'semantic' | 'dom' | 'role' | 'text' | 'attribute' | 'coordinates';
}

export interface ElementSnapshot {
  readonly tagName: string;
  readonly id?: string;
  readonly className?: string;
  readonly text?: string;
  readonly role?: string;
  readonly name?: string;
  readonly attributes: Record<string, string>;
  readonly boundingBox?: BoundingBoxSnapshot;
  readonly locators: LocatorCandidates;
}

export interface ClickEvidence {
  readonly seq: number;
  readonly state: ClickVisualState;
  readonly surface: ClickSurface;
  readonly pageUrl: string;
  readonly frameUrl?: string;
  readonly inGameIframe: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly normalizedX?: number;
  readonly normalizedY?: number;
  readonly element?: ElementSnapshot;
  readonly overlay?: OverlayReport;
  readonly timestamp: string;
}

export interface RecorderSessionSnapshot {
  readonly gameId: string;
  readonly recordedAt: string;
  readonly clicks: readonly ClickEvidence[];
  readonly accepted: readonly ClickEvidence[];
  readonly skipped: readonly ClickEvidence[];
  readonly reverted: readonly ClickEvidence[];
}
