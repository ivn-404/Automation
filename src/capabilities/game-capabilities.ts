/**
 * What a game supports, answered from configuration alone.
 *
 * Configuration is authoritative: a feature is never "detected" by clicking around,
 * because a missed click would turn into a false N/A. Three states:
 * - supported:   declared enabled (`controllers[].enabled: true`, `metadata[cap]: "true"`,
 *   package `capabilities[cap]: true`, or the config block the feature needs exists).
 * - unsupported: declared absent (`enabled: false`, `metadata[cap]: "false"`,
 *   package `capabilities[cap]: false`) → N/A.
 * - unmapped:    not declared at all → configuration gap, reported as a failure so a
 *   partially mapped manifest never turns real features into N/A.
 *
 * Feature capabilities resolve game manifest first, then the package profile
 * (`config/packages/<packageId>.json`). Config-backed capabilities (reel validation,
 * symbol catalog) are supported only when their data exists; a package default
 * cannot claim them for a game that has no data.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { CONTROLLER_IDS, type ControllerId } from '../core/constants/index.js';
import type { GameManifest } from '../core/models/index.js';
import { packageProfileFor } from './package-profile.js';

/** Game facts that are not a controller but still decide whether a case applies. */
export const FEATURE_CAPABILITIES = [
  'normalModeMultiplier',
  /** A free-spins round (bought or triggered) with its own spin count. */
  'freeSpins',
  /** Scatters landing in the base game trigger the feature naturally. */
  'scatterTrigger',
  /** Scatters landing during free spins award more spins. */
  'freeSpinRetrigger',
  /** Winning symbols clear and the board refills within one round. */
  'tumble',
  /** Multiplier symbols (bombs / wilds) that scale a round's win. */
  'multiplierWild',
  /** A themed feature screen reached by buying the feature. */
  'scatterMode',
  /** `manifest.reelValidation` maps the bet payload board to symbols. */
  'reelValidation',
  /** Symbol ids → names/kinds, from the package profile or config/symbols/<gameId>. */
  'symbolCatalog',
  /** The server declares a max-win cap in initialize and enforces it. */
  'maxWin',
] as const;

export type FeatureCapability = (typeof FEATURE_CAPABILITIES)[number];
export type Capability = ControllerId | FeatureCapability;

function isControllerId(capability: Capability): capability is ControllerId {
  return (CONTROLLER_IDS as readonly string[]).includes(capability);
}

export type CapabilityStatus = 'supported' | 'unsupported' | 'unmapped';

/** Capabilities whose support is the presence of their configuration data. */
const CONFIG_BACKED: Partial<Record<FeatureCapability, (manifest: GameManifest) => boolean>> = {
  reelValidation: (manifest) => manifest.reelValidation !== undefined,
  symbolCatalog: (manifest) =>
    packageProfileFor(manifest)?.hasSymbolCatalog === true ||
    existsSync(path.join(process.cwd(), 'config', 'symbols', manifest.gameId, 'catalog.json')),
};

export function capabilityStatus(manifest: GameManifest, capability: Capability): CapabilityStatus {
  if (isControllerId(capability)) {
    const entry = manifest.controllers.find((candidate) => candidate.id === capability);
    if (entry === undefined) return 'unmapped';
    return entry.enabled ? 'supported' : 'unsupported';
  }
  const value = manifest.metadata?.[capability];
  if (value === 'false') return 'unsupported';
  const hasData = CONFIG_BACKED[capability];
  if (hasData !== undefined) {
    return hasData(manifest) ? 'supported' : 'unmapped';
  }
  if (value === 'true') return 'supported';
  const packageDefault = packageProfileFor(manifest)?.capabilities[capability];
  if (packageDefault === true) return 'supported';
  if (packageDefault === false) return 'unsupported';
  return 'unmapped';
}

export function supportsCapability(manifest: GameManifest, capability: Capability): boolean {
  return capabilityStatus(manifest, capability) === 'supported';
}

export function missingCapabilities(
  manifest: GameManifest,
  capabilities: readonly Capability[],
): Capability[] {
  return capabilities.filter((capability) => !supportsCapability(manifest, capability));
}

function capabilitiesWithStatus(
  manifest: GameManifest,
  capabilities: readonly Capability[],
  status: CapabilityStatus,
): Capability[] {
  return capabilities.filter((capability) => capabilityStatus(manifest, capability) === status);
}

/** Declared absent by the manifest → the case is N/A for this game. */
export function unsupportedCapabilities(
  manifest: GameManifest,
  capabilities: readonly Capability[],
): Capability[] {
  return capabilitiesWithStatus(manifest, capabilities, 'unsupported');
}

/** Not declared either way → the manifest is incomplete; never N/A. */
export function unmappedCapabilities(
  manifest: GameManifest,
  capabilities: readonly Capability[],
): Capability[] {
  return capabilitiesWithStatus(manifest, capabilities, 'unmapped');
}

export function notConfiguredMessage(manifest: GameManifest, capabilities: readonly Capability[]): string {
  const unmapped = unmappedCapabilities(manifest, capabilities);
  return `NOT CONFIGURED — ${manifest.displayName} does not declare ${unmapped.join(', ')} (add a controllers[] entry, a metadata key, a package capabilities entry, or the reelValidation / symbol catalog data)`;
}

/** Every capability the manifest declares, controllers first. */
export function listCapabilities(manifest: GameManifest): Capability[] {
  return [...CONTROLLER_IDS, ...FEATURE_CAPABILITIES].filter((capability) =>
    supportsCapability(manifest, capability),
  );
}

/** Skip / report text. Starts with `N/A` so reporting can tell it from a plain skip. */
export function notApplicableReason(
  manifest: GameManifest,
  capabilities: readonly Capability[],
): string {
  const unsupported = unsupportedCapabilities(manifest, capabilities);
  return `N/A — ${manifest.displayName} does not support ${unsupported.join(', ')}`;
}

export const NOT_APPLICABLE_PREFIX = 'N/A';

export function isNotApplicableReason(reason: string | undefined): boolean {
  return reason?.startsWith(NOT_APPLICABLE_PREFIX) === true;
}
