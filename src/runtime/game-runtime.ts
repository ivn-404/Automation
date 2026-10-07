/**
 * Thin game runtime — locate/click strategy for iframe Phaser/canvas titles.
 *
 * Controllers keep calling PlaywrightGameDriver.clickCanvas. This layer owns:
 *   inspect() → iframe surface inventory
 *   locate()  → Phaser → optional vision → manifest
 *   click()   → one canvas click at the resolved ratio
 */

import type { Page } from 'playwright';

import type { GameManifest, ObservableWaitOptions } from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { rememberHealedRatio } from '../eye/learned-ratios.js';
import {
  formatIframeInventory,
  inventoryGameIframe,
  type IframeInventoryReport,
} from './iframe-inventory.js';
import {
  locateControlByPhaser,
  type PhaserHit,
} from './phaser-locate.js';

export type LocateSource = 'phaser' | 'vision' | 'manifest' | 'none';

export interface RuntimeLocateResult {
  readonly found: boolean;
  readonly source: LocateSource;
  readonly detail: string;
  readonly ratio?: { readonly x: number; readonly y: number };
  readonly hit?: PhaserHit;
}

export interface VisionLocateHookResult {
  readonly healed: boolean;
  readonly detail: string;
  readonly ratio?: { readonly x: number; readonly y: number };
}

export type VisionLocateHook = (
  action: string,
  options?: { readonly remember?: boolean },
) => Promise<VisionLocateHookResult>;

export interface GameRuntimeOptions {
  readonly page: Page;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  /** Optional colour-vision fallback (usually wired from tests/support/canvas-healing). */
  readonly visionLocate?: VisionLocateHook;
}

export class GameRuntime {
  private readonly page: Page;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private readonly visionLocate?: VisionLocateHook;

  constructor(options: GameRuntimeOptions) {
    this.page = options.page;
    this.driver = options.driver;
    this.manifest = options.manifest;
    this.visionLocate = options.visionLocate;
  }

  get iframeSelector(): string {
    return this.driver.iframeSelector;
  }

  /** Inventory DOM / Phaser surface inside the game iframe. */
  async inspect(): Promise<IframeInventoryReport> {
    return inventoryGameIframe(this.page, this.manifest, this.iframeSelector);
  }

  formatInspect(report: IframeInventoryReport): string {
    return formatIframeInventory(report);
  }

  /**
   * Resolve a control ratio: Phaser geometry → vision hook → manifest coords.
   */
  async locate(
    action: string,
    options?: { readonly remember?: boolean; readonly allowManifest?: boolean },
  ): Promise<RuntimeLocateResult> {
    const remember = options?.remember !== false;
    const allowManifest = options?.allowManifest !== false;

    const phaser = await locateControlByPhaser(
      this.page,
      this.manifest,
      this.iframeSelector,
      action,
      { remember },
    );
    if (phaser.found && phaser.hit !== undefined) {
      return {
        found: true,
        source: 'phaser',
        detail: phaser.detail,
        ratio: { x: phaser.hit.xRatio, y: phaser.hit.yRatio },
        hit: phaser.hit,
      };
    }

    if (this.visionLocate !== undefined) {
      const vision = await this.visionLocate(action, { remember });
      if (vision.healed) {
        const ratio = vision.ratio;
        return {
          found: true,
          source: 'vision',
          detail: vision.detail,
          ...(ratio !== undefined ? { ratio } : {}),
        };
      }
    }

    if (allowManifest) {
      const manifestPoint = this.manifest.canvasActions?.actions[action];
      if (manifestPoint !== undefined) {
        if (remember) {
          rememberHealedRatio(this.manifest.gameId, action, manifestPoint, 'manifest');
        }
        return {
          found: true,
          source: 'manifest',
          detail: `manifest ${action} at ${manifestPoint.x.toFixed(3)},${manifestPoint.y.toFixed(3)}`,
          ratio: { x: manifestPoint.x, y: manifestPoint.y },
        };
      }
    }

    return {
      found: false,
      source: 'none',
      detail: phaser.detail,
    };
  }

  /**
   * Locate then one canvas click. Prefer healed/Phaser ratio when available.
   */
  async click(action: string, options?: ObservableWaitOptions): Promise<RuntimeLocateResult> {
    const located = await this.locate(action, { remember: true });
    if (!located.found) {
      return located;
    }

    if (located.source === 'phaser' || located.source === 'vision') {
      await this.driver.clickCanvas(action, {
        ...options,
        singleInput: options?.singleInput ?? true,
        useHealedRatio: true,
      });
    } else {
      await this.driver.clickCanvas(action, {
        ...options,
        singleInput: options?.singleInput ?? true,
      });
    }

    return located;
  }
}

export function createGameRuntime(options: GameRuntimeOptions): GameRuntime {
  return new GameRuntime(options);
}
