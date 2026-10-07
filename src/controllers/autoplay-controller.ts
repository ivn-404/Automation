/**
 * Autoplay Controller — start / stop automated spins.
 *
 * Canvas games: clickCanvas("autoplay") (+ optional confirm overlay).
 */

import type { IAutoplayController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { clearInterferingScreens } from '../eye/index.js';
import { clearCanvasOverlays, markSpinTriggered } from '../platform/canvas-session-primer.js';
import { ControllerDisabledError } from './registry/errors.js';
import { clickCanvasControl } from './strategy/click-control.js';
import { matchesBetUrl } from '../network/bet-url.js';

export interface AutoplayControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

export class AutoplayController implements IAutoplayController {
  readonly id = 'autoplay' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private active = false;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: AutoplayControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  isAutoplayActive(): boolean {
    return this.active;
  }

  /** Sync controller state after autoplay ends on its own (no canvas click). */
  acknowledgeStopped(): void {
    this.active = false;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'autoplay');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async start(options?: ObservableWaitOptions & { spinCountAction?: string }): Promise<void> {
    if (this.active) {
      return;
    }
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('autoplay');
    }

    this.lockState = { locked: true, lockedBy: 'autoplay', reason: 'autoplay-start' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        await clearInterferingScreens({
          page: this.driver.getPage(),
          driver: this.driver,
          manifest: this.manifest,
          intent: 'autoplay',
        });
        await clickCanvasControl(this.driver, this.manifest, 'autoplay', options);
        const spinCountAction = options?.spinCountAction;
        if (
          spinCountAction !== undefined &&
          this.manifest.canvasActions?.actions[spinCountAction] !== undefined
        ) {
          await this.driver.clickCanvas(spinCountAction, {
            ...options,
            singleInput: true,
          });
        }
        if (this.manifest.metadata?.autoplayNeedsConfirm === 'true') {
          await this.confirmAutoplayStart(options);
        }
      } else {
        await this.driver.click('autoplayButton', options);
      }
      this.active = true;
    } finally {
      this.lockState = { locked: false };
    }
  }

  private async confirmAutoplayStart(options?: ObservableWaitOptions): Promise<void> {
    const page = this.driver.getPage();
    const timeoutMs = Math.min(options?.timeoutMs ?? 12_000, 10_000);
    const confirmNames = ['autoplayConfirm', 'autoplayStart'] as const;

    let lastError: unknown;
    for (let attempt = 0; attempt < confirmNames.length; attempt += 1) {
      const actionName = confirmNames[attempt]!;
      if (this.manifest.canvasActions?.actions[actionName] === undefined) {
        continue;
      }
      const betPromise = page.waitForResponse(
        (response) => response.ok() && matchesBetUrl(response.url()),
        { timeout: timeoutMs },
      );
      await this.driver.clickCanvas(actionName, {
        ...options,
        singleInput: true,
        timeoutMs: 10_000,
        useHealedRatio: attempt > 0,
      });
      try {
        await betPromise;
        markSpinTriggered(this.driver);
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Autoplay confirm did not produce a bet response');
  }

  async stop(options?: ObservableWaitOptions): Promise<void> {
    if (!this.active) {
      return;
    }
    if (!(await this.driver.isAttached())) {
      this.active = false;
      return;
    }

    this.lockState = { locked: true, lockedBy: 'autoplay', reason: 'autoplay-stop' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      await clearCanvasOverlays(this.driver, this.manifest, 1, { allowGridSpam: false });
      if (rendering === 'canvas') {
        const stopAction =
          this.manifest.canvasActions?.actions.autoplayStop !== undefined
            ? 'autoplayStop'
            : 'autoplay';
        await clickCanvasControl(this.driver, this.manifest, stopAction, options);
      } else {
        await this.driver.click('autoplayStopButton', options);
      }
      this.active = false;
    } finally {
      this.lockState = { locked: false };
    }
  }
}
