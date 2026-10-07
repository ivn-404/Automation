/**
 * Loads a surface profile for a game and resolves its `extends` chain.
 *
 * Resolution order, first hit wins:
 *   1. config/surfaces/<gameId>.json          — this title drifts from its package
 *   2. metadata.surfaceProfile                — explicit opt-in
 *   3. config/surfaces/<metadata.packageId>.json
 *   4. config/surfaces/base.json
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { GameManifest } from '../core/models/index.js';
import type { ControlSignature } from '../eye/canvas-vision.js';
import type {
  PhaserBandConfig,
  SurfaceControl,
  SurfaceProfile,
  VisionSignatureConfig,
} from './types.js';

const BASE_PROFILE_ID = 'base';
const cache = new Map<string, SurfaceProfile>();

export function surfacesDir(): string {
  return path.join(process.cwd(), 'config', 'surfaces');
}

function profilePath(id: string): string {
  return path.join(surfacesDir(), `${id}.json`);
}

function hasProfile(id: string): boolean {
  return existsSync(profilePath(id));
}

/** Child control entries merge field-by-field onto the parent's, not wholesale. */
function mergeControls(
  parent: Readonly<Record<string, SurfaceControl>> | undefined,
  child: Readonly<Record<string, SurfaceControl>> | undefined,
): Readonly<Record<string, SurfaceControl>> {
  const merged: Record<string, SurfaceControl> = { ...(parent ?? {}) };
  for (const [key, control] of Object.entries(child ?? {})) {
    merged[key] = { ...(merged[key] ?? {}), ...control };
  }
  return merged;
}

function readProfileFile(id: string): Partial<SurfaceProfile> & { id: string } {
  const file = profilePath(id);
  if (!existsSync(file)) {
    throw new Error(
      `Surface profile "${id}" not found at ${file}. Add it, or point metadata.surfaceProfile at an existing profile.`,
    );
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Partial<SurfaceProfile> & { id: string };
}

function resolveChain(id: string, seen: readonly string[] = []): SurfaceProfile {
  if (seen.includes(id)) {
    throw new Error(`Surface profile "${id}" extends itself: ${[...seen, id].join(' → ')}`);
  }
  const own = readProfileFile(id);
  if (own.extends === undefined) {
    return own as SurfaceProfile;
  }
  const parent = resolveChain(own.extends, [...seen, id]);
  return {
    ...parent,
    ...own,
    hudLabels: { ...parent.hudLabels, ...(own.hudLabels ?? {}) },
    controls: mergeControls(parent.controls, own.controls),
    blockers: mergeControls(parent.blockers, own.blockers),
  } as SurfaceProfile;
}

/** Which profile id a game resolves to, without loading it. */
export function surfaceProfileIdFor(
  gameId: string,
  metadata?: Readonly<Record<string, string>>,
): string {
  if (hasProfile(gameId)) {
    return gameId;
  }
  const explicit = metadata?.surfaceProfile;
  if (explicit !== undefined && explicit.trim() !== '') {
    return explicit.trim();
  }
  const packageId = metadata?.packageId;
  if (packageId !== undefined && hasProfile(packageId)) {
    return packageId;
  }
  return BASE_PROFILE_ID;
}

export function loadSurfaceProfileById(id: string): SurfaceProfile {
  const cached = cache.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const profile = resolveChain(id);
  cache.set(id, profile);
  return profile;
}

export function loadSurfaceProfile(manifest: GameManifest): SurfaceProfile {
  return loadSurfaceProfileById(surfaceProfileIdFor(manifest.gameId, manifest.metadata));
}

/** Test seam: drop the cache so a rewritten profile file is picked up. */
export function clearSurfaceProfileCache(): void {
  cache.clear();
}

function toSignature(id: string, config: VisionSignatureConfig): ControlSignature {
  return {
    id,
    hue: config.hue,
    ...(config.band !== undefined ? { band: config.band } : {}),
    ...(config.minAreaRatio !== undefined ? { minAreaRatio: config.minAreaRatio } : {}),
    ...(config.maxAreaRatio !== undefined ? { maxAreaRatio: config.maxAreaRatio } : {}),
    ...(config.pick !== undefined ? { pick: config.pick } : {}),
  };
}

/** Colour signature for a control or blocker, or undefined when the profile has none. */
export function visionSignature(
  profile: SurfaceProfile,
  name: string,
): ControlSignature | undefined {
  const config = profile.controls[name]?.vision ?? profile.blockers[name]?.vision;
  return config === undefined ? undefined : toSignature(name, config);
}

/** Every control that can be located by colour, for diagnostics and bulk scans. */
export function visionSignatures(profile: SurfaceProfile): Readonly<Record<string, ControlSignature>> {
  const out: Record<string, ControlSignature> = {};
  for (const [name, control] of Object.entries(profile.controls)) {
    if (control.vision !== undefined) {
      out[name] = toSignature(name, control.vision);
    }
  }
  return out;
}

export function phaserBand(profile: SurfaceProfile, name: string): PhaserBandConfig | undefined {
  return profile.controls[name]?.phaser;
}

export function phaserBands(profile: SurfaceProfile): Readonly<Record<string, PhaserBandConfig>> {
  const out: Record<string, PhaserBandConfig> = {};
  for (const [name, control] of Object.entries(profile.controls)) {
    if (control.phaser !== undefined) {
      out[name] = control.phaser;
    }
  }
  return out;
}

/**
 * Fallback points for a control: the manifest point first (it is pinned config,
 * not a guess), then the profile's ordered candidates.
 */
export function candidatePoints(
  profile: SurfaceProfile,
  manifest: GameManifest,
  name: string,
  extraManifestActions: readonly string[] = [],
): readonly { readonly x: number; readonly y: number }[] {
  const actions = manifest.canvasActions?.actions ?? {};
  const points = [
    actions[name],
    ...extraManifestActions.map((action) => actions[action]),
    ...(profile.controls[name]?.candidates ?? []),
  ];
  return points.filter(
    (point): point is { readonly x: number; readonly y: number } => point !== undefined,
  );
}

export function hudLabelPattern(profile: SurfaceProfile, name: string): RegExp | undefined {
  const source = profile.hudLabels[name];
  return source === undefined ? undefined : new RegExp(source, 'iu');
}
