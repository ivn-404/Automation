/**
 * Backend Reader capture — follow on-screen cadence for any spin type:
 *
 *   Idle: Screenshot → Backend grid
 *   Spin: Screenshot only (in-motion)
 *   Idle: Screenshot → Backend grid
 *   Spin: Screenshot only
 *   …
 *
 * Works for normal spins with tumbles, buy feature, and free spins.
 * Backend JSON is still source of truth for Idle boards; Spin frames have no grid.
 */

import { randomUUID } from 'node:crypto';

import type { Page, Response } from 'playwright';

import type { GameManifest, NormalizedRect } from '../../core/models/index.js';
import type { PlaywrightGameDriver } from '../../driver/playwright-game-driver.js';
import { isBuyPurchaseResponse } from '../../network/bet-response-watcher.js';
import { freeSpinItemsRemaining, isFreeSpinBundleComplete } from '../../platform/canvas-session-primer.js';
import { captureLocator } from '../../platform/stable-screenshot.js';
import { getByPath } from '../../shared/json-path.js';
import { readBackendSpin, type BackendBoardView, type BackendSpinGroup } from './backend-reader.js';
import { compareImages, cropImage, decodePng, type RgbaImage } from './image-match.js';
import { loadPackageCatalog } from './package-catalog.js';
import { matchesBetUrl, matchesBuyUrl } from '../../network/bet-url.js';

const KEEP_SEQUENCES = 50;
const MAX_STEPS_PER_SEQUENCE = 400;
const POLL_MS = 250;
const STABLE_MAE = 0.016;
const CHANGE_MAE = 0.04;
const STABLE_FRAMES = 6;
const POST_IDLE_HOLD_MS = 350;
/** Idle budgets — grids publish first; shots follow animation when possible. */
const REEL_STOP_MIN_MS = 700;
const REEL_STOP_MAX_MS = 6_000;
/** Bundled buy/FS: many boards in one payload — tighter waits so tests stay movable. */
const BUNDLED_STOP_MIN_MS = 400;
const BUNDLED_STOP_MAX_MS = 4_500;
const TUMBLE_CHANGE_MAX_MS = 3_500;
const TUMBLE_STABLE_MAX_MS = 5_500;
const BUNDLED_TUMBLE_CHANGE_MAX_MS = 2_500;
const BUNDLED_TUMBLE_STABLE_MAX_MS = 4_000;
const TEARDOWN_WAIT_MS = 45_000;
const FEATURE_IDLE_CLOSE_MS = 25_000;
const NORMAL_IDLE_CLOSE_MS = 8_000;
const REFRESH_STOP_MS = 1_500;

const IMMEDIATE_RESTART_IDS = new Set([
  'AT-006',
  'SM-006',
  'FS-009',
  'ES-001',
  'ES-005',
  'ES-010',
]);

export type BackendReaderEventLabel =
  | 'Normal Spin'
  | 'Buy Bonus Mode'
  | 'Autoplay Scatter'
  | 'Autoplay Spin'
  | 'Autoplay Free Spin'
  | 'Scatter Trigger'
  | 'Free Spin'
  | 'Tumble Sequence';

export type ShotQuality = 'idle' | 'uncertain' | 'pending' | 'motion';

export type ReaderStepKind = 'idle' | 'spin';

export interface AttachBackendReaderCaptureOptions {
  readonly page: Page;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly workerId?: number;
  readonly testId: string;
  readonly testTitle: string;
  readonly isAutoplayActive?: () => boolean;
  readonly waitOnStop?: boolean;
}

export interface BackendReaderStepPayload {
  readonly key: string;
  readonly title: string;
  readonly spinIndex: number;
  /** Idle = settled shot + backend; Spin = in-motion shot only. */
  readonly kind: ReaderStepKind;
  readonly boardKind?: 'stop' | 'tumble';
  readonly columns: number;
  readonly rows: number;
  readonly ids: readonly (readonly number[])[];
  readonly names: readonly (readonly string[])[];
  readonly freeSpinsRemaining?: number;
  readonly shotQuality?: ShotQuality;
  readonly pngBase64?: string;
  /** JSON path this board/spin was read from (e.g. slot.freeSpin.items[2].area). */
  readonly sourcePath?: string;
  /** Per-spin / per-board slice of the network payload for Reader display. */
  readonly payloadSnippet?: unknown;
}

interface QueuedBet {
  readonly body: unknown;
  readonly buy: boolean;
  readonly autoplay: boolean;
  readonly requestUrl?: string;
}

interface OpenEvent {
  readonly eventId: string;
  readonly label: BackendReaderEventLabel;
  spinIndex: number;
  awaitingMore: boolean;
  stepCount: number;
  featureSpinsTarget: number;
  featureSpinsSeen: number;
  featureActive: boolean;
  /** spinIndex of the buy/scatter opener (excluded from Free Spin N/N count). */
  openerSpinIndex: number;
}

export function isImmediateRestartSpec(testId: string, testTitle: string): boolean {
  if (IMMEDIATE_RESTART_IDS.has(testId)) {
    return true;
  }
  return /refresh|reload|restart/i.test(`${testId} ${testTitle}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReaderEnabled(): boolean {
  const flag = process.env.SGAP_BACKEND_READER?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') {
    return false;
  }
  return typeof process.env.SGAP_MONITOR_URL === 'string' && process.env.SGAP_MONITOR_URL.length > 0;
}

function isSpinNetwork(url: string): boolean {
  return matchesBetUrl(url) || matchesBuyUrl(url);
}

function countScatter(ids: readonly (readonly number[])[], scatterIds: ReadonlySet<number>): number {
  let count = 0;
  for (const row of ids) {
    for (const id of row) {
      if (scatterIds.has(id)) {
        count += 1;
      }
    }
  }
  return count;
}

export function labelBackendReaderEvent(options: {
  readonly buy: boolean;
  readonly autoplay: boolean;
  readonly scatterCount: number;
  readonly scatterTriggerAt: number;
  readonly freeSpinItems: number;
  readonly tumbleCount: number;
}): BackendReaderEventLabel {
  if (options.buy) {
    return 'Buy Bonus Mode';
  }
  if (options.autoplay && options.scatterCount >= options.scatterTriggerAt) {
    return 'Autoplay Scatter';
  }
  if (options.scatterCount >= options.scatterTriggerAt) {
    return 'Scatter Trigger';
  }
  if (options.freeSpinItems > 0) {
    return options.autoplay ? 'Autoplay Free Spin' : 'Free Spin';
  }
  if (options.tumbleCount > 0) {
    return 'Tumble Sequence';
  }
  if (options.autoplay) {
    return 'Autoplay Spin';
  }
  return 'Normal Spin';
}

async function readResponseBody(response: Response): Promise<unknown | undefined> {
  try {
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    return JSON.parse(text) as unknown;
  } catch {
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }
}

async function captureCanvasPng(driver: PlaywrightGameDriver): Promise<Buffer | undefined> {
  try {
    if (!(await driver.isAttached())) {
      return undefined;
    }
    const canvas = driver.gameCanvas();
    if ((await canvas.count()) === 0) {
      return undefined;
    }
    return await captureLocator(canvas, { timeout: 4_000, label: 'backend reader' });
  } catch {
    return undefined;
  }
}

function reelRegionImage(image: RgbaImage, region?: NormalizedRect): RgbaImage {
  if (region === undefined) {
    return image;
  }
  return cropImage(
    image,
    region.x * image.width,
    region.y * image.height,
    region.width * image.width,
    region.height * image.height,
  );
}

function reelMae(a: RgbaImage, b: RgbaImage, region?: NormalizedRect): number {
  return compareImages(reelRegionImage(a, region), reelRegionImage(b, region)).mae;
}

/**
 * Wait for reel idle. On timeout returns undefined (uncertain) — never a mid-animation frame.
 */
async function waitUntilReelIdle(options: {
  readonly driver: PlaywrightGameDriver;
  readonly region?: NormalizedRect;
  readonly minMs: number;
  readonly maxMs: number;
  readonly shouldAbort: () => boolean;
}): Promise<Buffer | undefined> {
  await sleep(options.minMs);
  let lastImage: RgbaImage | undefined;
  let same = 0;
  const started = Date.now();
  while (!options.shouldAbort() && Date.now() - started < options.maxMs) {
    const png = await captureCanvasPng(options.driver);
    if (png === undefined) {
      await sleep(POLL_MS);
      continue;
    }
    try {
      const image = decodePng(png);
      if (lastImage !== undefined) {
        const mae = reelMae(image, lastImage, options.region);
        if (mae <= STABLE_MAE) {
          same += 1;
          if (same >= STABLE_FRAMES) {
            await sleep(POST_IDLE_HOLD_MS);
            if (options.shouldAbort()) {
              return undefined;
            }
            const confirm = await captureCanvasPng(options.driver);
            if (confirm === undefined) {
              return undefined;
            }
            try {
              if (reelMae(decodePng(confirm), image, options.region) <= STABLE_MAE) {
                return confirm;
              }
            } catch {
              return undefined;
            }
            same = 0;
            lastImage = decodePng(confirm);
            await sleep(POLL_MS);
            continue;
          }
        } else {
          same = 0;
        }
      }
      lastImage = image;
    } catch {
      same = 0;
    }
    await sleep(POLL_MS);
  }
  return undefined;
}

async function waitUntilNextTumbleIdle(options: {
  readonly driver: PlaywrightGameDriver;
  readonly region?: NormalizedRect;
  readonly previousPng?: Buffer;
  readonly shouldAbort: () => boolean;
  readonly changeMaxMs?: number;
  readonly stableMaxMs?: number;
}): Promise<Buffer | undefined> {
  let previousImage: RgbaImage | undefined;
  if (options.previousPng !== undefined) {
    try {
      previousImage = decodePng(options.previousPng);
    } catch {
      previousImage = undefined;
    }
  }

  const changeMax = options.changeMaxMs ?? TUMBLE_CHANGE_MAX_MS;
  const stableMax = options.stableMaxMs ?? TUMBLE_STABLE_MAX_MS;
  const changeStarted = Date.now();
  let sawChange = previousImage === undefined;
  while (!options.shouldAbort() && Date.now() - changeStarted < changeMax) {
    const png = await captureCanvasPng(options.driver);
    if (png !== undefined && previousImage !== undefined) {
      try {
        if (reelMae(decodePng(png), previousImage, options.region) >= CHANGE_MAE) {
          sawChange = true;
          break;
        }
      } catch {
        sawChange = true;
        break;
      }
    }
    await sleep(POLL_MS);
  }

  return waitUntilReelIdle({
    driver: options.driver,
    region: options.region,
    minMs: sawChange ? 250 : 150,
    maxMs: stableMax,
    shouldAbort: options.shouldAbort,
  });
}

/** Best-effort single frame when idle detection times out — still better than no image. */
async function captureBestEffortPng(
  driver: PlaywrightGameDriver,
  shouldAbort: () => boolean,
): Promise<Buffer | undefined> {
  if (shouldAbort()) {
    return undefined;
  }
  return captureCanvasPng(driver);
}

/**
 * Wait until the reel starts moving (vs previous idle frame), then grab a motion shot.
 */
async function waitUntilMotionShot(options: {
  readonly driver: PlaywrightGameDriver;
  readonly region?: NormalizedRect;
  readonly previousPng?: Buffer;
  readonly shouldAbort: () => boolean;
  readonly changeMaxMs?: number;
}): Promise<Buffer | undefined> {
  let previousImage: RgbaImage | undefined;
  if (options.previousPng !== undefined) {
    try {
      previousImage = decodePng(options.previousPng);
    } catch {
      previousImage = undefined;
    }
  }

  const changeMax = options.changeMaxMs ?? TUMBLE_CHANGE_MAX_MS;
  const changeStarted = Date.now();
  while (!options.shouldAbort() && Date.now() - changeStarted < changeMax) {
    const png = await captureCanvasPng(options.driver);
    if (png === undefined) {
      await sleep(POLL_MS);
      continue;
    }
    if (previousImage === undefined) {
      return png;
    }
    try {
      if (reelMae(decodePng(png), previousImage, options.region) >= CHANGE_MAE) {
        // Hold briefly so the frame is mid-spin / mid-tumble, not the first flicker.
        await sleep(120);
        if (options.shouldAbort()) {
          return png;
        }
        return (await captureCanvasPng(options.driver)) ?? png;
      }
    } catch {
      return png;
    }
    await sleep(POLL_MS);
  }
  return captureBestEffortPng(options.driver, options.shouldAbort);
}

function boardTitle(options: {
  readonly label: BackendReaderEventLabel;
  readonly spinIndex: number;
  readonly boardIndex: number;
  readonly isOpener: boolean;
  readonly featureSpinsTarget: number;
  readonly featureSpinsSeen: number;
  readonly groupTitle?: string;
}): string {
  let spinHead: string;
  if (options.groupTitle !== undefined) {
    spinHead = options.groupTitle;
  } else if (options.isOpener && (options.label === 'Buy Bonus Mode' || options.label === 'Scatter Trigger' || options.label === 'Autoplay Scatter')) {
    spinHead = options.label === 'Buy Bonus Mode' ? 'Buy Bonus' : options.label;
  } else if (options.featureSpinsTarget > 0 && options.featureSpinsSeen > 0) {
    spinHead = `Free Spin ${options.featureSpinsSeen}/${options.featureSpinsTarget}`;
  } else {
    spinHead = `Spin ${options.spinIndex}`;
  }
  if (options.boardIndex === 0) {
    return `${spinHead} · Stop`;
  }
  return `${spinHead} · Tumble ${options.boardIndex}`;
}

/**
 * Listen for bet/buy responses and publish every board + optional idle shot.
 */
export function attachBackendReaderCapture(
  options: AttachBackendReaderCaptureOptions,
): () => Promise<void> {
  if (!isReaderEnabled()) {
    return async () => undefined;
  }

  const base = process.env.SGAP_MONITOR_URL!.replace(/\/$/, '');
  const waitOnStop = options.waitOnStop !== false;
  const reelRegion = options.manifest.reelValidation?.reelRegion;
  let stopped = false;
  let abortWaits = false;
  let inFlight = 0;
  let eventChain: Promise<void> = Promise.resolve();
  let openEvent: OpenEvent | undefined;

  function withEventLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = eventChain.then(fn, fn);
    eventChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  let catalog: ReturnType<typeof loadPackageCatalog> | undefined;
  try {
    catalog = loadPackageCatalog(options.manifest.gameId);
  } catch {
    catalog = undefined;
  }
  const payloadHints = {
    featureItemsPath:
      catalog?.featureItemsPath ?? options.manifest.reelValidation?.featureItemsPath,
  };
  const scatterIds = new Set(
    (catalog?.symbols ?? options.manifest.reelValidation?.symbols ?? [])
      .filter((entry) => entry.kind === 'scatter')
      .map((entry) => entry.id),
  );
  if (scatterIds.size === 0) {
    scatterIds.add(0);
  }

  const shouldAbort = (): boolean => abortWaits || (stopped && !waitOnStop);
  let lastActivityAt = Date.now();

  function idleCloseMs(): number {
    return openEvent?.featureActive === true || openEvent?.awaitingMore === true
      ? FEATURE_IDLE_CLOSE_MS
      : NORMAL_IDLE_CLOSE_MS;
  }

  async function publishSteps(
    event: OpenEvent,
    steps: readonly BackendReaderStepPayload[],
    meta: {
      readonly columns: number;
      readonly rows: number;
      readonly catalogId?: string;
      readonly totalWin?: number;
      readonly sourcePath: string;
      readonly payload?: unknown;
      readonly requestUrl?: string;
    },
    done: boolean,
  ): Promise<void> {
    if (steps.length === 0 && !done && meta.payload === undefined) {
      return;
    }
    try {
      await fetch(`${base}/api/reader/sequence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.eventId,
          workerId: options.workerId ?? (Number(process.env.SGAP_WORKER_ID ?? '0') || undefined),
          testId: options.testId,
          testTitle: options.testTitle,
          label: event.label,
          columns: meta.columns,
          rows: meta.rows,
          catalogId: meta.catalogId,
          totalWin: meta.totalWin,
          keep: KEEP_SEQUENCES,
          sourcePath: meta.sourcePath,
          featureSpinsTarget: event.featureSpinsTarget || undefined,
          featureSpinsSeen: event.featureSpinsSeen || undefined,
          payload: meta.payload,
          requestUrl: meta.requestUrl,
          done,
          steps,
        }),
      });
    } catch {
      // Reader is optional.
    }
  }

  interface SpinCaptureContext {
    readonly event: OpenEvent;
    readonly read: ReturnType<typeof readBackendSpin>;
    readonly body: unknown;
    readonly requestUrl?: string;
    readonly spinIndex: number;
    readonly isOpener: boolean;
    readonly featureSpinsSeen: number;
    readonly featureSpinsTarget: number;
    readonly freeSpinItems: number;
    readonly buy: boolean;
    readonly bundledFeature: boolean;
  }

  function payloadSnippetForGroup(body: unknown, group: BackendSpinGroup): unknown {
    const source = group.sourcePath;
    if (typeof source === 'string' && source.includes('.items[')) {
      const match = /^(.*\.items)\[(\d+)\]/u.exec(source);
      if (match !== null) {
        const items = getByPath(body, match[1]!);
        const index = Number(match[2]);
        if (Array.isArray(items) && items[index] !== undefined) {
          return items[index];
        }
      }
    }
    const slot = getByPath(body, 'slot') ?? getByPath(body, 'data.slot');
    if (slot !== null && typeof slot === 'object') {
      const typed = slot as Record<string, unknown>;
      return {
        area: typed.area,
        tumbles: typed.tumbles,
        totalWin: typed.totalWin,
        base: typed.base,
        bonus: typed.bonus,
        freeSpin: typed.freeSpin
          ? {
              multiplierValue: (typed.freeSpin as { multiplierValue?: unknown }).multiplierValue,
              itemsCount: Array.isArray((typed.freeSpin as { items?: unknown }).items)
                ? ((typed.freeSpin as { items: unknown[] }).items.length)
                : 0,
            }
          : undefined,
      };
    }
    return body;
  }

  async function assignSpinContext(item: QueuedBet): Promise<SpinCaptureContext | undefined> {
    return withEventLock(() => {
      const read = readBackendSpin(item.body, {
        catalog,
        gameId: options.manifest.gameId,
        areaPath: options.manifest.reelValidation?.areaPath,
        tumblesPath: options.manifest.reelValidation?.tumblesPath,
        featureItemsPath: payloadHints.featureItemsPath,
        rowOrder: options.manifest.reelValidation?.rowOrder,
        symbols: options.manifest.reelValidation?.symbols,
      });
      const stopBoard = read.boards[0];
      const scatterCount = stopBoard === undefined ? 0 : countScatter(stopBoard.ids, scatterIds);
      const freeSpinItems = freeSpinItemsRemaining(item.body, payloadHints);
      const bundledFeature = isFreeSpinBundleComplete(item.body, payloadHints);
      const fsGroupCount = read.spinGroups.filter((group) => group.fsIndex !== undefined).length;
      const spinLabel = labelBackendReaderEvent({
        buy: item.buy,
        autoplay: item.autoplay,
        scatterCount,
        scatterTriggerAt: 4,
        freeSpinItems: bundledFeature ? fsGroupCount : freeSpinItems,
        tumbleCount: read.tumbles.length,
      });

      const opensFeature =
        item.buy ||
        (scatterCount >= 4 && (freeSpinItems > 0 || bundledFeature)) ||
        (freeSpinItems > 0 && openEvent === undefined);

      const sameEvent =
        openEvent !== undefined &&
        (openEvent.awaitingMore || openEvent.featureActive) &&
        (freeSpinItems > 0 ||
          bundledFeature ||
          openEvent.featureActive ||
          item.buy ||
          (openEvent.featureSpinsSeen < openEvent.featureSpinsTarget &&
            openEvent.featureSpinsTarget > 0));

      if (openEvent !== undefined && !sameEvent) {
        const closing = openEvent;
        void publishSteps(
          closing,
          [],
          {
            columns: read.columns,
            rows: read.rows,
            catalogId: read.catalogId,
            totalWin: read.totalWin,
            sourcePath: read.sourcePath,
          },
          true,
        );
        openEvent = undefined;
      }

      if (openEvent === undefined) {
        openEvent = {
          eventId: randomUUID(),
          label: spinLabel,
          spinIndex: 0,
          awaitingMore: false,
          stepCount: 0,
          featureSpinsTarget: 0,
          featureSpinsSeen: 0,
          featureActive: false,
          openerSpinIndex: 0,
        };
      }

      if (opensFeature) {
        openEvent.featureActive = true;
        if (bundledFeature && fsGroupCount > 0) {
          openEvent.featureSpinsTarget = fsGroupCount;
          openEvent.featureSpinsSeen = fsGroupCount;
          openEvent.awaitingMore = false;
        } else {
          openEvent.awaitingMore = true;
          if (freeSpinItems > 0) {
            openEvent.featureSpinsTarget = Math.max(openEvent.featureSpinsTarget, freeSpinItems);
          }
        }
      }

      openEvent.spinIndex += 1;
      const spinIndex = openEvent.spinIndex;
      const isOpener = opensFeature && (item.buy || openEvent.openerSpinIndex === 0);

      if (isOpener) {
        openEvent.openerSpinIndex = spinIndex;
        if (bundledFeature && fsGroupCount > 0) {
          openEvent.featureSpinsTarget = fsGroupCount;
          openEvent.featureSpinsSeen = fsGroupCount;
        } else if (freeSpinItems > 0) {
          openEvent.featureSpinsTarget = Math.max(openEvent.featureSpinsTarget, freeSpinItems);
        }
      } else if (openEvent.featureActive && spinIndex > openEvent.openerSpinIndex && !bundledFeature) {
        openEvent.featureSpinsSeen += 1;
        if (freeSpinItems > 0) {
          openEvent.featureSpinsTarget = Math.max(
            openEvent.featureSpinsTarget,
            freeSpinItems + openEvent.featureSpinsSeen,
          );
        }
      }

      lastActivityAt = Date.now();
      return {
        event: { ...openEvent },
        read,
        body: item.body,
        requestUrl: item.requestUrl,
        spinIndex,
        isOpener,
        featureSpinsSeen: openEvent.featureSpinsSeen,
        featureSpinsTarget: openEvent.featureSpinsTarget,
        freeSpinItems,
        buy: item.buy,
        bundledFeature,
      };
    });
  }

  async function finalizeSpinContext(ctx: SpinCaptureContext): Promise<void> {
    await withEventLock(() => {
      if (openEvent === undefined || openEvent.eventId !== ctx.event.eventId) {
        return;
      }
      if (ctx.bundledFeature) {
        openEvent.awaitingMore = false;
        openEvent.featureActive = false;
        const fsCount = ctx.read.spinGroups.filter((group) => group.fsIndex !== undefined).length;
        if (fsCount > 0) {
          openEvent.featureSpinsTarget = fsCount;
          openEvent.featureSpinsSeen = fsCount;
        }
      } else if (openEvent.featureActive) {
        const stillHaveItems = ctx.freeSpinItems > 0;
        const stillExpecting =
          openEvent.featureSpinsTarget > 0 &&
          openEvent.featureSpinsSeen < openEvent.featureSpinsTarget;
        openEvent.awaitingMore = stillHaveItems || stillExpecting;
        if (!openEvent.awaitingMore) {
          openEvent.featureActive = false;
        }
      } else {
        openEvent.awaitingMore = false;
      }

      if (!openEvent.awaitingMore) {
        const closing = openEvent;
        openEvent = undefined;
        void publishSteps(
          closing,
          [],
          {
            columns: ctx.read.columns,
            rows: ctx.read.rows,
            catalogId: ctx.read.catalogId,
            totalWin: ctx.read.totalWin,
            sourcePath: ctx.read.sourcePath,
          },
          true,
        );
        lastActivityAt = Date.now();
      }
    });
  }

  function groupTitleFor(
    ctx: SpinCaptureContext,
    group: BackendSpinGroup,
  ): string {
    if (group.key === 'opener' && ctx.buy) {
      return 'Buy Bonus';
    }
    if (group.fsIndex !== undefined) {
      return `Free Spin ${group.fsIndex}/${group.fsTotal ?? group.fsIndex}`;
    }
    return group.title;
  }

  function makeIdleStep(
    ctx: SpinCaptureContext,
    board: BackendBoardView,
    boardIndex: number,
    group: BackendSpinGroup,
    spinIndex: number,
    isOpener: boolean,
    featureSpinsSeen: number,
    shot?: { png?: Buffer; quality: ShotQuality },
  ): BackendReaderStepPayload {
    const groupTitle = groupTitleFor(ctx, group);
    const boardLabel = board.symbolsOnly
      ? board.title
      : boardTitle({
          label: ctx.event.label,
          spinIndex,
          boardIndex,
          isOpener,
          featureSpinsTarget: ctx.featureSpinsTarget,
          featureSpinsSeen,
          groupTitle,
        }).replace(`${groupTitle} · `, '');
    return {
      key: `idle-${spinIndex}-${group.key}-${board.key}`,
      title: `Idle · ${groupTitle} · ${boardLabel}`,
      spinIndex,
      kind: 'idle',
      boardKind: boardIndex === 0 && !board.symbolsOnly ? 'stop' : 'tumble',
      columns: board.columns,
      rows: board.rows,
      ids: board.ids,
      names: board.names,
      freeSpinsRemaining: ctx.freeSpinItems,
      shotQuality: shot?.quality ?? 'pending',
      pngBase64: shot?.png?.toString('base64'),
      sourcePath: group.sourcePath,
      payloadSnippet: payloadSnippetForGroup(ctx.body, group),
    };
  }

  function makeSpinStep(
    ctx: SpinCaptureContext,
    from: { group: BackendSpinGroup; board: BackendBoardView; spinIndex: number },
    toward: { group: BackendSpinGroup; board: BackendBoardView; boardIndex: number },
    shot?: { png?: Buffer; quality: ShotQuality },
  ): BackendReaderStepPayload {
    const fromTitle = groupTitleFor(ctx, from.group);
    const towardTitle = groupTitleFor(ctx, toward.group);
    const towardLabel =
      toward.boardIndex === 0 && !toward.board.symbolsOnly
        ? 'Stop'
        : toward.board.symbolsOnly
          ? toward.board.title
          : `Tumble ${toward.boardIndex}`;
    return {
      key: `spin-${from.spinIndex}-${from.group.key}-${from.board.key}-to-${toward.group.key}-${toward.board.key}`,
      title: `Spin · ${fromTitle} → ${towardTitle} · ${towardLabel}`,
      spinIndex: from.spinIndex,
      kind: 'spin',
      columns: ctx.read.columns,
      rows: ctx.read.rows,
      ids: [],
      names: [],
      freeSpinsRemaining: ctx.freeSpinItems,
      shotQuality: shot?.quality ?? 'pending',
      pngBase64: shot?.png?.toString('base64'),
    };
  }

  /**
   * Record cadence for every board:
   *   Idle (shot + backend) → Spin (shot only) → Idle → Spin → …
   */
  async function captureSpinBoards(ctx: SpinCaptureContext): Promise<void> {
    const meta = {
      columns: ctx.read.columns,
      rows: ctx.read.rows,
      catalogId: ctx.read.catalogId,
      totalWin: ctx.read.totalWin,
      sourcePath: ctx.read.sourcePath,
      payload: ctx.body,
      requestUrl: ctx.requestUrl,
    };

    const bundled = ctx.bundledFeature;
    const capturePlan: Array<{
      group: BackendSpinGroup;
      board: BackendBoardView;
      boardIndex: number;
      spinIndex: number;
      isOpener: boolean;
      featureSpinsSeen: number;
    }> = [];

    for (let groupIndex = 0; groupIndex < ctx.read.spinGroups.length; groupIndex += 1) {
      const group = ctx.read.spinGroups[groupIndex]!;
      const spinState = await withEventLock(() => {
        if (openEvent === undefined || openEvent.eventId !== ctx.event.eventId) {
          return undefined;
        }
        if (groupIndex > 0) {
          openEvent.spinIndex += 1;
        }
        const spinIndex = openEvent.spinIndex;
        const isOpener = groupIndex === 0 && ctx.isOpener;
        const featureSpinsSeen = group.fsIndex ?? (isOpener ? 0 : openEvent.featureSpinsSeen);
        if (group.fsIndex !== undefined) {
          openEvent.featureSpinsSeen = Math.max(openEvent.featureSpinsSeen, group.fsIndex);
        }
        return { spinIndex, isOpener, featureSpinsSeen };
      });
      if (spinState === undefined) {
        break;
      }

      for (let boardIndex = 0; boardIndex < group.boards.length; boardIndex += 1) {
        if (capturePlan.length >= MAX_STEPS_PER_SEQUENCE) {
          break;
        }
        const board = group.boards[boardIndex]!;
        capturePlan.push({
          group,
          board,
          boardIndex,
          spinIndex: spinState.spinIndex,
          isOpener: spinState.isOpener,
          featureSpinsSeen: group.fsIndex ?? spinState.featureSpinsSeen,
        });
      }
    }

    let previousPng: Buffer | undefined;
    let previousGroupKey: string | undefined;

    for (let planIndex = 0; planIndex < capturePlan.length; planIndex += 1) {
      const plan = capturePlan[planIndex]!;
      const { group, board, boardIndex, spinIndex, isOpener, featureSpinsSeen } = plan;
      const next = capturePlan[planIndex + 1];

      if (shouldAbort()) {
        // Still publish remaining Idle backends without shots so grids are not lost.
        const remaining: BackendReaderStepPayload[] = [];
        for (let i = planIndex; i < capturePlan.length; i += 1) {
          const entry = capturePlan[i]!;
          remaining.push(
            makeIdleStep(
              ctx,
              entry.board,
              entry.boardIndex,
              entry.group,
              entry.spinIndex,
              entry.isOpener,
              entry.featureSpinsSeen,
              { quality: 'uncertain' },
            ),
          );
        }
        if (remaining.length > 0) {
          await withEventLock(() => {
            if (openEvent !== undefined && openEvent.eventId === ctx.event.eventId) {
              openEvent.stepCount += remaining.length;
            }
          });
          await publishSteps(ctx.event, remaining, meta, false);
        }
        return;
      }

      // —— IDLE: wait settle → screenshot + backend ——
      const isNewSpinGroup = previousGroupKey !== undefined && previousGroupKey !== group.key;
      const isStopBoard = boardIndex === 0 && !board.symbolsOnly;
      let idlePng: Buffer | undefined;
      let idleQuality: ShotQuality = 'uncertain';

      if (planIndex === 0 || isStopBoard || isNewSpinGroup) {
        idlePng = await waitUntilReelIdle({
          driver: options.driver,
          region: reelRegion,
          minMs: bundled ? BUNDLED_STOP_MIN_MS : REEL_STOP_MIN_MS,
          maxMs: bundled ? BUNDLED_STOP_MAX_MS : REEL_STOP_MAX_MS,
          shouldAbort,
        });
      } else {
        idlePng = await waitUntilNextTumbleIdle({
          driver: options.driver,
          region: reelRegion,
          previousPng,
          shouldAbort,
          changeMaxMs: bundled ? BUNDLED_TUMBLE_CHANGE_MAX_MS : TUMBLE_CHANGE_MAX_MS,
          stableMaxMs: bundled ? BUNDLED_TUMBLE_STABLE_MAX_MS : TUMBLE_STABLE_MAX_MS,
        });
      }
      if (idlePng !== undefined) {
        idleQuality = 'idle';
      } else if (!shouldAbort()) {
        idlePng = await captureBestEffortPng(options.driver, shouldAbort);
        if (idlePng !== undefined) {
          idleQuality = 'uncertain';
        }
      }

      if (idlePng !== undefined) {
        previousPng = idlePng;
      }
      previousGroupKey = group.key;

      const idleStep = makeIdleStep(
        ctx,
        board,
        boardIndex,
        group,
        spinIndex,
        isOpener,
        featureSpinsSeen,
        { png: idlePng, quality: idleQuality },
      );
      await withEventLock(() => {
        if (openEvent !== undefined && openEvent.eventId === ctx.event.eventId) {
          openEvent.stepCount += 1;
          lastActivityAt = Date.now();
        }
      });
      await publishSteps(ctx.event, [idleStep], meta, false);

      // —— SPIN: motion toward next board → screenshot only ——
      if (next === undefined || shouldAbort()) {
        continue;
      }

      let spinPng = await waitUntilMotionShot({
        driver: options.driver,
        region: reelRegion,
        previousPng,
        shouldAbort,
        changeMaxMs: bundled ? BUNDLED_TUMBLE_CHANGE_MAX_MS : TUMBLE_CHANGE_MAX_MS,
      });
      let spinQuality: ShotQuality = spinPng !== undefined ? 'motion' : 'uncertain';
      if (spinPng === undefined && !shouldAbort()) {
        spinPng = await captureBestEffortPng(options.driver, shouldAbort);
        spinQuality = spinPng !== undefined ? 'uncertain' : 'uncertain';
      }
      if (spinPng !== undefined) {
        previousPng = spinPng;
      }

      const spinStep = makeSpinStep(
        ctx,
        { group, board, spinIndex },
        { group: next.group, board: next.board, boardIndex: next.boardIndex },
        { png: spinPng, quality: spinQuality },
      );
      await withEventLock(() => {
        if (openEvent !== undefined && openEvent.eventId === ctx.event.eventId) {
          openEvent.stepCount += 1;
          lastActivityAt = Date.now();
        }
      });
      await publishSteps(ctx.event, [spinStep], meta, false);
    }
  }

  async function handleSpinResponse(item: QueuedBet): Promise<void> {
    inFlight += 1;
    try {
      const ctx = await assignSpinContext(item);
      if (ctx === undefined) {
        return;
      }
      await captureSpinBoards(ctx);
      await finalizeSpinContext(ctx);
    } catch {
      // Reader is optional.
    } finally {
      inFlight -= 1;
      lastActivityAt = Date.now();
    }
  }

  const handler = (response: Response): void => {
    if (abortWaits && stopped) {
      return;
    }
    if (!response.ok() || !isSpinNetwork(response.url())) {
      return;
    }
    void (async () => {
      try {
        const body = await readResponseBody(response);
        if (body === undefined) {
          return;
        }
        void handleSpinResponse({
          body,
          buy: isBuyPurchaseResponse(response),
          autoplay: options.isAutoplayActive?.() === true,
          requestUrl: response.url(),
        });
      } catch {
        // Reader is optional.
      }
    })();
  };

  const onMainFrameNavigate = (frame: { readonly parentFrame: () => unknown }): void => {
    if (frame.parentFrame() === null) {
      abortWaits = true;
    }
  };

  options.page.on('response', handler);
  options.page.on('framenavigated', onMainFrameNavigate);
  options.page.on('close', () => {
    abortWaits = true;
  });

  return async () => {
    stopped = true;
    if (!waitOnStop) {
      abortWaits = true;
      options.page.off('response', handler);
      options.page.off('framenavigated', onMainFrameNavigate);
      const deadline = Date.now() + REFRESH_STOP_MS;
      while (inFlight > 0 && Date.now() < deadline) {
        await sleep(50);
      }
      if (openEvent !== undefined) {
        await publishSteps(openEvent, [], { columns: 0, rows: 0, sourcePath: 'flush' }, true);
        openEvent = undefined;
      }
      return;
    }

    const deadline = Date.now() + TEARDOWN_WAIT_MS;
    while (
      Date.now() < deadline &&
      (inFlight > 0 ||
        (openEvent?.awaitingMore === true && Date.now() - lastActivityAt < idleCloseMs()))
    ) {
      await sleep(250);
    }
    abortWaits = true;
    options.page.off('response', handler);
    options.page.off('framenavigated', onMainFrameNavigate);
    while (inFlight > 0) {
      await sleep(50);
    }
    if (openEvent !== undefined) {
      await publishSteps(openEvent, [], { columns: 0, rows: 0, sourcePath: 'flush' }, true);
      openEvent = undefined;
    }
  };
}
