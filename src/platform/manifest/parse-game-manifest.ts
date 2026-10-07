/**
 * Game Manifest parse / validate.
 * Runtime validation without external schema libraries (zero extra deps).
 * JSON Schema at config/manifests/schema/ is the human/docs source of truth shape.
 */

import { CONTROLLER_IDS, type ControllerId } from '../../core/constants/index.js';
import type {
  CanvasActions,
  CanvasPoint,
  ControllerCapability,
  GameManifest,
  NetworkConfig,
  NetworkFieldPaths,
  NormalizedRect,
  ReelSymbolDef,
  ReelSymbolKind,
  ReelValidationConfig,
  ScratchCardConfig,
  ScratchOpenProbe,
} from '../../core/models/index.js';

export const GAME_MANIFEST_SCHEMA_VERSION = '1.0.0' as const;

const CONTROLLER_ID_SET = new Set<string>(CONTROLLER_IDS);
const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class GameManifestValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Game manifest validation failed at "${path}": ${message}`);
    this.name = 'GameManifestValidationError';
    this.path = path;
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GameManifestValidationError(path, 'expected a plain object');
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GameManifestValidationError(path, 'expected a non-empty string');
  }
}

function parseControllers(value: unknown, path: string): readonly ControllerCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GameManifestValidationError(path, 'expected a non-empty array');
  }

  const seen = new Set<string>();
  const controllers: ControllerCapability[] = [];

  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    assertObject(item, itemPath);
    assertNonEmptyString(item.id, `${itemPath}.id`);

    if (!CONTROLLER_ID_SET.has(item.id)) {
      throw new GameManifestValidationError(
        `${itemPath}.id`,
        `unknown controller id "${item.id}"; allowed: ${CONTROLLER_IDS.join(', ')}`,
      );
    }

    if (seen.has(item.id)) {
      throw new GameManifestValidationError(`${itemPath}.id`, `duplicate controller id "${item.id}"`);
    }
    seen.add(item.id);

    if (typeof item.enabled !== 'boolean') {
      throw new GameManifestValidationError(`${itemPath}.enabled`, 'expected a boolean');
    }

    controllers.push({
      id: item.id as ControllerId,
      enabled: item.enabled,
    });
  });

  return controllers;
}

function parseLocatorKeys(value: unknown, path: string): Readonly<Record<string, string>> {
  assertObject(value, path);
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new GameManifestValidationError(path, 'expected at least one locator key');
  }

  const locatorKeys: Record<string, string> = {};
  for (const [key, selector] of entries) {
    if (key.trim().length === 0) {
      throw new GameManifestValidationError(path, 'locator key names must be non-empty');
    }
    assertNonEmptyString(selector, `${path}.${key}`);
    locatorKeys[key] = selector;
  }
  return locatorKeys;
}

function parseMetadata(value: unknown, path: string): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertObject(value, path);
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertNonEmptyString(entry, `${path}.${key}`);
    metadata[key] = entry;
  }
  return metadata;
}

function parseCanvasPoint(value: unknown, path: string): CanvasPoint {
  assertObject(value, path);
  if (typeof value.x !== 'number' || !Number.isFinite(value.x) || value.x < 0 || value.x > 1) {
    throw new GameManifestValidationError(`${path}.x`, 'expected a number between 0 and 1');
  }
  if (typeof value.y !== 'number' || !Number.isFinite(value.y) || value.y < 0 || value.y > 1) {
    throw new GameManifestValidationError(`${path}.y`, 'expected a number between 0 and 1');
  }
  return { x: value.x, y: value.y };
}

function parseCanvasActions(value: unknown, path: string): CanvasActions | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertObject(value, path);

  let canvasSelector: string | undefined;
  if (value.canvasSelector !== undefined) {
    assertNonEmptyString(value.canvasSelector, `${path}.canvasSelector`);
    canvasSelector = value.canvasSelector;
  }

  assertObject(value.actions, `${path}.actions`);
  const actionEntries = Object.entries(value.actions);
  if (actionEntries.length === 0) {
    throw new GameManifestValidationError(`${path}.actions`, 'expected at least one action');
  }

  const actions: Record<string, CanvasPoint> = {};
  for (const [name, point] of actionEntries) {
    if (name.trim().length === 0) {
      throw new GameManifestValidationError(`${path}.actions`, 'action names must be non-empty');
    }
    actions[name] = parseCanvasPoint(point, `${path}.actions.${name}`);
  }

  return {
    ...(canvasSelector !== undefined ? { canvasSelector } : {}),
    actions,
  };
}

function parseNetworkFieldPaths(value: unknown, path: string): NetworkFieldPaths {
  assertObject(value, path);
  assertNonEmptyString(value.balance, `${path}.balance`);
  assertNonEmptyString(value.totalWin, `${path}.totalWin`);

  let transactionState: string | undefined;
  let baseWin: string | undefined;
  let bonusWin: string | undefined;

  if (value.transactionState !== undefined) {
    assertNonEmptyString(value.transactionState, `${path}.transactionState`);
    transactionState = value.transactionState;
  }
  if (value.baseWin !== undefined) {
    assertNonEmptyString(value.baseWin, `${path}.baseWin`);
    baseWin = value.baseWin;
  }
  if (value.bonusWin !== undefined) {
    assertNonEmptyString(value.bonusWin, `${path}.bonusWin`);
    bonusWin = value.bonusWin;
  }
  let unresolvedSpin: string | undefined;
  if (value.unresolvedSpin !== undefined) {
    assertNonEmptyString(value.unresolvedSpin, `${path}.unresolvedSpin`);
    unresolvedSpin = value.unresolvedSpin;
  }

  return {
    balance: value.balance,
    totalWin: value.totalWin,
    ...(transactionState !== undefined ? { transactionState } : {}),
    ...(baseWin !== undefined ? { baseWin } : {}),
    ...(bonusWin !== undefined ? { bonusWin } : {}),
    ...(unresolvedSpin !== undefined ? { unresolvedSpin } : {}),
  };
}

function parseNetworkConfig(value: unknown, path: string): NetworkConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertObject(value, path);
  assertNonEmptyString(value.betUrlPattern, `${path}.betUrlPattern`);

  let initializeUrlPattern: string | undefined;
  if (value.initializeUrlPattern !== undefined) {
    assertNonEmptyString(value.initializeUrlPattern, `${path}.initializeUrlPattern`);
    initializeUrlPattern = value.initializeUrlPattern;
  }

  return {
    betUrlPattern: value.betUrlPattern,
    ...(initializeUrlPattern !== undefined ? { initializeUrlPattern } : {}),
    fields: parseNetworkFieldPaths(value.fields, `${path}.fields`),
  };
}

function parseNormalizedRect(value: unknown, path: string): NormalizedRect {
  assertObject(value, path);
  const x = value.x;
  const y = value.y;
  const width = value.width;
  const height = value.height;
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new GameManifestValidationError(`${path}.x`, 'expected a finite number');
  }
  if (typeof y !== 'number' || !Number.isFinite(y)) {
    throw new GameManifestValidationError(`${path}.y`, 'expected a finite number');
  }
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    throw new GameManifestValidationError(`${path}.width`, 'expected a finite number');
  }
  if (typeof height !== 'number' || !Number.isFinite(height)) {
    throw new GameManifestValidationError(`${path}.height`, 'expected a finite number');
  }
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new GameManifestValidationError(path, 'x/y must be between 0 and 1');
  }
  if (width <= 0 || height <= 0 || x + width > 1.0001 || y + height > 1.0001) {
    throw new GameManifestValidationError(path, 'width/height must fit within the canvas (0–1)');
  }
  return { x, y, width, height };
}

function parseReelValidation(value: unknown, path: string): ReelValidationConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertObject(value, path);
  assertNonEmptyString(value.areaPath, `${path}.areaPath`);
  assertNonEmptyString(value.symbolTemplateDir, `${path}.symbolTemplateDir`);

  if (!Array.isArray(value.symbols) || value.symbols.length === 0) {
    throw new GameManifestValidationError(`${path}.symbols`, 'expected a non-empty array');
  }

  const symbols: ReelSymbolDef[] = value.symbols.map((entry, index) => {
    const entryPath = `${path}.symbols[${index}]`;
    assertObject(entry, entryPath);
    if (typeof entry.id !== 'number' || !Number.isInteger(entry.id)) {
      throw new GameManifestValidationError(`${entryPath}.id`, 'expected an integer');
    }
    assertNonEmptyString(entry.name, `${entryPath}.name`);
    let visualName: string | undefined;
    if (entry.visualName !== undefined) {
      assertNonEmptyString(entry.visualName, `${entryPath}.visualName`);
      visualName = entry.visualName;
    }
    let kind: ReelSymbolKind | undefined;
    if (entry.kind !== undefined) {
      assertNonEmptyString(entry.kind, `${entryPath}.kind`);
      const allowed: ReelSymbolKind[] = ['scatter', 'high', 'low', 'multiplier', 'wild', 'other'];
      if (!allowed.includes(entry.kind as ReelSymbolKind)) {
        throw new GameManifestValidationError(
          `${entryPath}.kind`,
          'expected scatter|high|low|multiplier|wild|other',
        );
      }
      kind = entry.kind as ReelSymbolKind;
    }
    let multiplierValue: number | undefined;
    if (entry.multiplierValue !== undefined) {
      if (typeof entry.multiplierValue !== 'number' || !Number.isFinite(entry.multiplierValue)) {
        throw new GameManifestValidationError(`${entryPath}.multiplierValue`, 'expected a finite number');
      }
      multiplierValue = entry.multiplierValue;
    }
    return {
      id: entry.id,
      name: entry.name,
      ...(visualName !== undefined ? { visualName } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(multiplierValue !== undefined ? { multiplierValue } : {}),
    };
  });

  let tumblesPath: string | undefined;
  if (value.tumblesPath !== undefined) {
    assertNonEmptyString(value.tumblesPath, `${path}.tumblesPath`);
    tumblesPath = value.tumblesPath;
  }

  let featureItemsPath: string | undefined;
  if (value.featureItemsPath !== undefined) {
    assertNonEmptyString(value.featureItemsPath, `${path}.featureItemsPath`);
    featureItemsPath = value.featureItemsPath;
  }

  let cellInset: number | undefined;
  if (value.cellInset !== undefined) {
    if (typeof value.cellInset !== 'number' || value.cellInset < 0 || value.cellInset >= 0.45) {
      throw new GameManifestValidationError(`${path}.cellInset`, 'expected 0 ≤ number < 0.45');
    }
    cellInset = value.cellInset;
  }

  let matchThreshold: number | undefined;
  if (value.matchThreshold !== undefined) {
    if (
      typeof value.matchThreshold !== 'number' ||
      value.matchThreshold < 0 ||
      value.matchThreshold > 1
    ) {
      throw new GameManifestValidationError(`${path}.matchThreshold`, 'expected 0–1');
    }
    matchThreshold = value.matchThreshold;
  }

  let helpOpenActions: string[] | undefined;
  if (value.helpOpenActions !== undefined) {
    if (!Array.isArray(value.helpOpenActions)) {
      throw new GameManifestValidationError(`${path}.helpOpenActions`, 'expected string array');
    }
    helpOpenActions = value.helpOpenActions.map((action, index) => {
      assertNonEmptyString(action, `${path}.helpOpenActions[${index}]`);
      return action;
    });
  }

  let helpCloseActions: string[] | undefined;
  if (value.helpCloseActions !== undefined) {
    if (!Array.isArray(value.helpCloseActions)) {
      throw new GameManifestValidationError(`${path}.helpCloseActions`, 'expected string array');
    }
    helpCloseActions = value.helpCloseActions.map((action, index) => {
      assertNonEmptyString(action, `${path}.helpCloseActions[${index}]`);
      return action;
    });
  }

  let rowOrder: ReelValidationConfig['rowOrder'];
  if (value.rowOrder !== undefined) {
    if (value.rowOrder !== 'top-to-bottom' && value.rowOrder !== 'bottom-to-top') {
      throw new GameManifestValidationError(
        `${path}.rowOrder`,
        'expected "top-to-bottom" or "bottom-to-top"',
      );
    }
    rowOrder = value.rowOrder;
  }

  return {
    areaPath: value.areaPath,
    ...(tumblesPath !== undefined ? { tumblesPath } : {}),
    ...(featureItemsPath !== undefined ? { featureItemsPath } : {}),
    ...(rowOrder !== undefined ? { rowOrder } : {}),
    symbols,
    symbolTemplateDir: value.symbolTemplateDir,
    reelRegion: parseNormalizedRect(value.reelRegion, `${path}.reelRegion`),
    ...(cellInset !== undefined ? { cellInset } : {}),
    ...(matchThreshold !== undefined ? { matchThreshold } : {}),
    ...(helpOpenActions !== undefined ? { helpOpenActions } : {}),
    ...(helpCloseActions !== undefined ? { helpCloseActions } : {}),
  };
}

function parseScratchCard(value: unknown, path: string): ScratchCardConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertObject(value, path);
  assertNonEmptyString(value.hubUrlPattern, `${path}.hubUrlPattern`);

  let sideCanvasSelector: string | undefined;
  if (value.sideCanvasSelector !== undefined) {
    assertNonEmptyString(value.sideCanvasSelector, `${path}.sideCanvasSelector`);
    sideCanvasSelector = value.sideCanvasSelector;
  }

  assertObject(value.actions, `${path}.actions`);
  const actions: Record<string, CanvasPoint> = {};
  for (const [name, point] of Object.entries(value.actions)) {
    actions[name] = parseCanvasPoint(point, `${path}.actions.${name}`);
  }
  for (const required of ['buyCard', 'close']) {
    if (!(required in actions)) {
      throw new GameManifestValidationError(`${path}.actions.${required}`, 'required drawer point');
    }
  }

  let textAreas: Record<string, NormalizedRect> | undefined;
  if (value.textAreas !== undefined) {
    assertObject(value.textAreas, `${path}.textAreas`);
    textAreas = {};
    for (const [name, rect] of Object.entries(value.textAreas)) {
      textAreas[name] = parseNormalizedRect(rect, `${path}.textAreas.${name}`);
    }
  }

  return {
    hubUrlPattern: value.hubUrlPattern,
    ...(sideCanvasSelector !== undefined ? { sideCanvasSelector } : {}),
    inCanvasDrawer: parseNormalizedRect(value.inCanvasDrawer, `${path}.inCanvasDrawer`),
    actions,
    scratchArea: parseNormalizedRect(value.scratchArea, `${path}.scratchArea`),
    ...(value.openProbe !== undefined
      ? { openProbe: parseScratchOpenProbe(value.openProbe, `${path}.openProbe`) }
      : {}),
    ...(textAreas !== undefined ? { textAreas } : {}),
  };
}

function parseScratchOpenProbe(value: unknown, path: string): ScratchOpenProbe {
  assertObject(value, path);
  const hues = ['green', 'red', 'amber', 'pink'] as const;
  const hue = hues.find((entry) => entry === value.hue);
  if (hue === undefined) {
    throw new GameManifestValidationError(`${path}.hue`, `expected one of ${hues.join('|')}`);
  }
  const minShare = value.minShare;
  if (typeof minShare !== 'number' || !Number.isFinite(minShare) || minShare <= 0 || minShare > 1) {
    throw new GameManifestValidationError(`${path}.minShare`, 'expected a number in (0, 1]');
  }
  return { area: parseNormalizedRect(value.area, `${path}.area`), hue, minShare };
}

/**
 * Parses and validates unknown JSON into a GameManifest.
 * Does not load files — pure validation for reuse by loaders and tests.
 */
export function parseGameManifest(input: unknown): GameManifest {
  assertObject(input, '$');

  assertNonEmptyString(input.schemaVersion, '$.schemaVersion');
  if (input.schemaVersion !== GAME_MANIFEST_SCHEMA_VERSION) {
    throw new GameManifestValidationError(
      '$.schemaVersion',
      `unsupported version "${input.schemaVersion}"; expected "${GAME_MANIFEST_SCHEMA_VERSION}"`,
    );
  }

  assertNonEmptyString(input.gameId, '$.gameId');
  if (!GAME_ID_PATTERN.test(input.gameId)) {
    throw new GameManifestValidationError(
      '$.gameId',
      'must be kebab-case alphanumeric (e.g. "star-burst")',
    );
  }

  assertNonEmptyString(input.displayName, '$.displayName');
  assertNonEmptyString(input.iframeSelectorKey, '$.iframeSelectorKey');

  const controllers = parseControllers(input.controllers, '$.controllers');
  const locatorKeys = parseLocatorKeys(input.locatorKeys, '$.locatorKeys');
  const metadata = parseMetadata(input.metadata, '$.metadata');
  const canvasActions = parseCanvasActions(input.canvasActions, '$.canvasActions');
  const network = parseNetworkConfig(input.network, '$.network');
  const reelValidation = parseReelValidation(input.reelValidation, '$.reelValidation');
  const scratchCard = parseScratchCard(input.scratchCard, '$.scratchCard');

  if (!(input.iframeSelectorKey in locatorKeys)) {
    throw new GameManifestValidationError(
      '$.iframeSelectorKey',
      `key "${input.iframeSelectorKey}" must exist in locatorKeys`,
    );
  }

  if (metadata?.rendering === 'canvas' && canvasActions === undefined) {
    throw new GameManifestValidationError(
      '$.canvasActions',
      'required when metadata.rendering is "canvas"',
    );
  }

  const spinEnabled = controllers.some((entry) => entry.id === 'spin' && entry.enabled);
  if (canvasActions !== undefined && spinEnabled && !('spin' in canvasActions.actions)) {
    throw new GameManifestValidationError(
      '$.canvasActions.actions.spin',
      'canvas games with the spin controller enabled must define a "spin" action point',
    );
  }

  const allowedKeys = new Set([
    'schemaVersion',
    'gameId',
    'displayName',
    'iframeSelectorKey',
    'controllers',
    'locatorKeys',
    'canvasActions',
    'network',
    'reelValidation',
    'scratchCard',
    'metadata',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new GameManifestValidationError(`$.${key}`, 'unknown property');
    }
  }

  return {
    schemaVersion: GAME_MANIFEST_SCHEMA_VERSION,
    gameId: input.gameId,
    displayName: input.displayName,
    iframeSelectorKey: input.iframeSelectorKey,
    controllers,
    locatorKeys,
    ...(canvasActions !== undefined ? { canvasActions } : {}),
    ...(network !== undefined ? { network } : {}),
    ...(reelValidation !== undefined ? { reelValidation } : {}),
    ...(scratchCard !== undefined ? { scratchCard } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
