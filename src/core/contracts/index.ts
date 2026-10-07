/**
 * SGAP core contracts (ports).
 *
 * Responsibility: define framework boundaries for Clean Architecture.
 * Rule: no Playwright, no game-package imports, no business logic.
 *
 * Implementations live in outer layers (platform, driver, controllers, …).
 */

export * from './controller.js';
export * from './platform.js';
export * from './events.js';
export * from './data.js';
export * from './verification.js';
export * from './state.js';
export * from './reporting.js';
