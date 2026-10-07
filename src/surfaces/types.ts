/**
 * Surface profile — how a game's HUD *looks and is laid out*, as configuration.
 *
 * The manifest answers "where is the Spin button for this game" (one pinned point).
 * A surface profile answers "what does a Spin button look like, and which region of
 * the canvas should we search" — the data the resolver needs to find a control when
 * the pinned point is wrong. Those numbers used to live as constants in
 * src/eye, src/runtime and tests/support, which made every one of them Sugar-shaped.
 *
 * Profiles inherit: a game file extends its package file, which extends `base`.
 */

import type { ControlHue } from '../eye/canvas-vision.js';

export interface SurfaceBand {
  readonly y0: number;
  readonly y1: number;
  readonly x0?: number;
  readonly x1?: number;
}

/** Colour-blob signature for one control (see src/eye/canvas-vision.ts). */
export interface VisionSignatureConfig {
  readonly hue: ControlHue;
  readonly band?: SurfaceBand;
  readonly minAreaRatio?: number;
  readonly maxAreaRatio?: number;
  readonly pick?: 'largest' | 'leftmost' | 'rightmost';
  /**
   * Where the blob centre must land to be trusted. The search band can be wider so a
   * pill is still found whole; scenery of the same hue merged at the band edge pulls
   * the centre outside this window and is rejected.
   */
  readonly accept?: SurfaceBand;
}

/** Where a control sits in the Phaser scene graph, in canvas ratios and display pixels. */
export interface PhaserBandConfig {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly minW: number;
  readonly minH: number;
  /** Excludes full-width HUD bars that share the band with the control. */
  readonly maxW?: number;
  readonly pick: 'largest' | 'leftmost' | 'rightmost';
}

export interface SurfaceControl {
  readonly vision?: VisionSignatureConfig;
  readonly phaser?: PhaserBandConfig;
  /**
   * Ordered fallback points, tried only after the manifest point and every
   * resolver strategy have failed. Each entry is a canvas ratio.
   */
  readonly candidates?: readonly { readonly x: number; readonly y: number }[];
}

/** A dark mid-canvas panel with no idle control: "press anywhere to continue". */
export interface LumaBlockerConfig {
  /** Luminance is averaged over a full rectangle, so all four edges are required. */
  readonly band: {
    readonly x0: number;
    readonly x1: number;
    readonly y0: number;
    readonly y1: number;
  };
  readonly maxLuma: number;
  readonly center: { readonly x: number; readonly y: number };
}

export interface SurfaceProfile {
  readonly id: string;
  readonly extends?: string;
  readonly notes?: string;
  /** Portrait strip inside a possibly-landscape canvas. */
  readonly portraitAspect: { readonly width: number; readonly height: number };
  /** HUD text used as an anchor or readiness signal, as regex source strings. */
  readonly hudLabels: Readonly<Record<string, string>>;
  readonly controls: Readonly<Record<string, SurfaceControl>>;
  /** Overlays that sit on top of the idle HUD. */
  readonly blockers: Readonly<Record<string, SurfaceControl>>;
  readonly pressAnywhere?: LumaBlockerConfig;
  /**
   * A buy-confirm pill is wide and solid; a round splash Play button is neither.
   * Used to tell "the buy panel is open" from "the splash is showing".
   */
  readonly buyConfirmPill: { readonly minWidthRatio: number; readonly minFill: number };
  /** Idle spin re-scan when scenery of the same hue has merged into the button. */
  readonly idleSpinClip?: { readonly maxAreaRatio: number; readonly solidFill: number };
  /**
   * A splash Play is round: its Phaser box is about as wide as tall, unlike a HUD
   * pill in the same band. Position comes from `controls.attractPlay.phaser`.
   */
  readonly splashPlayShape?: { readonly minAspect: number; readonly maxAspect: number };
}
