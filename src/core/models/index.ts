/**
 * Domain models for the SGAP inner ring.
 * Monetary amounts use string to protect currency precision (CP).
 */

import type {
  ControllerId,
  DataSourceKind,
  ExecutionStatus,
  GameEventId,
  GameState,
  TestCategory,
  VerificationKind,
} from '../constants/index.js';

/** Reference to a manual QA test case (Google Sheets source of truth). */
export interface ManualTestRef {
  /** Stable ID, e.g. CSF-001 */
  readonly id: string;
  readonly category: TestCategory;
  readonly title?: string;
}

/** Logical locator key resolved by UI Registry + game manifest. */
export interface LocatorRef {
  readonly key: string;
  readonly description?: string;
}

/** Controllers available for a given game (from manifest). */
export interface ControllerCapability {
  readonly id: ControllerId;
  readonly enabled: boolean;
}

/** Relative canvas point (0–1 of element width/height). */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/** Normalized rectangle on canvas (fractions of width/height). */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ReelSymbolKind =
  | 'scatter'
  | 'high'
  | 'low'
  | 'multiplier'
  | 'wild'
  | 'other';

export interface ReelSymbolDef {
  readonly id: number;
  /** Short catalog name (Heart, Scatter, Multiplier 2x). */
  readonly name: string;
  /** In-game art name (Heart Candy). Falls back to name when omitted. */
  readonly visualName?: string;
  readonly kind?: ReelSymbolKind;
  /** Multiplier bomb value when kind is multiplier. */
  readonly multiplierValue?: number;
  /** Position on the Help/Payout screen, which is not the backend id order. */
  readonly helpOrder?: number;
}

/**
 * Backend vs frontend reel validation (per package).
 * Column/row counts come from the bet response — not hardcoded here.
 */
export interface ReelValidationConfig {
  readonly areaPath: string;
  readonly tumblesPath?: string;
  /** Optional path to nested feature-spin boards inside bet/buy JSON. */
  readonly featureItemsPath?: string;
  /**
   * How `slot.area[col][i]` maps to the visible board.
   * - top-to-bottom (default): index 0 is the top row
   * - bottom-to-top: index 0 is the bottom row (DiJoker Sugar Wonderland)
   */
  readonly rowOrder?: 'top-to-bottom' | 'bottom-to-top';
  readonly symbols: readonly ReelSymbolDef[];
  readonly symbolTemplateDir: string;
  readonly reelRegion: NormalizedRect;
  readonly cellInset?: number;
  readonly matchThreshold?: number;
  readonly helpOpenActions?: readonly string[];
  readonly helpCloseActions?: readonly string[];
}

/**
 * Canvas action map for Phaser / WebGL games.
 * Coordinates are configuration — not hard-coded in controllers.
 */
export interface CanvasActions {
  /** CSS selector for the canvas inside the game iframe (default: "canvas"). */
  readonly canvasSelector?: string;
  /** Named actions → relative click points (e.g. spin). */
  readonly actions: Readonly<Record<string, CanvasPoint>>;
}

/**
 * Scratch-card side game. It opens as a drawer: inside the main canvas when the
 * iframe runs device=mobile, or in a separate canvas beside it on desktop.
 * Drawer points are fractions of the drawer, so one set serves both layouts.
 */
export interface ScratchCardConfig {
  /** Websocket URL glob for the scratch hub (SignalR JSON protocol). */
  readonly hubUrlPattern: string;
  /** Canvas outside the main game canvas; used when it is visible. */
  readonly sideCanvasSelector?: string;
  /** Drawer area inside the main canvas when the side canvas is hidden. */
  readonly inCanvasDrawer: NormalizedRect;
  /** Named drawer points (size3x3, size4x4, size5x5, buyCard, scratchAll, close). */
  readonly actions: Readonly<Record<string, CanvasPoint>>;
  /** Drawer region covering the dust for every grid size. */
  readonly scratchArea: NormalizedRect;
  /** Confirms the in-canvas drawer is open before drawer points are tapped. */
  readonly openProbe?: ScratchOpenProbe;
  /** Named drawer regions whose Phaser texts are read (betValue, legend, totalWin). */
  readonly textAreas?: Readonly<Record<string, NormalizedRect>>;
}

export interface ScratchOpenProbe {
  /** Drawer patch covered by a solid-colour drawer control when open (e.g. the BUY CARD pill). */
  readonly area: NormalizedRect;
  /** Colour of that control. */
  readonly hue: 'green' | 'red' | 'amber' | 'pink';
  /** Fraction (0–1) of patch pixels in `hue` that means the drawer is open. */
  readonly minShare: number;
}

/**
 * Game Manifest — configuration only.
 * Package-specific variance lives here, not in framework code.
 */
export interface GameManifest {
  /** Schema version of the manifest document (e.g. 1.0.0). */
  readonly schemaVersion: string;
  readonly gameId: string;
  readonly displayName: string;
  /**
   * Logical locator key for the game iframe.
   * Must exist in `locatorKeys` and be resolved via UI Registry.
   */
  readonly iframeSelectorKey: string;
  readonly controllers: readonly ControllerCapability[];
  /** Logical locator key → selector string (CSS/Playwright selector text). */
  readonly locatorKeys: Readonly<Record<string, string>>;
  /** Required when metadata.rendering is "canvas". */
  readonly canvasActions?: CanvasActions;
  /** Network endpoints and JSON field paths for Data Sources. */
  readonly network?: NetworkConfig;
  /** Optional backend↔canvas reel symbol validation. */
  readonly reelValidation?: ReelValidationConfig;
  /** Optional scratch-card side game. */
  readonly scratchCard?: ScratchCardConfig;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Network configuration — URL patterns + JSON paths into bet responses.
 * Paths use dotted notation (e.g. "slot.totalWin").
 */
export interface NetworkConfig {
  /** Playwright URL glob for the bet/spin response. Example: double-star/api/v1/slots/bet */
  readonly betUrlPattern: string;
  /** Optional initialize URL glob. Example: double-star/api/v1/slots/initialize */
  readonly initializeUrlPattern?: string;
  /** Optional buy-feature purchase URL glob, when the game does not use the platform default. */
  readonly buyUrlPattern?: string;
  readonly fields: NetworkFieldPaths;
}

export interface NetworkFieldPaths {
  /** Wallet balance after the spin (e.g. "balance"). */
  readonly balance: string;
  /** Total win for this spin (e.g. "slot.totalWin"). */
  readonly totalWin: string;
  /** Optional: transaction lifecycle field (e.g. "transactionState"). */
  readonly transactionState?: string;
  /** Optional: base-game win (e.g. "slot.base.win"). */
  readonly baseWin?: string;
  /** Optional: bonus win (e.g. "slot.bonus.win"). */
  readonly bonusWin?: string;
  /** Optional: id of the round the game must still resolve (platform default "unresolvedSpin"). */
  readonly unresolvedSpin?: string;
}

export interface EnvironmentConfig {
  /** Schema version of the environment document (e.g. 1.0.0). */
  readonly schemaVersion: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly defaultTimeoutMs: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Safety-net wait options — prefer observables over relying on timeout alone. */
export interface ObservableWaitOptions {
  /** Hard safety net only; not a substitute for readiness/events. */
  readonly timeoutMs?: number;
  /**
   * Canvas input. Default is a single click. Set false only when a title
   * still needs click+tap (legacy).
   */
  readonly singleInput?: boolean;
  /**
   * Use the one-shot vision ratio from the last miss. Default is the
   * manifest point — healed coords must not leak into later tests.
   */
  readonly useHealedRatio?: boolean;
}

export interface BalanceSnapshot {
  readonly amount: string;
  readonly currency?: string;
  readonly raw?: unknown;
}

export interface BetSnapshot {
  readonly amount: string;
  readonly currency?: string;
  readonly raw?: unknown;
}

export interface WinSnapshot {
  readonly amount: string;
  readonly currency?: string;
  readonly raw?: unknown;
}

export interface FreeSpinsSnapshot {
  readonly remaining: number;
  readonly total?: number;
  readonly raw?: unknown;
}

export interface SessionSnapshot {
  readonly sessionId?: string;
  readonly isActive: boolean;
  readonly raw?: unknown;
}

export interface WalletSnapshot {
  readonly balance: BalanceSnapshot;
  readonly raw?: unknown;
}

export interface HistoryEntry {
  readonly id: string;
  readonly timestamp?: string;
  readonly raw?: unknown;
}

export interface BetResponseSnapshot {
  readonly raw: unknown;
  readonly bet?: BetSnapshot;
  readonly win?: WinSnapshot;
  readonly balance?: BalanceSnapshot;
  /** Provider transaction state when present (e.g. "completed"). */
  readonly transactionState?: string;
  /**
   * `isEnhancedBet` on the matching /bet POST body.
   * Package 1 payload map: this flag follows Amplify, not the Turbo lightning.
   * Turbo is not present on `/bet` (only action, bet, line, buyFeat, isEnhancedBet, isFs).
   */
  readonly isEnhancedBet?: boolean;
  /** Raw /bet POST JSON when it parsed. Used to map which HUD control owns which field. */
  readonly betRequest?: Readonly<Record<string, unknown>>;
}

export interface GameEventPayload {
  readonly eventId: GameEventId;
  readonly occurredAt: string;
  readonly data?: unknown;
}

export interface VerificationContext {
  readonly manualTest: ManualTestRef;
  readonly gameId: string;
}

export interface VerificationResult {
  readonly kind: VerificationKind;
  readonly passed: boolean;
  readonly message: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export interface ExecutionRecord {
  readonly manualTestId: string;
  readonly status: ExecutionStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly browserProject?: string;
  readonly errorMessage?: string;
  readonly verificationResults?: readonly VerificationResult[];
}

export interface TraceabilityEntry {
  readonly manualTestId: string;
  readonly automationPath: string;
  readonly lastStatus: ExecutionStatus;
  readonly lastRunAt?: string;
}

export interface ControllerLockState {
  readonly locked: boolean;
  readonly lockedBy?: ControllerId;
  readonly reason?: string;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly state: GameState;
  readonly reasons: readonly string[];
}

export interface NetworkRequestRecord {
  readonly url: string;
  readonly method: string;
  readonly status?: number;
  readonly resourceType?: string;
  readonly raw?: unknown;
}

/** Narrow data-source payload map keyed by kind. */
export type DataSourcePayloadMap = {
  betResponse: BetResponseSnapshot;
  balance: BalanceSnapshot;
  history: readonly HistoryEntry[];
  session: SessionSnapshot;
  wallet: WalletSnapshot;
};

export type DataSourcePayload<K extends DataSourceKind> = DataSourcePayloadMap[K];
