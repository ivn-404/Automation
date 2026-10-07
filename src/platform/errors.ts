/**
 * Platform errors.
 */

export class PlatformConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformConfigurationError';
  }
}
