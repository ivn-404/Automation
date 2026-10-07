/**
 * Playwright Game Driver — iframe attach and interaction via UI Registry / canvas config.
 *
 * Game-agnostic: selectors and canvas points come from the manifest.
 * Uses observable synchronization (waitFor, click auto-wait) — no fixed sleeps.
 */

import type { FrameLocator, Locator, Page } from 'playwright';

import type { IGameDriver } from '../core/contracts/index.js';
import type { GameManifest, ObservableWaitOptions } from '../core/models/index.js';
import { consumeHealedRatio } from '../eye/learned-ratios.js';
import { captureViewportRegion } from '../platform/stable-screenshot.js';
import { recordInteraction, type LocatorStrategy } from '../reporting/interaction-journal.js';
import { loadSurfaceProfile } from '../surfaces/load-surface-profile.js';
import type { SurfaceProfile } from '../surfaces/types.js';
import type { UiRegistry } from '../ui/registry/index.js';
import { recordClick } from './click-tracker.js';
import { GameDriverNotAttachedError } from './errors.js';
import { DEFAULT_DRIVER_TIMEOUT_MS, resolveTimeoutMs } from './wait-options.js';

export interface PlaywrightGameDriverOptions {
  readonly page: Page;
  readonly ui: UiRegistry;
  /** Manifest for canvasActions when rendering is canvas. */
  readonly manifest: GameManifest;
  /** Default safety-net timeout when options.timeoutMs is omitted. */
  readonly defaultTimeoutMs?: number;
}

/** How a canvas click's point was chosen, for the interaction journal. */
export interface CanvasClickReport {
  readonly label?: string;
  readonly strategy?: LocatorStrategy;
  readonly fallback?: boolean;
  readonly detail?: string;
}

function portraitHitArea(
  box: {
    readonly width: number;
    readonly height: number;
  },
  portrait: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (box.height >= box.width) {
    return { x: 0, y: 0, width: box.width, height: box.height };
  }
  const aspect = portrait.width / portrait.height;
  let height = box.height;
  let width = Math.round(height * aspect);
  if (width > box.width) {
    width = box.width;
    height = Math.round(width / aspect);
  }
  return {
    x: Math.round((box.width - width) / 2),
    y: Math.round((box.height - height) / 2),
    width,
    height,
  };
}

export interface CanvasHit {
  readonly action: string;
  readonly ratio: { readonly x: number; readonly y: number };
  readonly pageX: number;
  readonly pageY: number;
  /** Epoch ms of the tap, so failure reports can tell whether traffic followed it. */
  readonly at: number;
}

export class PlaywrightGameDriver implements IGameDriver {
  private readonly page: Page;
  private readonly ui: UiRegistry;
  private readonly manifest: GameManifest;
  private readonly surfaceProfile: SurfaceProfile;
  private readonly defaultTimeoutMs: number;
  private frame: FrameLocator | undefined;
  private attached = false;
  lastCanvasHit: CanvasHit | undefined;

  constructor(options: PlaywrightGameDriverOptions) {
    this.page = options.page;
    this.ui = options.ui;
    this.manifest = options.manifest;
    this.surfaceProfile = loadSurfaceProfile(options.manifest);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_DRIVER_TIMEOUT_MS;
  }

  get gameId(): string {
    return this.ui.gameId ?? this.manifest.gameId;
  }

  /** HUD geometry and appearance for this game, from config/surfaces. */
  get surface(): SurfaceProfile {
    return this.surfaceProfile;
  }

  /** Host-page selector for the game iframe, for recovery code that resizes it. */
  get iframeSelector(): string {
    return this.ui.resolveIframe().selector;
  }

  /**
   * Screenshot of the game canvas, with the mapping back into the ratio space that
   * `clickCanvasAt` and the manifest use. Image ratios cover the whole canvas
   * element; action ratios cover only the portrait strip inside it, so anything
   * measured off the picture has to come back through `toActionRatio` before it
   * can be clicked or compared against a manifest entry.
   */
  async captureCanvasForVision(options?: ObservableWaitOptions): Promise<
    | {
        readonly png: Buffer;
        toActionRatio(point: { readonly x: number; readonly y: number }): {
          readonly x: number;
          readonly y: number;
        };
      }
    | undefined
  > {
    const canvasActions = this.manifest.canvasActions;
    if (canvasActions === undefined) {
      return undefined;
    }
    // Recovery path under parallel load — keep this short; a hung screenshot must
    // never burn the caller's remaining test budget.
    const timeout = Math.min(8_000, resolveTimeoutMs(options, this.defaultTimeoutMs));
    const selector = canvasActions.canvasSelector ?? 'canvas';

    if (!(await this.isAttached())) {
      await this.attach({ timeoutMs: timeout }).catch(() => undefined);
    }
    if (!(await this.isAttached())) {
      return undefined;
    }

    const canvas = await this.resolveGameCanvas(selector, timeout).catch(() => undefined);
    if (canvas === undefined) {
      return undefined;
    }
    const box = await canvas.boundingBox().catch(() => null);
    if (box === null || box.width <= 0 || box.height <= 0) {
      return undefined;
    }

    const png = await captureViewportRegion(this.page, box, { timeout, label: 'canvas vision' }).catch(
      () => undefined,
    );
    if (png === undefined) {
      return undefined;
    }

    const area = portraitHitArea(box, this.surfaceProfile.portraitAspect);
    return {
      png,
      toActionRatio: (point) => ({
        x: (point.x * box.width - area.x) / area.width,
        y: (point.y * box.height - area.y) / area.height,
      }),
    };
  }

  async attach(options?: ObservableWaitOptions): Promise<void> {
    const timeout = resolveTimeoutMs(options, this.defaultTimeoutMs);
    const iframe = this.ui.resolveIframe();

    const iframeOnHost = this.page.locator(iframe.selector);
    await iframeOnHost.waitFor({ state: 'attached', timeout });

    this.frame = this.page.frameLocator(iframe.selector);
    await this.frame.locator('body').waitFor({ state: 'attached', timeout });

    this.attached = true;
  }

  async isAttached(): Promise<boolean> {
    if (!this.attached || this.frame === undefined) {
      return false;
    }

    try {
      const iframe = this.ui.resolveIframe();
      const loc = this.page.locator(iframe.selector);
      // Clipped 2×2 windows can fail isVisible() even when the game frame is live.
      return (await loc.count()) > 0;
    } catch {
      return false;
    }
  }

  async click(locatorKey: string, options?: ObservableWaitOptions): Promise<void> {
    const locator = this.locatorInFrame(locatorKey);
    const timeout = resolveTimeoutMs(options, this.defaultTimeoutMs);
    const box = await locator.boundingBox().catch(() => null);
    if (box !== null) {
      await recordClick(this.page, {
        label: locatorKey,
        pageX: box.x + box.width / 2,
        pageY: box.y + box.height / 2,
        kind: 'dom',
      });
    }
    recordInteraction(this.page, { action: locatorKey, strategy: 'dom', fallback: false });
    await locator.click({ timeout });
  }

  /**
   * Click a manifest canvas action. With `useHealedRatio`, a point re-located after
   * a miss (vision / Phaser) replaces the manifest point once, and is reported as a
   * fallback. `fallbackReason` marks a manifest click that only happened because the
   * caller's preferred locator found nothing.
   */
  async clickCanvas(
    actionName: string,
    options?: ObservableWaitOptions & { readonly fallbackReason?: string },
  ): Promise<void> {
    this.requireAttached();
    const canvasActions = this.manifest.canvasActions;
    if (canvasActions === undefined) {
      throw new Error(
        `Game "${this.gameId}" has no canvasActions; cannot clickCanvas("${actionName}")`,
      );
    }

    const point = canvasActions.actions[actionName];
    if (point === undefined) {
      throw new Error(
        `Canvas action "${actionName}" is not defined for game "${this.gameId}"`,
      );
    }

    const healed =
      options?.useHealedRatio === true ? consumeHealedRatio(this.gameId, actionName) : undefined;
    const { fallbackReason, ...rest } = options ?? {};
    await this.clickCanvasAt(healed ?? point, {
      ...rest,
      label: actionName,
      strategy: healed?.source ?? 'manifest',
      fallback: healed !== undefined || fallbackReason !== undefined,
      ...(healed !== undefined
        ? { detail: `re-located by ${healed.source} after a miss (manifest ${point.x.toFixed(3)},${point.y.toFixed(3)})` }
        : fallbackReason !== undefined
          ? { detail: fallbackReason }
          : {}),
    });
  }

  /**
   * Click a 0–1 point inside the portrait game strip (not the full landscape canvas).
   * `strategy` says which resolver produced the point; without it, a point equal to
   * the label's manifest action counts as `manifest`, anything else as `point`.
   */
  async clickCanvasAt(
    point: { readonly x: number; readonly y: number },
    options?: ObservableWaitOptions & CanvasClickReport,
  ): Promise<void> {
    this.requireAttached();
    const canvasActions = this.manifest.canvasActions;
    if (canvasActions === undefined) {
      throw new Error(`Game "${this.gameId}" has no canvasActions; cannot clickCanvasAt`);
    }

    const timeout = resolveTimeoutMs(options, this.defaultTimeoutMs);
    const selector = canvasActions.canvasSelector ?? 'canvas';
    const canvas = await this.resolveGameCanvas(selector, timeout);
    const box = await canvas.boundingBox();
    if (box === null) {
      throw new Error(`Canvas "${selector}" has no bounding box for game "${this.gameId}"`);
    }

    const area = portraitHitArea(box, this.surfaceProfile.portraitAspect);
    const position = {
      x: Math.max(area.x + 1, Math.min(area.x + area.width - 1, area.x + area.width * point.x)),
      y: Math.max(area.y + 1, Math.min(area.y + area.height - 1, area.y + area.height * point.y)),
    };

    await this.recordCanvasClick(options?.label ?? 'canvasPoint', canvas, position);
    const label = options?.label ?? 'canvasPoint';
    const strategy = options?.strategy ?? (this.isManifestPoint(label, point) ? 'manifest' : 'point');
    recordInteraction(this.page, {
      action: label,
      strategy,
      fallback: options?.fallback ?? strategy === 'candidate',
      point: { x: point.x, y: point.y },
      ...(options?.detail !== undefined ? { detail: options.detail } : {}),
    });
    this.lastCanvasHit = {
      action: options?.label ?? 'canvasPoint',
      ratio: { x: point.x, y: point.y },
      pageX: box.x + position.x,
      pageY: box.y + position.y,
      at: Date.now(),
    };

    await canvas.click({ timeout, position, force: true });
    if (options?.singleInput === false) {
      await canvas.tap({ timeout, position, force: true }).catch(() => undefined);
    }
  }

  private isManifestPoint(label: string, point: { readonly x: number; readonly y: number }): boolean {
    const pinned = this.manifest.canvasActions?.actions[label];
    return pinned !== undefined && pinned.x === point.x && pinned.y === point.y;
  }

  /**
   * Prefer the largest portrait canvas. A landscape host stage often sits behind
   * the real game surface; `.last()` then maps HUD ratios onto empty grey.
   */
  private async resolveGameCanvas(selector: string, timeout: number): Promise<Locator> {
    const root = this.frame!.locator(selector);
    await root.filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
    const count = await root.count();
    if (count <= 1) {
      return root.filter({ visible: true }).last();
    }

    const portraits: { locator: Locator; area: number }[] = [];
    const all: { locator: Locator; area: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const locator = root.nth(i);
      const box = await locator.boundingBox().catch(() => null);
      if (box === null || box.width < 80 || box.height < 80) {
        continue;
      }
      const area = box.width * box.height;
      all.push({ locator, area });
      if (box.height > box.width) {
        portraits.push({ locator, area });
      }
    }

    const pool = portraits.length > 0 ? portraits : all;
    pool.sort((left, right) => right.area - left.area);
    return pool[0]?.locator ?? root.filter({ visible: true }).last();
  }

  private async recordCanvasClick(
    actionName: string,
    canvas: ReturnType<FrameLocator['locator']>,
    position: { x: number; y: number },
  ): Promise<void> {
    const box = await canvas.boundingBox().catch(() => null);
    if (box === null) {
      return;
    }
    await recordClick(this.page, {
      label: actionName,
      pageX: box.x + position.x,
      pageY: box.y + position.y,
      kind: 'canvas',
    });
  }

  async readText(locatorKey: string, options?: ObservableWaitOptions): Promise<string> {
    const locator = this.locatorInFrame(locatorKey);
    const timeout = resolveTimeoutMs(options, this.defaultTimeoutMs);
    await locator.waitFor({ state: 'visible', timeout });
    return (await locator.innerText()).trim();
  }

  async detach(): Promise<void> {
    this.frame = undefined;
    this.attached = false;
  }

  /** Exposes the host page for network synchronization. */
  getPage(): Page {
    return this.page;
  }

  /** Exposes the attached frame for advanced use (network hooks, etc.). */
  getFrame(): FrameLocator {
    this.requireAttached();
    return this.frame!;
  }

  /**
   * The rendered game canvas. Builds can add hidden helper canvases (Beelze-Bop's
   * 0×0 `#scratch-side-host` canvas sits last in the DOM), so only visible ones count.
   */
  gameCanvas(): Locator {
    const selector = this.manifest.canvasActions?.canvasSelector ?? 'canvas';
    return this.getFrame().locator(selector).filter({ visible: true }).last();
  }

  private locatorInFrame(locatorKey: string) {
    this.requireAttached();
    const resolved = this.ui.resolve(locatorKey);
    return this.frame!.locator(resolved.selector);
  }

  private requireAttached(): void {
    if (!this.attached || this.frame === undefined) {
      throw new GameDriverNotAttachedError(this.gameId);
    }
  }
}
