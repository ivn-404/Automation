/**
 * UI layer — locator definitions resolved through the UI Registry.
 * Common term "locators" maps to this layer.
 */

export const UI_LAYER = 'ui' as const;

export * from './registry/index.js';
