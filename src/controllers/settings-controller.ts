/**
 * Settings Controller — open / close in-game settings (via menu hub tab on canvas games).
 *
 * Canvas: menu → settingsTab; close via menuClose coords (same hub X as MenuController).
 */

import type { ISettingsController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { clearCanvasOverlays } from '../platform/canvas-session-primer.js';
import { ControllerDisabledError } from './registry/errors.js';

export interface SettingsControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

const SETTINGS_CLOSE_ACTIONS = ['menuClose', 'menuCloseAlt'] as const;

export class SettingsController implements ISettingsController {
  readonly id = 'settings' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private openState = false;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: SettingsControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  isSettingsOpen(): boolean {
    return this.openState;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'settings');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async open(options?: ObservableWaitOptions): Promise<void> {
    if (this.openState) {
      return;
    }
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('settings');
    }

    this.lockState = { locked: true, lockedBy: 'settings', reason: 'settings-open' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      await clearCanvasOverlays(this.driver, this.manifest, 1);
      if (rendering === 'canvas') {
        await this.driver.clickCanvas('menu', options);
        await this.driver.clickCanvas('settingsTab', options);
      } else {
        await this.driver.click('settingsButton', options);
      }
      this.openState = true;
    } finally {
      this.lockState = { locked: false };
    }
  }

  async close(options?: ObservableWaitOptions): Promise<void> {
    if (!this.openState) {
      return;
    }
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('settings');
    }

    this.lockState = { locked: true, lockedBy: 'settings', reason: 'settings-close' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        await this.driver.getPage().keyboard.press('Escape').catch(() => undefined);
        for (const actionName of SETTINGS_CLOSE_ACTIONS) {
          if (this.manifest.canvasActions?.actions[actionName] === undefined) {
            continue;
          }
          await this.driver.clickCanvas(actionName, options).catch(() => undefined);
        }
      } else {
        await this.driver.click('settingsCloseButton', options);
      }
      this.openState = false;
    } finally {
      this.lockState = { locked: false };
    }
  }
}
