/**
 * Turbo Controller — toggles fast-play mode.
 *
 * Canvas games: clickCanvas("turbo") using manifest canvasActions (toggle).
 */

import type { ITurboController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { ControllerDisabledError } from './registry/errors.js';
import { clickCanvasControl } from './strategy/click-control.js';

export interface TurboControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

export class TurboController implements ITurboController {
  readonly id = 'turbo' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private enabled = false;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: TurboControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  /**
   * Local click-tracking only. Do not use this as a catalog pass oracle.
   * Package 1 /bet has no turbo field. `isEnhancedBet` follows Amplify.
   */
  isTurboEnabled(): boolean {
    return this.enabled;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'turbo');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async enable(options?: ObservableWaitOptions): Promise<void> {
    if (this.enabled) {
      return;
    }
    await this.toggle(options);
    this.enabled = true;
  }

  async disable(options?: ObservableWaitOptions): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.toggle(options);
    this.enabled = false;
  }

  private async toggle(options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('turbo');
    }
    if (this.lockState.locked) {
      throw new Error('Turbo controller is locked');
    }

    this.lockState = { locked: true, lockedBy: 'turbo', reason: 'turbo-toggle' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        await clickCanvasControl(this.driver, this.manifest, 'turbo', { ...options, singleInput: true });
      } else {
        await this.driver.click('turboButton', options);
      }
    } finally {
      this.lockState = { locked: false };
    }
  }
}
