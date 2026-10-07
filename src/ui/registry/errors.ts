/**
 * UI Registry errors.
 */

export class LocatorKeyNotFoundError extends Error {
  readonly locatorKey: string;
  readonly gameId?: string;

  constructor(locatorKey: string, gameId?: string) {
    const scope = gameId !== undefined ? ` for game "${gameId}"` : '';
    super(`Locator key "${locatorKey}" not found${scope}`);
    this.name = 'LocatorKeyNotFoundError';
    this.locatorKey = locatorKey;
    this.gameId = gameId;
  }
}

export class UiRegistryNotConfiguredError extends Error {
  constructor() {
    super('UI Registry has no manifest bound; call setManifest() first');
    this.name = 'UiRegistryNotConfiguredError';
  }
}
