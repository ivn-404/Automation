/**
 * Menu Controller — open / close the in-game menu panel.
 *
 * Canvas games: clickCanvas("menu") / clickCanvas("menuClose").
 */

import type { IMenuController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { recordClick } from '../driver/click-tracker.js';
import { clearCanvasOverlays } from '../platform/canvas-session-primer.js';
import { ControllerDisabledError } from './registry/errors.js';
import { clickCanvasControl } from './strategy/click-control.js';

export interface MenuControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

export class MenuController implements IMenuController {
  readonly id = 'menu' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private openState = false;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: MenuControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  isMenuOpen(): boolean {
    return this.openState;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'menu');
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
      throw new ControllerDisabledError('menu');
    }

    this.lockState = { locked: true, lockedBy: 'menu', reason: 'menu-open' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      await clearCanvasOverlays(this.driver, this.manifest, 1);
      if (rendering === 'canvas') {
        await clickCanvasControl(this.driver, this.manifest, 'menu', options);
      } else {
        await this.driver.click('menuButton', options);
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
      throw new ControllerDisabledError('menu');
    }

    this.lockState = { locked: true, lockedBy: 'menu', reason: 'menu-close' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        // Do not click `menu` here — that toggles the panel back open.
        // Do not run clearCanvasOverlays while open — closeOverlay lands on Settings.
        const page = this.driver.getPage();
        await page.keyboard.press('Escape').catch(() => undefined);

        const closeActions = ['menuClose', 'menuCloseAlt'] as const;
        for (const actionName of closeActions) {
          if (this.manifest.canvasActions?.actions[actionName] === undefined) {
            continue;
          }
          await this.driver.clickCanvas(actionName, options).catch(() => undefined);
        }

        // Dense taps around the hub panel X — `controls.menuClose.candidates` in config/surfaces.
        const closePoints = this.driver.surface.controls.menuClose?.candidates ?? [];
        const canvas = this.driver.gameCanvas();
        const box = await canvas.boundingBox();
        if (box !== null) {
          for (const point of closePoints) {
            const position = {
              x: Math.max(1, Math.min(box.width - 1, box.width * point.x)),
              y: Math.max(1, Math.min(box.height - 1, box.height * point.y)),
            };
            await recordClick(page, {
              label: 'menuCloseProbe',
              pageX: box.x + position.x,
              pageY: box.y + position.y,
              kind: 'canvas',
            });
            await canvas.tap({ position, force: true }).catch(() => undefined);
            await canvas.click({ position, force: true }).catch(() => undefined);
          }
        }
      } else {
        await this.driver.click('menuCloseButton', options);
      }
      this.openState = false;
    } finally {
      this.lockState = { locked: false };
    }
  }
}
