/**
 * Resolved locator — logical key plus Playwright-ready selector string.
 */
export type ResolvedLocator = {
  readonly key: string;
  readonly selector: string;
  readonly description?: string;
};

/**
 * Manifest-backed UI Registry.
 *
 * Resolves logical locator keys from the game manifest into selector strings.
 * Controllers and the game driver use keys — not hard-coded CSS in framework code.
 */
import type { IUiRegistry } from '../../core/contracts/index.js';
import type { GameManifest } from '../../core/models/index.js';
import { LocatorKeyNotFoundError, UiRegistryNotConfiguredError } from './errors.js';

export class UiRegistry implements IUiRegistry {
  private manifest: GameManifest | undefined;

  constructor(manifest?: GameManifest) {
    this.manifest = manifest;
  }

  setManifest(manifest: GameManifest): void {
    this.manifest = manifest;
  }

  clearManifest(): void {
    this.manifest = undefined;
  }

  has(locatorKey: string): boolean {
    const manifest = this.requireManifest();
    return locatorKey in manifest.locatorKeys;
  }

  listKeys(): readonly string[] {
    const manifest = this.requireManifest();
    return Object.keys(manifest.locatorKeys).sort();
  }

  resolve(locatorKey: string): ResolvedLocator {
    const manifest = this.requireManifest();
    const selector = manifest.locatorKeys[locatorKey];
    if (selector === undefined) {
      throw new LocatorKeyNotFoundError(locatorKey, manifest.gameId);
    }
    return {
      key: locatorKey,
      selector,
    };
  }

  /** Convenience: resolve the manifest's iframe selector key. */
  resolveIframe(): ResolvedLocator {
    const manifest = this.requireManifest();
    return this.resolve(manifest.iframeSelectorKey);
  }

  /** Returns the bound game id (when manifest is set). */
  get gameId(): string | undefined {
    return this.manifest?.gameId;
  }

  private requireManifest(): GameManifest {
    if (this.manifest === undefined) {
      throw new UiRegistryNotConfiguredError();
    }
    return this.manifest;
  }
}
