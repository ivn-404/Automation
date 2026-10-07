/**
 * Buy Feature Controller — opens buy panel and confirms purchase.
 *
 * Canvas games: clickCanvas("buyFeature") (+ optional confirm overlay).
 */

import type { IBuyFeatureController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { clearInterferingScreens } from '../eye/index.js';
import { isBuyPurchaseResponse } from '../network/index.js';
import { clearCanvasOverlays, markSpinTriggered } from '../platform/canvas-session-primer.js';
import { ControllerDisabledError } from './registry/errors.js';

export interface BuyFeatureControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

export class BuyFeatureController implements IBuyFeatureController {
  readonly id = 'buyFeature' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: BuyFeatureControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'buyFeature');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async buy(options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('buyFeature');
    }
    if (this.lockState.locked) {
      throw new Error('Buy feature controller is locked');
    }

    this.lockState = { locked: true, lockedBy: 'buyFeature', reason: 'buy-feature' };
    try {
      await clearInterferingScreens({
        page: this.driver.getPage(),
        driver: this.driver,
        manifest: this.manifest,
        intent: 'buyFeature',
      });
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        await this.driver.clickCanvas('buyFeature', options);
        if (this.manifest.metadata?.buyFeatureNeedsConfirm === 'true') {
          await this.clickBuyFeatureConfirm(options);
        }
        markSpinTriggered(this.driver);
        await clearCanvasOverlays(this.driver, this.manifest, 2);
      } else {
        await this.driver.click('buyFeatureButton', options);
        if (this.manifest.metadata?.buyFeatureNeedsConfirm === 'true') {
          await this.driver.click('buyFeatureConfirmButton', options);
        }
      }
    } finally {
      this.lockState = { locked: false };
    }
  }

  private async clickBuyFeatureConfirm(options?: ObservableWaitOptions): Promise<void> {
    const page = this.driver.getPage();
    const timeoutMs = options?.timeoutMs ?? 12_000;
    const confirmActions = ['buyFeatureConfirm', 'buyFeatureConfirmAlt'] as const;
    for (const actionName of confirmActions) {
      if (this.manifest.canvasActions?.actions[actionName] === undefined) {
        continue;
      }
      const purchase = page.waitForResponse((response) => isBuyPurchaseResponse(response), {
        timeout: timeoutMs,
      });
      await this.driver.clickCanvas(actionName, { ...options, singleInput: true });
      try {
        await purchase;
        return;
      } catch {
        // Panel may still be open — try the next calibrated point. Do not fall through to spin.
      }
    }
    throw new Error('Buy feature confirm did not produce a buy purchase');
  }

  /** Opens the buy-feature panel without confirming purchase. */
  async openPanel(options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('buyFeature');
    }
    await clearInterferingScreens({
      page: this.driver.getPage(),
      driver: this.driver,
      manifest: this.manifest,
      intent: 'buyFeature',
    });
    const rendering = this.manifest.metadata?.rendering ?? 'dom';
    if (rendering === 'canvas') {
      await this.driver.clickCanvas('buyFeature', { ...options, singleInput: true });
      await this.driver.getPage().waitForTimeout(1_400);
    } else {
      await this.driver.click('buyFeatureButton', options);
    }
  }
}
