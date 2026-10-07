/**
 * Amplify Bet Controller — toggles enhanced-bet / amplify mode.
 *
 * Canvas games: Phaser-locate amplifyBet when possible, else manifest point (journaled fallback).
 */

import type { IAmplifyBetController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { ControllerDisabledError } from './registry/errors.js';
import { clickCanvasControl } from './strategy/click-control.js';

export interface AmplifyBetControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

export class AmplifyBetController implements IAmplifyBetController {
  readonly id = 'amplifyBet' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private enabled = false;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: AmplifyBetControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  isAmplifyEnabled(): boolean {
    return this.enabled;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'amplifyBet');
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

  /**
   * Forget the local flag and tap Amplify once so the next /bet can carry
   * isEnhancedBet. Use when a prior miss left the flag desynced from the UI.
   */
  async rearm(options?: ObservableWaitOptions): Promise<void> {
    this.enabled = false;
    await this.enable(options);
  }

  private async toggle(options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('amplifyBet');
    }
    if (this.lockState.locked) {
      throw new Error('Amplify bet controller is locked');
    }

    this.lockState = { locked: true, lockedBy: 'amplifyBet', reason: 'amplify-toggle' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        // Toggle control: one input only — click+tap turns amplify on then off.
        await clickCanvasControl(
          this.driver,
          this.manifest,
          'amplifyBet',
          { ...options, singleInput: true },
          { remember: true },
        );
      } else {
        await this.driver.click('amplifyBetButton', options);
      }
    } finally {
      this.lockState = { locked: false };
    }
  }
}
