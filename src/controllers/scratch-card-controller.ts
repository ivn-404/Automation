/**
 * Scratch Card Controller — clicks-only driver for the scratch-card side game.
 *
 * HUD button opens a drawer (manifest `scratchCard`): pick a grid size, BUY CARD,
 * then scratch the dust by hand (drag) or tap SCRATCH ALL.
 * The drawer lives in the side canvas when visible (desktop), else inside the main canvas.
 * Proof is the scratch hub websocket (StartRound / Cashout), not the drawer pixels.
 */

import type { IScratchCardController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  NormalizedRect,
  ObservableWaitOptions,
  ScratchCardConfig,
} from '../core/models/index.js';
import { recordClick } from '../driver/click-tracker.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { hueShareInPng } from '../eye/canvas-vision.js';
import { ScratchHubServerError, ScratchHubWatcher, type ScratchRoundSnapshot } from '../network/index.js';
import { captureViewportRegion } from '../platform/stable-screenshot.js';
import { listPhaserTexts, type PhaserTextHit } from '../runtime/phaser-locate.js';
import { ControllerDisabledError } from './registry/errors.js';

export type ScratchGridSize = 3 | 4 | 5;

/** A Phaser text inside the drawer; position and size in drawer ratios. */
export interface ScratchDrawerText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Drawer buttons can drop a press+release delivered in the same frame. */
const TAP_HOLD_MS = 80;

export interface ScratchCardControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

interface PageBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A layer covering this share of the drawer rect counts as the drawer panel. */
const DRAWER_LAYER_COVER = 0.8;

/**
 * Render order of the top-most layer that covers the drawer rect. HUD texts in
 * layers drawn beneath it are hidden by the panel even though Phaser reports them visible.
 */
function drawerLayerOrder(hits: readonly PhaserTextHit[], drawer: NormalizedRect): number | undefined {
  let best: number | undefined;
  for (const hit of hits) {
    const layer = hit.layer;
    if (layer === undefined || hit.gameWidth <= 0 || hit.gameHeight <= 0) {
      continue;
    }
    const dx = drawer.x * hit.gameWidth;
    const dy = drawer.y * hit.gameHeight;
    const dw = drawer.width * hit.gameWidth;
    const dh = drawer.height * hit.gameHeight;
    const overlapW = Math.min(dx + dw, layer.x + layer.width) - Math.max(dx, layer.x);
    const overlapH = Math.min(dy + dh, layer.y + layer.height) - Math.max(dy, layer.y);
    if (overlapW <= 0 || overlapH <= 0 || (overlapW * overlapH) / (dw * dh) < DRAWER_LAYER_COVER) {
      continue;
    }
    if (best === undefined || layer.order > best) {
      best = layer.order;
    }
  }
  return best;
}

export class ScratchCardController implements IScratchCardController {
  readonly id = 'scratchCard' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private readonly hub: ScratchHubWatcher | undefined;
  private lockState: ControllerLockState = { locked: false };
  private drawerOpen = false;

  constructor(options: ScratchCardControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
    const config = options.manifest.scratchCard;
    if (config !== undefined) {
      this.hub = new ScratchHubWatcher({
        page: options.driver.getPage(),
        hubUrlPattern: config.hubUrlPattern,
      });
      this.hub.start();
    }
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'scratchCard');
    if (capability === undefined || !capability.enabled || this.manifest.scratchCard === undefined) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  /** True once the game has connected to the scratch hub. */
  isHubConnected(): boolean {
    return this.hub?.isConnected() ?? false;
  }

  /** Taps the HUD scratch button until the drawer is confirmed open. */
  async open(options?: ObservableWaitOptions): Promise<void> {
    await this.requireAvailable();
    const page = this.driver.getPage();
    if (this.config().openProbe !== undefined && (await this.isDrawerOpen())) {
      console.log('[sgap-scratch] drawer already open');
      await this.waitForHubConnection(options?.timeoutMs ?? 15_000);
      return;
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = await this.probeShare();
      await this.driver.clickCanvas('scratchCard', { ...options, singleInput: true });
      this.drawerOpen = true;
      await page.waitForTimeout(1_500);
      const openDeadline = Date.now() + 6_000;
      while (!(await this.isDrawerOpen()) && Date.now() < openDeadline) {
        await page.waitForTimeout(500);
      }
      if (await this.isDrawerOpen()) {
        const after = await this.probeShare();
        console.log(
          `[sgap-scratch] drawer open (probe share ${before?.toFixed(2) ?? '-'} → ${after?.toFixed(2) ?? 'side canvas'})`,
        );
        await this.waitForHubConnection(options?.timeoutMs ?? 15_000);
        return;
      }
      this.drawerOpen = false;
      console.log(`[sgap-scratch] drawer did not open after HUD tap (attempt ${attempt})`);
      await page.waitForTimeout(1_500);
    }
    throw new Error('Scratch drawer did not open after 3 HUD taps');
  }

  /**
   * Some titles open the scratch hub at load, others only once the drawer opens.
   * Waits for the JoinScratch answer so config and balance are readable.
   */
  private async waitForHubConnection(timeoutMs: number): Promise<void> {
    const hub = this.hub;
    if (hub === undefined) {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    while (!hub.isConnected() || hub.latestResult('JoinScratch') === undefined) {
      const serverError = hub.latestServerError('JoinScratch');
      if (serverError !== undefined) {
        throw new ScratchHubServerError('JoinScratch', serverError);
      }
      if (Date.now() > deadline) {
        throw new Error(
          hub.isConnected()
            ? `Scratch hub did not answer JoinScratch within ${timeoutMs / 1000}s of opening the drawer`
            : `Scratch hub did not connect within ${timeoutMs / 1000}s of opening the drawer`,
        );
      }
      await this.driver.getPage().waitForTimeout(250);
    }
  }

  async selectSize(size: ScratchGridSize): Promise<void> {
    await this.tapDrawer(`size${size}x${size}`);
    await this.driver.getPage().waitForTimeout(800);
  }

  /** BUY CARD → hub StartRound. Returns the bought card. */
  async buyCard(options?: ObservableWaitOptions): Promise<ScratchRoundSnapshot> {
    const since = await this.tapUntilInvoked('buyCard', 'StartRound');
    return this.requireHub().waitForResult('StartRound', {
      since,
      timeoutMs: options?.timeoutMs ?? 20_000,
    });
  }

  /** Drags back and forth over the dust until the hub settles the card (Cashout). */
  async scratchByHand(options?: ObservableWaitOptions): Promise<ScratchRoundSnapshot> {
    const hub = this.requireHub();
    const since = Date.now();
    await this.dragScratchArea(() => hub.hasResult('Cashout', since));
    return hub.waitForResult('Cashout', { since, timeoutMs: options?.timeoutMs ?? 15_000 });
  }

  /** Serpentine drag over the dust area; `stop` is checked before each row. */
  async dragScratchArea(stop: () => boolean = () => false): Promise<void> {
    const page = this.driver.getPage();
    await this.requireDrawerOpen('scratchDust');
    const area = this.toPageRect(await this.drawerBox(), this.config().scratchArea);
    const rows = 14;
    for (let row = 0; row <= rows && !stop(); row += 1) {
      const y = area.y + (area.height * row) / rows;
      const [fromX, toX] = row % 2 === 0 ? [area.x, area.x + area.width] : [area.x + area.width, area.x];
      if (row === 0) {
        await recordClick(page, { label: 'scratchDust', pageX: fromX, pageY: y, kind: 'mouse' });
      }
      await page.mouse.move(fromX, y);
      await page.mouse.down();
      await page.mouse.move(toX, y, { steps: 18 });
      await page.mouse.up();
    }
  }

  /** Taps the drawer bet + / − (`betPlus` / `betMinus` points) `times` times. */
  async adjustBet(direction: 'plus' | 'minus', times = 1): Promise<void> {
    const actionName = direction === 'plus' ? 'betPlus' : 'betMinus';
    for (let i = 0; i < times; i += 1) {
      await this.tapDrawer(actionName);
      await this.driver.getPage().waitForTimeout(250);
    }
    await this.driver.getPage().waitForTimeout(400);
  }

  /** Visible Phaser texts inside the drawer (in-canvas drawer only). */
  async readDrawerTexts(): Promise<readonly ScratchDrawerText[]> {
    const drawer = this.config().inCanvasDrawer;
    const hits = await listPhaserTexts(this.driver.getPage(), this.driver.iframeSelector);
    const drawerOrder = drawerLayerOrder(hits, drawer);
    const texts: ScratchDrawerText[] = [];
    for (const hit of hits) {
      if (drawerOrder !== undefined && hit.layer !== undefined && hit.layer.order < drawerOrder) {
        continue;
      }
      if (hit.gameWidth <= 0 || hit.gameHeight <= 0) {
        continue;
      }
      const x = (hit.x / hit.gameWidth - drawer.x) / drawer.width;
      const y = (hit.y / hit.gameHeight - drawer.y) / drawer.height;
      const width = hit.width / hit.gameWidth / drawer.width;
      const height = hit.height / hit.gameHeight / drawer.height;
      const cx = x + width / 2;
      const cy = y + height / 2;
      if (cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1) {
        texts.push({ text: hit.text, x, y, width, height });
      }
    }
    return texts;
  }

  /** Texts whose centre is in the manifest text area `areaName`, top-to-bottom then left-to-right. */
  async readTextArea(areaName: string): Promise<readonly string[]> {
    const area = this.config().textAreas?.[areaName];
    if (area === undefined) {
      throw new Error(`Scratch text area "${areaName}" is not defined for game "${this.manifest.gameId}"`);
    }
    const inside = (await this.readDrawerTexts()).filter((entry) => {
      const cx = entry.x + entry.width / 2;
      const cy = entry.y + entry.height / 2;
      return cx >= area.x && cx <= area.x + area.width && cy >= area.y && cy <= area.y + area.height;
    });
    return [...inside]
      .sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x))
      .map((entry) => entry.text);
  }

  /** PNG of the drawer, or of `rect` (drawer ratios) inside it. */
  async screenshotDrawer(rect?: NormalizedRect): Promise<Buffer> {
    const drawer = await this.drawerBox();
    const clip = rect !== undefined ? this.toPageRect(drawer, rect) : drawer;
    return captureViewportRegion(this.driver.getPage(), clip, { label: 'scratch drawer' });
  }

  /** Where the drawer is drawn right now. */
  async drawerLocation(): Promise<'side-canvas' | 'main-canvas' | 'closed'> {
    if ((await this.visibleSideCanvas()) !== undefined) {
      return 'side-canvas';
    }
    return (await this.isDrawerOpen()) ? 'main-canvas' : 'closed';
  }

  /** The scratch hub observer (invocations, results, balance). */
  hubWatcher(): ScratchHubWatcher {
    return this.requireHub();
  }

  /** SCRATCH ALL (same pill as BUY CARD once a card is in play) → hub Cashout. */
  async scratchAll(options?: ObservableWaitOptions): Promise<ScratchRoundSnapshot> {
    const since = await this.tapUntilInvoked('scratchAll', 'Cashout');
    return this.requireHub().waitForResult('Cashout', {
      since,
      timeoutMs: options?.timeoutMs ?? 15_000,
    });
  }

  /**
   * Taps a drawer point until the game sends `target` to the hub (max 3 taps).
   * Never re-taps once `target` was sent — the pill has changed meaning by then.
   */
  private async tapUntilInvoked(actionName: string, target: string): Promise<number> {
    const hub = this.requireHub();
    const page = this.driver.getPage();
    const since = Date.now();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await this.tapDrawer(actionName);
      // A second tap after a slow first one lands on a settled round ("No active round.").
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline && !hub.wasInvoked(target, since)) {
        await page.waitForTimeout(200);
      }
      if (hub.wasInvoked(target, since)) {
        break;
      }
      console.log(`[sgap-scratch] ${actionName} tap did not send ${target} (attempt ${attempt})`);
    }
    return since;
  }

  async close(): Promise<void> {
    await this.tapDrawer('close');
    this.drawerOpen = false;
    await this.driver.getPage().waitForTimeout(1_000);
  }

  dispose(): void {
    this.hub?.stop();
  }

  /** Side canvas visible, or the in-canvas open probe shows its drawer control. Without a probe, trusts open(). */
  private async isDrawerOpen(): Promise<boolean> {
    if ((await this.visibleSideCanvas()) !== undefined) {
      return true;
    }
    const probe = this.config().openProbe;
    const share = await this.probeShare();
    if (probe === undefined || share === undefined) {
      return this.drawerOpen;
    }
    return share >= probe.minShare;
  }

  /** Waits out the pill's disabled state while a card is dealt, then refuses if the drawer is gone. */
  private async requireDrawerOpen(actionName: string): Promise<void> {
    const deadline = Date.now() + 6_000;
    while (!(await this.isDrawerOpen())) {
      if (Date.now() >= deadline) {
        throw new Error(`Scratch drawer is not open; refusing "${actionName}" (it would land on the base game)`);
      }
      await this.driver.getPage().waitForTimeout(300);
    }
  }

  /** Share of open-probe pixels in the probe hue, at the in-canvas drawer position. */
  private async probeShare(): Promise<number | undefined> {
    const probe = this.config().openProbe;
    if (probe === undefined) {
      return undefined;
    }
    const canvas = await this.driver.gameCanvas().boundingBox();
    if (canvas === null) {
      return undefined;
    }
    const clip = this.toPageRect(this.toPageRect(canvas, this.config().inCanvasDrawer), probe.area);
    return hueShareInPng(
      await captureViewportRegion(this.driver.getPage(), clip, { label: 'scratch drawer check' }),
      probe.hue,
    );
  }

  private async tapDrawer(actionName: string): Promise<void> {
    await this.requireAvailable();
    await this.requireDrawerOpen(actionName);
    const point = this.config().actions[actionName];
    if (point === undefined) {
      throw new Error(`Scratch drawer point "${actionName}" is not defined for game "${this.manifest.gameId}"`);
    }
    const drawer = await this.drawerBox();
    const pageX = drawer.x + drawer.width * point.x;
    const pageY = drawer.y + drawer.height * point.y;
    await recordClick(this.driver.getPage(), { label: `scratch:${actionName}`, pageX, pageY, kind: 'mouse' });
    await this.driver.getPage().mouse.click(pageX, pageY, { delay: TAP_HOLD_MS });
  }

  /** Page box of the drawer: side canvas when visible, else the in-canvas drawer area. */
  private async drawerBox(): Promise<PageBox> {
    const config = this.config();
    const side = await this.visibleSideCanvas();
    if (side !== undefined) {
      return side;
    }
    const canvas = await this.driver.gameCanvas().boundingBox();
    if (canvas === null) {
      throw new Error(`Game canvas has no bounding box for game "${this.manifest.gameId}"`);
    }
    return this.toPageRect(canvas, config.inCanvasDrawer);
  }

  private async visibleSideCanvas(): Promise<PageBox | undefined> {
    const selector = this.config().sideCanvasSelector;
    if (selector === undefined) {
      return undefined;
    }
    const locator = this.driver.getFrame().locator(selector).first();
    // boundingBox() waits the full action timeout when the title has no side host at all.
    if ((await locator.count().catch(() => 0)) === 0) {
      return undefined;
    }
    const side = await locator.boundingBox({ timeout: 2_000 }).catch(() => null);
    if (side === null || side.width <= 40 || side.height <= 40) {
      return undefined;
    }
    // Some titles keep a full-size side canvas parked behind the main canvas while closed.
    const onTop = await locator
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const doc = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): unknown } }).document;
        const top = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) as typeof el | null;
        return top !== null && (top === el || el.contains(top) || el.parentElement?.contains(top) === true);
      }, undefined, { timeout: 2_000 })
      .catch(() => true);
    return onTop ? side : undefined;
  }

  private toPageRect(box: PageBox, rect: NormalizedRect): PageBox {
    return {
      x: box.x + box.width * rect.x,
      y: box.y + box.height * rect.y,
      width: box.width * rect.width,
      height: box.height * rect.height,
    };
  }

  private config(): ScratchCardConfig {
    const config = this.manifest.scratchCard;
    if (config === undefined) {
      throw new ControllerDisabledError('scratchCard');
    }
    return config;
  }

  private requireHub(): ScratchHubWatcher {
    if (this.hub === undefined) {
      throw new ControllerDisabledError('scratchCard');
    }
    return this.hub;
  }

  private async requireAvailable(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('scratchCard');
    }
  }
}
