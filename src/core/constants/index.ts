/**
 * Shared constants for the SGAP inner ring.
 * No Playwright or game-package imports.
 */

/** Manual test category codes (SGAP_PROJECT_HISTORY). */
export const TEST_CATEGORIES = [
  'CSF',
  'AT',
  'BC',
  'BF',
  'AP',
  'TM',
  'FS',
  'UIDS',
  'AS',
  'SM',
  'ES',
  'CP',
] as const;

export type TestCategory = (typeof TEST_CATEGORIES)[number];

/** Approved controller identifiers — Build Once, Reuse Everywhere. */
export const CONTROLLER_IDS = [
  'spin',
  'autoplay',
  'buyFeature',
  'bet',
  'amplifyBet',
  'turbo',
  'menu',
  'settings',
  'fullscreen',
  'scratchCard',
] as const;

export type ControllerId = (typeof CONTROLLER_IDS)[number];

/** Approved game event identifiers. */
export const GAME_EVENT_IDS = [
  'initialize',
  'offline',
  'reconnect',
  'sessionTimeout',
  'betFailed',
  'bonusStart',
  'bonusEnd',
  'maxWin',
] as const;

export type GameEventId = (typeof GAME_EVENT_IDS)[number];

/** Verification categories from project history. */
export const VERIFICATION_KINDS = [
  'balance',
  'bet',
  'controllerLock',
  'win',
  'freeSpins',
  'uiSynchronization',
  'stateManagement',
] as const;

export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/** Data source kinds from project history. */
export const DATA_SOURCE_KINDS = [
  'betResponse',
  'balance',
  'history',
  'session',
  'wallet',
] as const;

export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];

/**
 * Minimal game lifecycle states for the state machine contract.
 * Exact transition tables are defined when the State Machine layer is implemented.
 */
export const GAME_STATES = [
  'uninitialized',
  'loading',
  'ready',
  'spinning',
  'settling',
  'bonus',
  'error',
  'offline',
  'sessionExpired',
] as const;

export type GameState = (typeof GAME_STATES)[number];

/** Execution outcome for reporting / traceability. */
export const EXECUTION_STATUSES = [
  'passed',
  'failed',
  'skipped',
  'blocked',
  'notRun',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
