/**
 * UI Registry — central locator lookup keyed by manifest + logical names.
 */

export const UI_REGISTRY = 'ui-registry' as const;

export { UiRegistry, type ResolvedLocator } from './ui-registry.js';
export {
  LocatorKeyNotFoundError,
  UiRegistryNotConfiguredError,
} from './errors.js';
