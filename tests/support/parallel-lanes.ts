/**
 * Configurable 4-lane Playwright parallel layout.
 *
 * Dual-monitor row (default):
 *
 *   [W1] [W2]  |  [W3] [W4]
 *
 * Single-monitor fallback is a 2×2 quadrant:
 *
 *   [W1] [W2]
 *   [W3] [W4]
 *
 * Assignments live in config/parallel-workers.json.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ParallelLane {
  readonly id: number;
  readonly category: string;
  readonly categories?: readonly string[];
  readonly testDir?: string;
  readonly testMatch?: readonly string[];
  readonly playerId: string;
  readonly gameId?: string;
  readonly gameName?: string;
  readonly packageId?: string;
  readonly monitor?: number;
  readonly slot?: number;
  readonly col?: number;
  readonly row?: number;
}

export interface ParallelWorkersConfig {
  readonly workers: number;
  readonly layout?: string;
  readonly defaultBalance: number;
  readonly defaultBetLimit?: number;
  readonly minimumBetBalance: number;
  readonly lanes: readonly ParallelLane[];
}

export interface ParallelLaneRuntime {
  readonly id: number;
  readonly category: string;
  readonly playerId: string;
  readonly monitor: number;
  readonly slot: number;
  readonly col: number;
  readonly row: number;
  readonly defaultBalance?: number;
  readonly defaultBetLimit?: number;
}

export interface LaneWindowTarget {
  readonly id?: number;
  readonly monitor?: number;
  readonly slot?: number;
  readonly col?: number;
  readonly row?: number;
}

/** SGAP_PARALLEL_CONFIG points at an alternate lane layout, for comparing worker counts. */
export function parallelWorkersConfigPath(): string {
  const override = process.env.SGAP_PARALLEL_CONFIG;
  if (override !== undefined && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.join(process.cwd(), 'config', 'parallel-workers.json');
}

export function loadParallelWorkersConfig(): ParallelWorkersConfig {
  const filePath = parallelWorkersConfigPath();
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ParallelWorkersConfig;
  if (!Array.isArray(parsed.lanes) || parsed.lanes.length === 0) {
    throw new Error(`${filePath} must define at least one lane`);
  }
  validateLaneAssignments(parsed);
  // SGAP_TESTER is resolved and sanitised by scripts/lib/sgap-tester.mjs in the parallel runner.
  const tester = process.env.SGAP_TESTER?.trim() ?? '';
  if (tester.length === 0) {
    return parsed;
  }
  return {
    ...parsed,
    lanes: parsed.lanes.map((lane) => ({
      ...lane,
      playerId: lane.playerId.endsWith(`_${tester}`) ? lane.playerId : `${lane.playerId}_${tester}`,
    })),
  };
}

export function testMatchForLane(lane: ParallelLane): string[] {
  if (lane.testMatch !== undefined && lane.testMatch.length > 0) {
    return lane.testMatch.map((glob) =>
      glob.includes('*') ? glob : `${glob.replace(/\/$/, '')}/**/*.spec.ts`,
    );
  }
  if (lane.testDir !== undefined && lane.testDir.length > 0) {
    const relative = lane.testDir.replace(/^tests\/specs\/?/, '').replace(/\/$/, '');
    if (relative.length === 0) {
      throw new Error(`Lane ${lane.id} testDir must be a category folder under tests/specs`);
    }
    return [`${relative}/**/*.spec.ts`];
  }
  throw new Error(`Lane ${lane.id} must define testMatch or testDir`);
}

export function laneAssignmentLabel(lane: ParallelLane): string {
  if (lane.categories !== undefined && lane.categories.length > 0) {
    return lane.categories.join(' ');
  }
  return lane.category;
}

export function validateLaneAssignments(config: ParallelWorkersConfig): void {
  const seen = new Map<string, number>();
  for (const lane of config.lanes) {
    const namespace = lane.gameId ?? '*';
    for (const glob of testMatchForLane(lane)) {
      const key = `${namespace}:${glob}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        throw new Error(
          `testMatch ${glob} is assigned to workers ${previous} and ${lane.id} for ${namespace}`,
        );
      }
      seen.set(key, lane.id);
    }
  }
}

export function workerTag(lane: Pick<ParallelLaneRuntime, 'id' | 'category' | 'playerId'>): string {
  return `[Worker ${lane.id}][${lane.category}][${lane.playerId}]`;
}

export function projectNameForLane(lane: Pick<ParallelLane, 'id' | 'category'>): string {
  return `w${lane.id}-${lane.category}`;
}

export function parseScreensEnv(raw: string | undefined): ScreenRect[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(';')
    .map((part) => {
      const [leftRaw, topRaw, widthRaw, heightRaw] = part.split(',');
      const left = Number(leftRaw);
      const top = Number(topRaw);
      const width = Number(widthRaw);
      const height = Number(heightRaw);
      if (
        ![left, top, width, height].every((value) => Number.isFinite(value)) ||
        width <= 0 ||
        height <= 0
      ) {
        return undefined;
      }
      return { left, top, width, height };
    })
    .filter((screen): screen is ScreenRect => screen !== undefined);
}

export function loadScreens(): ScreenRect[] {
  const fromEnv = parseScreensEnv(process.env.SGAP_SCREENS);
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  return [screenRect()];
}

export function screenRect(): ScreenRect {
  const width = Number(process.env.SGAP_SCREEN_WIDTH ?? '1920');
  const height = Number(process.env.SGAP_SCREEN_HEIGHT ?? '1080');
  const left = Number(process.env.SGAP_SCREEN_LEFT ?? '0');
  const top = Number(process.env.SGAP_SCREEN_TOP ?? '0');
  return {
    left: Number.isFinite(left) ? left : 0,
    top: Number.isFinite(top) ? top : 0,
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

export function screenSize(): { readonly width: number; readonly height: number } {
  const rect = screenRect();
  return { width: rect.width, height: rect.height };
}

function finiteIndex(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function resolveLanePlacement(lane: LaneWindowTarget): {
  readonly monitor: number;
  readonly slot: number;
  readonly col: number;
  readonly row: number;
} {
  const id = lane.id ?? 1;
  const monitor = finiteIndex(lane.monitor) ?? Math.floor((id - 1) / 2);
  const slot = finiteIndex(lane.slot) ?? ((id - 1) % 2);
  return {
    monitor,
    slot,
    col: finiteIndex(lane.col) ?? slot,
    row: finiteIndex(lane.row) ?? monitor,
  };
}

/** Gap between the right edge of the desktop and the first hidden lane window. */
const OFF_SCREEN_GAP = 400;

/**
 * Lane windows are tiled on the tester's screens. SGAP_BROWSER_VIEW=hidden (opt-in,
 * for unattended runs) moves them off-screen instead; Playwright's Chromium
 * switches keep occluded windows rendering, so only the window position differs.
 */
export function isBrowserViewVisible(): boolean {
  return process.env.SGAP_BROWSER_VIEW?.trim().toLowerCase() !== 'hidden';
}

function offScreen(bounds: ScreenRect, screens: readonly ScreenRect[]): ScreenRect {
  const minLeft = Math.min(...screens.map((screen) => screen.left));
  const maxRight = Math.max(...screens.map((screen) => screen.left + screen.width));
  return { ...bounds, left: bounds.left + (maxRight - minLeft) + OFF_SCREEN_GAP };
}

/**
 * Worker windows for layout `1 2 | 3 4`:
 * - two or more screens: W1/W2 split the left monitor, W3/W4 split the right
 * - one screen: 2×2 quadrants with W1/W2 on top and W3/W4 on the bottom
 *
 * The cell size decides the game viewport, so a hidden lane keeps its cell size
 * and only moves past the right edge of the desktop.
 */
export function windowBoundsForLane(lane: LaneWindowTarget): ScreenRect {
  const screens = loadScreens();
  const cell = laneCell(lane, screens);
  return isBrowserViewVisible() ? cell : offScreen(cell, screens);
}

function laneCell(lane: LaneWindowTarget, screens: readonly ScreenRect[]): ScreenRect {
  const placement = resolveLanePlacement(lane);

  if (screens.length >= 2) {
    const screen = screens[Math.min(placement.monitor, screens.length - 1)] ?? screens[0]!;
    const cellW = Math.max(1, Math.floor(screen.width / 2));
    return {
      left: screen.left + placement.slot * cellW,
      top: screen.top,
      width: cellW,
      height: screen.height,
    };
  }

  const screen = screens[0] ?? { left: 0, top: 0, width: 1920, height: 1080 };
  const cellW = Math.max(1, Math.floor(screen.width / 2));
  const cellH = Math.max(1, Math.floor(screen.height / 2));
  return {
    left: screen.left + placement.col * cellW,
    top: screen.top + placement.row * cellH,
    width: cellW,
    height: cellH,
  };
}

export function laneFromProjectMetadata(
  metadata: Record<string, unknown> | undefined,
): ParallelLaneRuntime | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const id = Number(metadata.sgapWorkerId);
  if (!Number.isFinite(id) || id <= 0) {
    return undefined;
  }
  const playerId = typeof metadata.sgapPlayerId === 'string' ? metadata.sgapPlayerId : '';
  const category = typeof metadata.sgapCategory === 'string' ? metadata.sgapCategory : '';
  const defaultBalance =
    typeof metadata.sgapDefaultBalance === 'number' ? metadata.sgapDefaultBalance : undefined;
  const defaultBetLimit =
    typeof metadata.sgapDefaultBetLimit === 'number' ? metadata.sgapDefaultBetLimit : undefined;
  const placement = resolveLanePlacement({
    id,
    monitor: finiteIndex(Number(metadata.sgapMonitor)),
    slot: finiteIndex(Number(metadata.sgapSlot)),
    col: finiteIndex(Number(metadata.sgapGridCol)),
    row: finiteIndex(Number(metadata.sgapGridRow)),
  });
  return {
    id,
    category,
    playerId,
    ...placement,
    defaultBalance,
    defaultBetLimit,
  };
}
