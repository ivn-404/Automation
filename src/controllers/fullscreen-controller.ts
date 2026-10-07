/**
 * Fullscreen Controller — enter / exit fullscreen (canvas toggle or DOM button).
 */

import type { IFullscreenController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { clearCanvasOverlays } from '../platform/canvas-session-primer.js';
import { ControllerDisabledError } from './registry/errors.js';

export interface FullscreenControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

export class FullscreenController implements IFullscreenController {
  readonly id = 'fullscreen' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private fullscreen = false;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: FullscreenControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  isFullscreen(): boolean {
    return this.fullscreen;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'fullscreen');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async enter(options?: ObservableWaitOptions): Promise<void> {
    if (this.fullscreen) {
      return;
    }
    await this.toggle(options);
    this.fullscreen = true;
  }

  async exit(options?: ObservableWaitOptions): Promise<void> {
    if (!this.fullscreen) {
      return;
    }
    await this.toggle(options);
    this.fullscreen = false;
  }

  private async toggle(options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('fullscreen');
    }
    if (this.lockState.locked) {
      throw new Error('Fullscreen controller is locked');
    }

    this.lockState = { locked: true, lockedBy: 'fullscreen', reason: 'fullscreen-toggle' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        await clearCanvasOverlays(this.driver, this.manifest, 1);
        await this.driver.clickCanvas('fullscreen', options);
      } else {
        await this.driver.click('fullscreenButton', options);
      }
    } finally {
      this.lockState = { locked: false };
    }
  }
}
